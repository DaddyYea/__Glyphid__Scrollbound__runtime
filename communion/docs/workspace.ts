// communion/docs/workspace.ts
// Top-level facade for the document workspace.
// Scans documentsDir, parses + chunks + indexes all text files.
// Exposes search, context pack building, and review session management.

import { readdirSync, statSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { DocumentIndex } from './indexStore';
import { ReviewStore } from './reviewStore';
import { lexicalSearch } from './search';
import { buildContextPack, estimatePackTokens, BuildPackOptions } from './contextPackBuilder';
import { GroupedSearchResults, SearchQuery, ContextPack } from './types';

const INDEXABLE_EXTENSIONS = new Set([
  '.md', '.markdown', '.mdx',
  '.txt', '.text',
  '.ts', '.js', '.tsx', '.jsx',
  '.py', '.json', '.jsonl',
]);

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB

export class Workspace {
  readonly index = new DocumentIndex();
  readonly reviewStore = new ReviewStore();

  private documentsDir = '';
  private initialized = false;

  async init(documentsDir: string): Promise<void> {
    this.documentsDir = documentsDir;
    if (!existsSync(documentsDir)) {
      console.log(`[WORKSPACE] documentsDir not found: ${documentsDir} (workspace empty)`);
      this.initialized = true;
      return;
    }

    const files = this.scanDir(documentsDir);
    let indexed = 0;
    let skipped = 0;

    for (const { fullPath, relativePath } of files) {
      const result = this.index.registerDocument(fullPath, relativePath);
      if (result) indexed++;
      else skipped++;
    }

    this.initialized = true;
    const status = this.index.getStatus();
    console.log(`[WORKSPACE] Indexed ${indexed} files, ${status.chunkCount} chunks (${skipped} skipped)`);
  }

  async refresh(): Promise<{ added: number; updated: number; removed: number }> {
    if (!this.documentsDir) return { added: 0, updated: 0, removed: 0 };

    const files = this.scanDir(this.documentsDir);
    const currentPaths = new Set(files.map(f => `doc:${f.relativePath}`));
    const existing = this.index.getAllDocuments();

    let added = 0;
    let updated = 0;
    let removed = 0;

    // Remove docs no longer on disk
    for (const doc of existing) {
      if (!currentPaths.has(doc.id)) {
        this.index.removeDocument(doc.id);
        removed++;
      }
    }

    // Add new or re-index changed
    for (const { fullPath, relativePath } of files) {
      const docId = `doc:${relativePath}`;
      const existing = this.index.getDocument(docId);
      const newHash = this.quickHash(fullPath);
      if (!existing) {
        const result = this.index.registerDocument(fullPath, relativePath);
        if (result) added++;
      } else if (existing.contentHash !== newHash) {
        this.index.registerDocument(fullPath, relativePath);
        updated++;
      }
    }

    console.log(`[WORKSPACE] Refresh: +${added} updated:${updated} removed:${removed}`);
    return { added, updated, removed };
  }

  search(query: SearchQuery): GroupedSearchResults {
    return lexicalSearch(this.index, query);
  }

  buildPack(options: BuildPackOptions): ContextPack {
    return buildContextPack(this.index, options);
  }

  estimateTokens(chunkIds: string[]): number {
    return estimatePackTokens(chunkIds, this.index);
  }

  isReady(): boolean {
    return this.initialized;
  }

  private quickHash(fullPath: string): string {
    try {
      const stat = statSync(fullPath);
      return `${stat.size}-${stat.mtimeMs}`;
    } catch {
      return '0';
    }
  }

  private scanDir(dir: string): Array<{ fullPath: string; relativePath: string }> {
    const results: Array<{ fullPath: string; relativePath: string }> = [];

    const crawl = (currentDir: string, depth: number): void => {
      if (depth > 8) return;
      let entries;
      try {
        entries = readdirSync(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const fullPath = join(currentDir, entry.name);

        if (entry.isDirectory()) {
          crawl(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase();
          if (!INDEXABLE_EXTENSIONS.has(ext)) continue;
          try {
            const stat = statSync(fullPath);
            if (stat.size > MAX_FILE_BYTES) continue;
          } catch {
            continue;
          }
          const relativePath = fullPath.replace(dir + '/', '').replace(dir + '\\', '');
          results.push({ fullPath, relativePath });
        }
      }
    };

    crawl(dir, 0);
    return results;
  }
}

export const workspace = new Workspace();
