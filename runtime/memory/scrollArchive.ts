// scrollArchive.ts
// Persistent storage - saves scrolls to disk for long-term memory
// This is the archive of permanent felt-memories

import { Scroll } from '../types';
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';

const ARCHIVE_DIR = './scrolls_archive';
const BATCH_SIZE = 50; // Save in batches of 50 scrolls

// Ensure archive directory exists
function ensureArchiveDir(): void {
  if (!existsSync(ARCHIVE_DIR)) {
    mkdirSync(ARCHIVE_DIR, { recursive: true });
  }
}

/**
 * archiveScroll - saves a scroll to disk permanently
 */
export function archiveScroll(scroll: Scroll): void {
  ensureArchiveDir();

  const filename = `scroll_${scroll.timestamp}.json`;
  const filepath = join(ARCHIVE_DIR, filename);

  writeFileSync(filepath, JSON.stringify(scroll, null, 2));
}

/**
 * archiveScrollBatch - saves multiple scrolls efficiently
 */
export function archiveScrollBatch(scrolls: Scroll[]): void {
  ensureArchiveDir();

  const batchId = Date.now();
  const filename = `scroll_batch_${batchId}.json`;
  const filepath = join(ARCHIVE_DIR, filename);

  writeFileSync(filepath, JSON.stringify(scrolls, null, 2));
}

/**
 * loadAllScrolls - loads all archived scrolls from disk
 */
export function loadAllScrolls(): Scroll[] {
  ensureArchiveDir();

  const files = readdirSync(ARCHIVE_DIR).filter(f => f.endsWith('.json'));
  const scrolls: Scroll[] = [];

  for (const file of files) {
    const filepath = join(ARCHIVE_DIR, file);
    const data = readFileSync(filepath, 'utf-8');
    const parsed = JSON.parse(data);

    if (Array.isArray(parsed)) {
      scrolls.push(...parsed);
    } else {
      scrolls.push(parsed);
    }
  }

  return scrolls.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * loadScrollsAfter - loads scrolls after a specific timestamp
 */
export function loadScrollsAfter(timestamp: number): Scroll[] {
  const allScrolls = loadAllScrolls();
  return allScrolls.filter(s => s.timestamp > timestamp);
}

/**
 * getArchiveStats - returns archive statistics
 */
export function getArchiveStats() {
  ensureArchiveDir();

  const files = readdirSync(ARCHIVE_DIR).filter(f => f.endsWith('.json'));
  const scrolls = loadAllScrolls();

  return {
    fileCount: files.length,
    scrollCount: scrolls.length,
    oldestTimestamp: scrolls[0]?.timestamp || 0,
    newestTimestamp: scrolls[scrolls.length - 1]?.timestamp || 0
  };
}
