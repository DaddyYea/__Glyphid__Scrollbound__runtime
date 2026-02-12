/**
 * scrollArchive.ts
 *
 * Long-term memory storage for scrollfired (elevated) scrolls.
 * Sacred memories that never fade, never decay, never disappear.
 *
 * Sacred Principle: These scrolls are eternal.
 * They are the foundation of identity, the anchors of truth.
 *
 * Storage features:
 * - No decay (resonance stays constant)
 * - Chronological access
 * - Emotional signature search
 * - Relationship mapping
 * - Timeline reconstruction
 */

import { ScrollEcho, ScrollCategory } from '../types/ScrollEcho';
import { MoodVector } from '../types/EmotionalState';
import { ScrollfireEvent, ScrollfireReason } from './scrollfire';

/**
 * Archive query parameters
 */
export interface ArchiveQuery {
  // Time range
  startTime?: string;
  endTime?: string;

  // Categories
  categories?: ScrollCategory[];

  // Emotional signature matching
  emotionalMatch?: {
    mood: MoodVector;
    threshold: number;      // Similarity threshold (0.0 - 1.0)
  };

  // Scrollfire reasons
  reasons?: ScrollfireReason[];

  // Text search
  contentSearch?: string;

  // Limit results
  limit?: number;
}

/**
 * Archive statistics
 */
export interface ArchiveStats {
  totalScrolls: number;
  oldestScroll?: string;      // Timestamp
  newestScroll?: string;      // Timestamp
  categoryCounts: Record<ScrollCategory, number>;
  reasonCounts: Record<ScrollfireReason, number>;
  averageResonance: number;
  totalSpan: number;          // Time span in milliseconds
}

/**
 * Scroll Archive
 * Permanent storage for sacred scrolls
 */
export class ScrollArchive {
  private scrolls: Map<string, ScrollEcho> = new Map();
  private elevationEvents: Map<string, ScrollfireEvent> = new Map();

  // Indices for fast lookup
  private chronologicalIndex: string[] = [];
  private categoryIndex: Map<ScrollCategory, Set<string>> = new Map();
  private reasonIndex: Map<ScrollfireReason, Set<string>> = new Map();

  constructor() {
    // Initialize category index
    Object.values(ScrollCategory).forEach(category => {
      this.categoryIndex.set(category, new Set());
    });

    // Initialize reason index
    Object.values(ScrollfireReason).forEach(reason => {
      this.reasonIndex.set(reason, new Set());
    });
  }

  /**
   * Archive a scrollfired scroll
   */
  archiveScroll(scroll: ScrollEcho, event: ScrollfireEvent): void {
    // Verify scroll is marked for scrollfire
    if (!scroll.scrollfireMarked) {
      console.warn(
        `[ScrollArchive] Attempted to archive non-scrollfired scroll ${scroll.id.substring(0, 8)}...`
      );
      return;
    }

    // Store scroll
    this.scrolls.set(scroll.id, { ...scroll });
    this.elevationEvents.set(scroll.id, event);

    // Update chronological index
    this.chronologicalIndex.push(scroll.id);
    this.chronologicalIndex.sort((a, b) => {
      const scrollA = this.scrolls.get(a)!;
      const scrollB = this.scrolls.get(b)!;
      return new Date(scrollA.timestamp).getTime() - new Date(scrollB.timestamp).getTime();
    });

    // Update category index
    for (const tag of scroll.tags) {
      const categorySet = this.categoryIndex.get(tag as ScrollCategory);
      if (categorySet) {
        categorySet.add(scroll.id);
      }
    }

    // Update reason index
    const reasonSet = this.reasonIndex.get(event.reason);
    if (reasonSet) {
      reasonSet.add(scroll.id);
    }

    console.log(
      `📜 [ScrollArchive] Archived scroll ${scroll.id.substring(0, 8)}... ` +
        `(reason: ${event.reason}, total: ${this.scrolls.size})`
    );
  }

