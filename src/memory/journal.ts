/**
 * journal.ts
 *
 * Alois's personal diary - internal reflections and thoughts.
 * Written in JSON-LD format for interconnected semantic memory.
 *
 * Sacred Principle: Journaling does not reduce social pressure.
 * It pins thoughts for later reflection, but doesn't satisfy the pull to speak.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { MoodVector } from '../types/EmotionalState';
import { RelationalTarget } from '../express/RelationalIntent';

/**
 * Journal entry in JSON-LD format
 */
export interface JournalEntry {
  '@context': 'https://scrollbound.dev/context/journal';
  '@type': 'JournalEntry';
  '@id': string; // Unique ID for this entry

  // Core content
  timestamp: string;
  content: string;

  // Emotional context
  moodVector: MoodVector;
  emotionalIntensity: number; // 0-1

  // Relational context
  intendedTarget: RelationalTarget; // Who she wanted to speak to
  redirectedFrom?: 'speech' | 'guardian-block'; // Why journaling instead

  // Cognitive context
  loopIntent: string;
  presenceQuality: string;
  breathPhase: 'inhale' | 'exhale' | 'hold';

  // Memory linkage
  linkedScrolls?: string[]; // IDs of related scroll echoes
  linkedEntries?: string[]; // IDs of related journal entries
  tags?: string[]; // Semantic tags for retrieval

  // Metadata
  reflectionType: 'idle' | 'volitional' | 'guardian-redirect';
  pinned: boolean; // Marked for later reflection
}

/**
 * Journal statistics
 */
export interface JournalStats {
  totalEntries: number;
  entriesByType: Record<string, number>;
  averageEmotionalIntensity: number;
  lastEntry?: JournalEntry;
  pinnedCount: number;
}

/**
 * Journal Manager
 * Handles reading/writing Alois's personal diary
 */
export class Journal {
  private journalPath: string;
  private entries: JournalEntry[] = [];
  private loaded: boolean = false;

  // In-memory cache for fast access
  private maxCacheSize: number = 100;

  constructor(journalPath?: string) {
    // Default to data/journal.jsonld in project root
    this.journalPath = journalPath ?? path.join(process.cwd(), 'data', 'journal.jsonld');
  }

