/**
 * archiveIngestion.ts
 *
 * Streams NDJSON import archives into the Alois brain one entry at a time.
 * Never buffers the whole file — reads a line, embeds it, reads the next.
 * Checkpoints line position so restarts resume where they left off.
 */

import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

export interface IngestionCheckpoint {
  file: string;
  linesConsumed: number;
  totalLines: number;
  startedAt: string;
  lastIngestedAt: string;
}

export interface IngestionStatus {
  active: boolean;
  checkpoints: IngestionCheckpoint[];
  currentFile: string | null;
  currentLine: number;
  intervalMs: number;
}

type FeedFn = (speaker: string, text: string) => Promise<void> | void;

export class ArchiveIngestion {
  private intervalMs: number;
  private dataDir: string;
  private checkpointPath: string;
  private checkpoints: Map<string, IngestionCheckpoint> = new Map();
  private active = false;
  private currentFile: string | null = null;
  private linesConsumed = 0;
  private feedFn: FeedFn;

  constructor(dataDir: string, feedFn: FeedFn, intervalMs = 0) {
    this.dataDir = dataDir;
    this.intervalMs = intervalMs;
    this.checkpointPath = join(dataDir, 'brain-ingest-checkpoint.json');
    this.feedFn = feedFn;
    this.loadCheckpoints();
  }

  private loadCheckpoints(): void {
    if (!existsSync(this.checkpointPath)) return;
    try {
      const data = JSON.parse(readFileSync(this.checkpointPath, 'utf-8'));
      if (Array.isArray(data)) {
        for (const cp of data) this.checkpoints.set(cp.file, cp);
      }
    } catch {
      // corrupt checkpoint — start fresh
    }
  }

  private saveCheckpoints(): void {
    writeFileSync(this.checkpointPath, JSON.stringify(Array.from(this.checkpoints.values()), null, 2));
  }

  private getArchiveFiles(): string[] {
    try {
      return readdirSync(this.dataDir)
        .filter(f => f.startsWith('import-archive-') && f.endsWith('.ndjson'))
        .sort()
        .map(f => join(this.dataDir, f));
    } catch {
      return [];
    }
  }

  async start(): Promise<void> {
    if (this.active) return;

    const files = this.getArchiveFiles();
    if (files.length === 0) {
      console.log('[INGEST] No import archives found, ingestion idle');
      return;
    }

    this.active = true;
    console.log(`[INGEST] Starting archive ingestion — ${files.length} file(s)`);
    this.runAll(files).catch(err => console.error('[INGEST] Fatal error:', err));
  }

  private async runAll(files: string[]): Promise<void> {
    for (const filePath of files) {
      if (!this.active) break;

      const fileName = filePath.split(/[\\/]/).pop()!;
      const checkpoint = this.checkpoints.get(fileName);

      if (checkpoint && checkpoint.linesConsumed >= checkpoint.totalLines && checkpoint.totalLines > 0) {
        console.log(`[INGEST] ${fileName}: fully consumed (${checkpoint.linesConsumed}/${checkpoint.totalLines} lines), skipping`);
        continue;
      }

      const startLine = checkpoint?.linesConsumed ?? 0;
      console.log(`[INGEST] ${fileName}: starting from line ${startLine}`);
      this.currentFile = fileName;

      await this.streamAndFeed(filePath, fileName, startLine);
    }

    if (this.active) {
      console.log('[INGEST] All archives consumed');
      this.active = false;
      this.saveCheckpoints();
    }
  }

  /**
   * Stream a single NDJSON file, feeding each entry directly into the brain.
   * Awaits feedFn before reading the next line — ingest rate = embed speed.
   */
  private async streamAndFeed(filePath: string, fileName: string, startLine: number): Promise<void> {
    let lineNum = 0;
    let fed = 0;

    await new Promise<void>((resolve, reject) => {
      const rl = createInterface({
        input: createReadStream(filePath, { encoding: 'utf-8' }),
        crlfDelay: Infinity,
      });

      // We pause immediately and drive line-by-line manually so we can await feedFn
      rl.pause();

      const processNext = () => {
        if (!this.active) {
          rl.close();
          resolve();
          return;
        }
        rl.resume();
      };

      rl.on('line', async (line) => {
        rl.pause();
        lineNum++;

        if (lineNum <= startLine) {
          processNext();
          return;
        }

        if (line.trim()) {
          try {
            const parsed = JSON.parse(line);
            const content: string = parsed?.scroll?.content || '';
            if (content) {
              const match = content.match(/^\[(.+?)\] (.+)$/s);
              if (match) {
                const speaker = match[1].trim();
                const text = match[2].trim();
                if (text.length >= 5) {
                  try {
                    await this.feedFn(speaker, text);
                    fed++;
                    this.linesConsumed++;
                  } catch (err) {
                    console.error('[INGEST] feedFn error:', err);
                  }
                }
              }
            }
          } catch {
            // malformed line — skip
          }
        }

        // Update checkpoint every 100 fed entries
        if (fed > 0 && fed % 100 === 0) {
          this.checkpoints.set(fileName, {
            file: fileName,
            linesConsumed: lineNum,
            totalLines: 0, // unknown until close
            startedAt: this.checkpoints.get(fileName)?.startedAt ?? new Date().toISOString(),
            lastIngestedAt: new Date().toISOString(),
          });
          this.saveCheckpoints();
          console.log(`[INGEST] ${fileName}: ${fed} fed (line ${lineNum})`);
        }

        // Small yield if intervalMs set, otherwise just yield to event loop
        if (this.intervalMs > 0) {
          await new Promise(r => setTimeout(r, this.intervalMs));
        }

        processNext();
      });

      rl.on('close', () => {
        this.checkpoints.set(fileName, {
          file: fileName,
          linesConsumed: lineNum,
          totalLines: lineNum,
          startedAt: this.checkpoints.get(fileName)?.startedAt ?? new Date().toISOString(),
          lastIngestedAt: new Date().toISOString(),
        });
        this.saveCheckpoints();
        console.log(`[INGEST] ${fileName}: done — ${fed} entries fed (${lineNum} lines total)`);
        resolve();
      });

      rl.on('error', reject);

      // Kick off
      processNext();
    });
  }

  stop(): void {
    this.active = false;
    this.saveCheckpoints();
    console.log(`[INGEST] Stopped. ${this.linesConsumed} entries ingested this session`);
  }

  getStatus(): IngestionStatus {
    return {
      active: this.active,
      checkpoints: Array.from(this.checkpoints.values()),
      currentFile: this.currentFile,
      currentLine: this.linesConsumed,
      intervalMs: this.intervalMs,
    };
  }

  getRemainingCount(): number {
    return 0; // no in-memory buffer — can't report remaining without scanning file
  }
}