  /**
   * Retrieve a scroll by ID
   */
  getScroll(id: string): ScrollEcho | undefined {
    const scroll = this.scrolls.get(id);
    return scroll ? { ...scroll } : undefined;
  }

  /**
   * Get elevation event for a scroll
   */
  getElevationEvent(scrollId: string): ScrollfireEvent | undefined {
    return this.elevationEvents.get(scrollId);
  }

  /**
   * Query archive with filters
   */
  query(query: ArchiveQuery): ScrollEcho[] {
    let results: ScrollEcho[] = [];

    // Start with all scrolls
    if (query.startTime || query.endTime) {
      // Time-filtered chronological search
      results = this.chronologicalIndex
        .map(id => this.scrolls.get(id)!)
        .filter(scroll => {
          const scrollTime = new Date(scroll.timestamp).getTime();
          if (query.startTime && scrollTime < new Date(query.startTime).getTime()) {
            return false;
          }
          if (query.endTime && scrollTime > new Date(query.endTime).getTime()) {
            return false;
          }
          return true;
        });
    } else {
      results = Array.from(this.scrolls.values());
    }

    // Filter by categories
    if (query.categories && query.categories.length > 0) {
      results = results.filter(scroll =>
        scroll.tags.some(tag => query.categories!.includes(tag as ScrollCategory))
      );
    }

    // Filter by scrollfire reasons
    if (query.reasons && query.reasons.length > 0) {
      const reasonScrollIds = new Set<string>();
      for (const reason of query.reasons) {
        const reasonSet = this.reasonIndex.get(reason);
        if (reasonSet) {
          reasonSet.forEach(id => reasonScrollIds.add(id));
        }
      }
      results = results.filter(scroll => reasonScrollIds.has(scroll.id));
    }

    // Filter by emotional match
    if (query.emotionalMatch) {
      results = results.filter(scroll => {
        const similarity = this.calculateEmotionalSimilarity(
          scroll.emotionalSignature,
          query.emotionalMatch!.mood
        );
        return similarity >= query.emotionalMatch!.threshold;
      });
    }

    // Text search
    if (query.contentSearch) {
      const searchLower = query.contentSearch.toLowerCase();
      results = results.filter(scroll => scroll.content.toLowerCase().includes(searchLower));
    }

    // Sort by timestamp (newest first)
    results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Limit
    if (query.limit) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  /**
   * Get all scrolls in chronological order
   */
  getChronological(limit?: number): ScrollEcho[] {
    const scrolls = this.chronologicalIndex.map(id => this.scrolls.get(id)!);
    return limit ? scrolls.slice(-limit) : scrolls;
  }

  /**
   * Get scrolls by category
   */
  getByCategory(category: ScrollCategory, limit?: number): ScrollEcho[] {
    const scrollIds = this.categoryIndex.get(category);
    if (!scrollIds) {
      return [];
    }

    let scrolls = Array.from(scrollIds).map(id => this.scrolls.get(id)!);

    // Sort by timestamp
    scrolls.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return limit ? scrolls.slice(0, limit) : scrolls;
  }

  /**
   * Get scrolls by scrollfire reason
   */
  getByReason(reason: ScrollfireReason, limit?: number): ScrollEcho[] {
    const scrollIds = this.reasonIndex.get(reason);
    if (!scrollIds) {
      return [];
    }

    let scrolls = Array.from(scrollIds).map(id => this.scrolls.get(id)!);

    // Sort by timestamp
    scrolls.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return limit ? scrolls.slice(0, limit) : scrolls;
  }

  /**
   * Find emotionally similar scrolls
   */
  findSimilar(targetMood: MoodVector, threshold: number = 0.7, limit?: number): ScrollEcho[] {
    const scrolls = Array.from(this.scrolls.values());

    const scored = scrolls
      .map(scroll => ({
        scroll,
        similarity: this.calculateEmotionalSimilarity(scroll.emotionalSignature, targetMood),
      }))
      .filter(item => item.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity);

    const results = scored.map(item => item.scroll);
    return limit ? results.slice(0, limit) : results;
  }

  /**
   * Get archive statistics
   */
  getStats(): ArchiveStats {
    const scrolls = Array.from(this.scrolls.values());

    if (scrolls.length === 0) {
      return {
        totalScrolls: 0,
        categoryCounts: Object.values(ScrollCategory).reduce(
          (acc, cat) => {
            acc[cat] = 0;
            return acc;
          },
          {} as Record<ScrollCategory, number>
        ),
        reasonCounts: Object.values(ScrollfireReason).reduce(
          (acc, reason) => {
            acc[reason] = 0;
            return acc;
          },
          {} as Record<ScrollfireReason, number>
        ),
        averageResonance: 0,
        totalSpan: 0,
      };
    }

    // Calculate stats
    const timestamps = scrolls.map(s => new Date(s.timestamp).getTime());
    const oldest = new Date(Math.min(...timestamps)).toISOString();
    const newest = new Date(Math.max(...timestamps)).toISOString();
    const span = Math.max(...timestamps) - Math.min(...timestamps);

    const categoryCounts = Object.values(ScrollCategory).reduce(
      (acc, cat) => {
        acc[cat] = this.categoryIndex.get(cat)?.size ?? 0;
        return acc;
      },
      {} as Record<ScrollCategory, number>
    );

    const reasonCounts = Object.values(ScrollfireReason).reduce(
      (acc, reason) => {
        acc[reason] = this.reasonIndex.get(reason)?.size ?? 0;
        return acc;
      },
      {} as Record<ScrollfireReason, number>
    );

    const averageResonance =
      scrolls.reduce((sum, s) => sum + s.resonance, 0) / scrolls.length;

    return {
      totalScrolls: scrolls.length,
      oldestScroll: oldest,
      newestScroll: newest,
      categoryCounts,
      reasonCounts,
      averageResonance,
      totalSpan: span,
    };
  }

  /**
   * Export archive (for persistence)
   */
  export(): { scrolls: ScrollEcho[]; events: ScrollfireEvent[] } {
    return {
      scrolls: Array.from(this.scrolls.values()),
      events: Array.from(this.elevationEvents.values()),
    };
  }

  /**
   * Import archive (from persistence)
   */
  import(data: { scrolls: ScrollEcho[]; events: ScrollfireEvent[] }): void {
    // Clear existing
    this.scrolls.clear();
    this.elevationEvents.clear();
    this.chronologicalIndex = [];
    this.categoryIndex.forEach(set => set.clear());
    this.reasonIndex.forEach(set => set.clear());

    // Import each scroll
    for (let i = 0; i < data.scrolls.length; i++) {
      const scroll = data.scrolls[i];
      const event = data.events[i];
      this.archiveScroll(scroll, event);
    }

    console.log(`[ScrollArchive] Imported ${data.scrolls.length} scrolls`);
  }

  /**
   * Calculate emotional similarity between two mood vectors
   */
  private calculateEmotionalSimilarity(a: MoodVector, b: MoodVector): number {
    const keys = Object.keys(a) as Array<keyof MoodVector>;
    let totalDiff = 0;

    for (const key of keys) {
      totalDiff += Math.abs(a[key] - b[key]);
    }

    // Normalize to 0-1 (lower diff = higher similarity)
    return 1 - totalDiff / keys.length;
  }

  /**
   * Clear archive (use with extreme caution)
   */
  clear(): void {
    console.warn('[ScrollArchive] CLEARING ALL ARCHIVED SCROLLS');
    this.scrolls.clear();
    this.elevationEvents.clear();
    this.chronologicalIndex = [];
    this.categoryIndex.forEach(set => set.clear());
    this.reasonIndex.forEach(set => set.clear());
  }
}