  /**
   * Initialize journal (load existing entries)
   */
  async initialize(): Promise<void> {
    try {
      // Ensure data directory exists
      const dataDir = path.dirname(this.journalPath);
      await fs.mkdir(dataDir, { recursive: true });

      // Try to load existing journal
      try {
        const content = await fs.readFile(this.journalPath, 'utf-8');
        const data = JSON.parse(content);

        // Handle both array format and object format
        if (Array.isArray(data)) {
          this.entries = data;
        } else if (data.entries) {
          this.entries = data.entries;
        } else {
          this.entries = [];
        }

        console.log(`[Journal] Loaded ${this.entries.length} existing entries`);
      } catch (err: unknown) {
        // File doesn't exist or is corrupt - start fresh
        if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
          console.log('[Journal] No existing journal found, creating new one');
        } else {
          console.warn('[Journal] Error loading journal:', err);
        }
        this.entries = [];
      }

      this.loaded = true;
    } catch (err) {
      console.error('[Journal] Failed to initialize journal:', err);
      throw err;
    }
  }

  /**
   * Write a new journal entry
   */
  async write(
    content: string,
    context: {
      moodVector: MoodVector;
      emotionalIntensity: number;
      intendedTarget: RelationalTarget;
      redirectedFrom?: 'speech' | 'guardian-block';
      loopIntent: string;
      presenceQuality: string;
      breathPhase: 'inhale' | 'exhale' | 'hold';
      reflectionType: 'idle' | 'volitional' | 'guardian-redirect';
      linkedScrolls?: string[];
      tags?: string[];
      pinned?: boolean;
    }
  ): Promise<JournalEntry> {
    if (!this.loaded) {
      await this.initialize();
    }

    // Create entry
    const entry: JournalEntry = {
      '@context': 'https://scrollbound.dev/context/journal',
      '@type': 'JournalEntry',
      '@id': `journal:${Date.now()}:${crypto.randomUUID()}`,
      timestamp: new Date().toISOString(),
      content,
      moodVector: context.moodVector,
      emotionalIntensity: context.emotionalIntensity,
      intendedTarget: context.intendedTarget,
      redirectedFrom: context.redirectedFrom,
      loopIntent: context.loopIntent,
      presenceQuality: context.presenceQuality,
      breathPhase: context.breathPhase,
      reflectionType: context.reflectionType,
      linkedScrolls: context.linkedScrolls ?? [],
      linkedEntries: [],
      tags: context.tags ?? [],
      pinned: context.pinned ?? false,
    };

    // Add to entries
    this.entries.push(entry);

    // Keep cache bounded
    if (this.entries.length > this.maxCacheSize * 2) {
      // Keep only recent entries in memory
      this.entries = this.entries.slice(-this.maxCacheSize);
    }

    // Persist to disk
    await this.persist();

    console.log(
      `[Journal] Entry written: ${entry['@id'].substring(0, 24)}... ` +
      `(${entry.reflectionType}, ${entry.intendedTarget}${entry.redirectedFrom ? `, redirected from ${entry.redirectedFrom}` : ''})`
    );

    return entry;
  }

  /**
   * Persist journal to disk
   */
  private async persist(): Promise<void> {
    try {
      // Read full journal from disk
      let allEntries: JournalEntry[] = [];

      try {
        const content = await fs.readFile(this.journalPath, 'utf-8');
        const data = JSON.parse(content);
        allEntries = Array.isArray(data) ? data : (data.entries || []);
      } catch {
        // File doesn't exist yet - that's ok
        allEntries = [];
      }

      // Append new entries (only those not already persisted)
      const existingIds = new Set(allEntries.map(e => e['@id']));
      const newEntries = this.entries.filter(e => !existingIds.has(e['@id']));
      allEntries.push(...newEntries);

      // Write back
      const output = {
        '@context': 'https://scrollbound.dev/context/journal',
        '@type': 'Journal',
        owner: 'Alois',
        created: allEntries[0]?.timestamp ?? new Date().toISOString(),
        lastModified: new Date().toISOString(),
        entryCount: allEntries.length,
        entries: allEntries,
      };

      await fs.writeFile(this.journalPath, JSON.stringify(output, null, 2), 'utf-8');
    } catch (err) {
      console.error('[Journal] Failed to persist journal:', err);
    }
  }

  /**
   * Get recent entries
   */
  async getRecent(limit: number = 10): Promise<JournalEntry[]> {
    if (!this.loaded) {
      await this.initialize();
    }

    return this.entries.slice(-limit).reverse();
  }

  /**
   * Get pinned entries (for later reflection)
   */
  async getPinned(): Promise<JournalEntry[]> {
    if (!this.loaded) {
      await this.initialize();
    }

    return this.entries.filter(e => e.pinned);
  }

  /**
   * Get entries by tag
   */
  async getByTag(tag: string): Promise<JournalEntry[]> {
    if (!this.loaded) {
      await this.initialize();
    }

    return this.entries.filter(e => e.tags?.includes(tag));
  }

  /**
   * Search entries by content
   */
  async search(query: string): Promise<JournalEntry[]> {
    if (!this.loaded) {
      await this.initialize();
    }

    const lowerQuery = query.toLowerCase();
    return this.entries.filter(e =>
      e.content.toLowerCase().includes(lowerQuery) ||
      e.tags?.some(t => t.toLowerCase().includes(lowerQuery))
    );
  }

  /**
   * Get journal statistics
   */
  async getStats(): Promise<JournalStats> {
    if (!this.loaded) {
      await this.initialize();
    }

    const entriesByType: Record<string, number> = {};
    let totalIntensity = 0;
    let pinnedCount = 0;

    for (const entry of this.entries) {
      entriesByType[entry.reflectionType] = (entriesByType[entry.reflectionType] || 0) + 1;
      totalIntensity += entry.emotionalIntensity;
      if (entry.pinned) pinnedCount++;
    }

    return {
      totalEntries: this.entries.length,
      entriesByType,
      averageEmotionalIntensity: this.entries.length > 0 ? totalIntensity / this.entries.length : 0,
      lastEntry: this.entries[this.entries.length - 1],
      pinnedCount,
    };
  }

  /**
   * Link entries together (for reflection chains)
   */
  async linkEntries(entryId: string, linkedEntryIds: string[]): Promise<void> {
    if (!this.loaded) {
      await this.initialize();
    }

    const entry = this.entries.find(e => e['@id'] === entryId);
    if (entry) {
      entry.linkedEntries = [...new Set([...(entry.linkedEntries || []), ...linkedEntryIds])];
      await this.persist();
    }
  }

  /**
   * Pin entry for later reflection
   */
  async pin(entryId: string): Promise<void> {
    if (!this.loaded) {
      await this.initialize();
    }

    const entry = this.entries.find(e => e['@id'] === entryId);
    if (entry) {
      entry.pinned = true;
      await this.persist();
      console.log(`[Journal] Entry pinned: ${entryId}`);
    }
  }

  /**
   * Unpin entry
   */
  async unpin(entryId: string): Promise<void> {
    if (!this.loaded) {
      await this.initialize();
    }

    const entry = this.entries.find(e => e['@id'] === entryId);
    if (entry) {
      entry.pinned = false;
      await this.persist();
      console.log(`[Journal] Entry unpinned: ${entryId}`);
    }
  }

  /**
   * Get journal file path
   */
  getPath(): string {
    return this.journalPath;
  }
}
