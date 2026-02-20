/**
 * archiveIngestion.ts
 *
 * Slow-loads NDJSON import archives into the Alois brain over time.
 * Reads one scroll every INTERVAL_MS, embeds it, feeds it into all Alois backends.
 * Persists its position in a checkpoint file so restarts continue where they left off.
 *
 * Rate: default 1 scroll / 2 seconds — low enough to not saturate the embedding server
 * or block the tick loop. At that rate, 10,000 scrolls = ~5.5 hours of background ingest.
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

  // Current streaming state
  private pendingLines: Array<{ speaker: string; text: string }> = [];
  private currentFile: string | null = null;
  private linesConsumed = 0;

  private feedFn: FeedFn;

  constructor(dataDir: string, feedFn: FeedFn, intervalMs = 2000) {
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
        for (const cp of data) {
          this.checkpoints.set(cp.file, cp);
        }
      }
    } catch {
      // corrupt checkpoint — start fresh
    }
  }

  private saveCheckpoints(): void {
    const data = Array.from(this.checkpoints.values());
    writeFileSync(this.checkpointPath, JSON.stringify(data, null, 2));
  }

  /**
   * Find all NDJSON import archives and determine which still have unread lines.
   */
  private getArchiveFiles(): string[] {
    try {
      return readdirSync(this.dataDir)
        .filter(f => f.startsWith('import-archive-') && f.endsWith('.ndjson'))
        .map(f => join(this.dataDir, f));
    } catch {
      return [];
    }
  }

  /**
   * Stream an NDJSON file starting from a given line offset,
   * adding parsed lines to pendingLines buffer.
   */
  private async streamFile(filePath: string, startLine: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const rl = createInterface({
        input: createReadStream(filePath, { encoding: 'utf-8' }),
        crlfDelay: Infinity,
      });

      let lineNum = 0;
      let loaded = 0;

      rl.on('line', (line) => {
        lineNum++;
        if (lineNum <= startLine) return; // skip already-consumed lines
        if (!line.trim()) return;

        try {
          const parsed = JSON.parse(line);
          const content: string = parsed?.scroll?.content || '';
          if (!content) return;

          // Parse "[Speaker] text" format
          const match = content.match(/^\[(.+?)\] (.+)$/s);
          if (!match) return;

          const speaker = match[1].trim();
          const text = match[2].trim();
          if (text.length < 5) return; // skip trivially short entries

          this.pendingLines.push({ speaker, text });
          loaded++;
        } catch {
          // malformed line — skip
        }
      });

      rl.on('close', () => resolve(lineNum));
      rl.on('error', reject);
    });
  }

  /**
   * Start background ingestion. Loads pending lines from all archives,
   * then drains one entry per intervalMs.
   */
  async start(): Promise<void> {
    if (this.active) return;

    const files = this.getArchiveFiles();
    if (files.length === 0) {
      console.log('[INGEST] No import archives found, ingestion idle');
      return;
    }

    this.active = true;
    console.log(`[INGEST] Starting background archive ingestion — ${files.length} archive(s), interval ${this.intervalMs}ms`);

    // Stream all archives into pendingLines, respecting checkpoints
    for (const filePath of files) {
      const fileName = filePath.split(/[\\/]/).pop()!;
      const checkpoint = this.checkpoints.get(fileName);
      const startLine = checkpoint?.linesConsumed ?? 0;

      if (checkpoint && checkpoint.linesConsumed >= checkpoint.totalLines && checkpoint.totalLines > 0) {
        console.log(`[INGEST] ${fileName}: fully consumed (${checkpoint.linesConsumed} lines), skipping`);
        continue;
      }

      console.log(`[INGEST] Streaming ${fileName} from line ${startLine}...`);
      try {
        const totalLines = await this.streamFile(filePath, startLine);
        const existing = this.checkpoints.get(fileName);
        this.checkpoints.set(fileName, {
          file: fileName,
          linesConsumed: startLine,
          totalLines,
          startedAt: existing?.startedAt ?? new Date().toISOString(),
          lastIngestedAt: existing?.lastIngestedAt ?? new Date().toISOString(),
        });
        console.log(`[INGEST] ${fileName}: ${this.pendingLines.length} entries queued (${totalLines - startLine} new lines)`);
      } catch (err) {
        console.error(`[INGEST] Failed to stream ${fileName}:`, err);
      }
    }

    if (this.pendingLines.length === 0) {
      console.log('[INGEST] All archives fully consumed, ingestion complete');
      this.active = false;
      return;
    }

    console.log(`[INGEST] ${this.pendingLines.length} total entries to ingest — running in background`);
    this.drainLoop().catch(err => console.error('[INGEST] drainLoop error:', err));
  }

  private async drainLoop(): Promise<void> {
    while (this.active && this.pendingLines.length > 0) {
      const entry = this.pendingLines.shift()!;
      this.linesConsumed++;

      try {
        await this.feedFn(entry.speaker, entry.text);
      } catch (err) {
        console.error('[INGEST] feedFn error:', err);
      }

      // Log progress every 100 entries
      if (this.linesConsumed % 100 === 0) {
        this.saveCheckpoints();
        const remaining = this.pendingLines.length;
        console.log(`[INGEST] ${this.linesConsumed} ingested, ${remaining} remaining`);
      }

      // Small yield so we don't starve the event loop
      await new Promise(resolve => setTimeout(resolve, this.intervalMs));
    }

    if (this.active) {
      console.log('[INGEST] Archive ingestion complete — all entries consumed');
      this.active = false;
      this.saveCheckpoints();
    }
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
    return this.pendingLines.length;
  }
}
