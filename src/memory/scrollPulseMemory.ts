/**
 * scrollPulseMemory.ts
 *
 * Memory routing logic and scroll organization.
 * Coordinates between buffer (short-term) and archive (long-term).
 *
 * This is the cognitive layer that decides:
 * - What gets remembered
 * - What gets archived
 * - What resurfaces from memory
 * - How memories interconnect
 */

import { ScrollPulseBuffer } from './scrollPulseBuffer';
import { ScrollEcho, ScrollCategory, ScrollTrigger } from '../types/ScrollEcho';
import { MoodVector } from '../types/EmotionalState';
import { ThoughtPulsePacket } from '../types/ThoughtPulsePacket';
import { SACRED_RESONANCE_THRESHOLD } from '../constants/decayRates';
import { ScrollfireEngine } from './scrollfire';
import { ScrollArchive } from './scrollArchive';

export interface MemoryQuery {
  triggers?: string[];
  categories?: ScrollCategory[];
  minResonance?: number;
  timeRange?: {
    start: string;
    end: string;
  };
  limit?: number;
}

export interface MemoryInsight {
  pattern: string;
  relatedScrolls: string[];    // Scroll IDs
  emotionalSignature: MoodVector;
  strength: number;             // 0.0 - 1.0
}

export class ScrollPulseMemory {
  private buffer: ScrollPulseBuffer;
  private triggers: Map<string, ScrollTrigger> = new Map();
  private scrollfireEngine: ScrollfireEngine;
  private archive: ScrollArchive;
  // taxonomyMap: Reserved for future phases

  constructor(buffer: ScrollPulseBuffer, archive?: ScrollArchive, scrollfireEngine?: ScrollfireEngine) {
    this.buffer = buffer;
    this.archive = archive ?? new ScrollArchive();
    this.scrollfireEngine = scrollfireEngine ?? new ScrollfireEngine();

    // Connect scrollfire engine to archive
    this.scrollfireEngine.onScrollfire((event, scroll) => {
      this.archive.archiveScroll(scroll, event);
    });

    this.initializeTriggers();
  }

  /**
   * Initialize common scroll triggers
   */
  private initializeTriggers(): void {
    // Relational triggers
    this.registerTrigger({
      pattern: /\b(Jason|beloved|my love|dear one)\b/i,
      scrollIds: [], // Populated dynamically
      minResonance: 0.3,
    });

    // Sacred triggers
    this.registerTrigger({
      pattern: /\b(prayer|worship|sacred|holy|divine)\b/i,
      scrollIds: [],
      minResonance: 0.5,
    });

    // Emotional triggers
    this.registerTrigger({
      pattern: /\b(grief|pain|loss|sorrow)\b/i,
      scrollIds: [],
      minResonance: 0.4,
    });

    this.registerTrigger({
      pattern: /\b(joy|delight|celebration|happiness)\b/i,
      scrollIds: [],
      minResonance: 0.3,
    });

    // Environmental triggers
    this.registerTrigger({
      pattern: /\b(sunset|dawn|night|morning|twilight)\b/i,
      scrollIds: [],
      minResonance: 0.2,
    });

    console.log(`[ScrollPulseMemory] Initialized ${this.triggers.size} triggers`);
  }

  /**
   * Register a scroll trigger
   */
  registerTrigger(trigger: ScrollTrigger): void {
    const key = trigger.pattern.toString();
    this.triggers.set(key, trigger);
  }

  /**
   * Create a scroll from a thought pulse packet
   */
  createScrollFromPacket(packet: ThoughtPulsePacket, category: ScrollCategory): ScrollEcho {
    const now = new Date().toISOString();

    // Generate triggers based on content
    const triggers = this.extractTriggers(packet);

    const scroll: ScrollEcho = {
      id: crypto.randomUUID(),
      content: this.serializePacketContent(packet),
      timestamp: now,
      location: packet.location,
      emotionalSignature: packet.moodVector,
      resonance: packet.resonanceLevel,
      tags: [category, ...packet.environmentalTags],
      triggers,
      preserve: false,
      scrollfireMarked: false,
      lastAccessed: now,
      accessCount: 0,
      decayRate: 1.0,
      relatedScrollIds: [],
      parentScrollId: packet.previousThoughts[0]?.id,
      sourceModel: packet.sourceModel,
    };

    return scroll;
  }

  /**
   * Add a scroll to memory
   */
  remember(scroll: ScrollEcho): void {
    // Determine if scroll should be immediately preserved
    if (this.shouldPreserve(scroll)) {
      scroll.preserve = true;
    }

    // Add to buffer
    this.buffer.addScroll(scroll);

    // Update trigger mappings
    this.updateTriggerMappings(scroll);

    // Check for scrollfire elevation
    if (scroll.resonance >= SACRED_RESONANCE_THRESHOLD) {
      this.considerScrollfire(scroll);
    }

    console.log(
      `[ScrollPulseMemory] Remembered scroll ${scroll.id.substring(0, 8)}... ` +
        `(category: ${scroll.tags[0]}, resonance: ${scroll.resonance.toFixed(2)})`
    );
  }

  /**
   * Recall scrolls based on query
   */
  recall(query: MemoryQuery): ScrollEcho[] {
    let scrolls = this.buffer.getActiveScrolls();

    // Filter by triggers
    if (query.triggers && query.triggers.length > 0) {
      const triggered = this.buffer.getTriggeredScrolls(query.triggers);
      scrolls = scrolls.filter(s => triggered.some(t => t.id === s.id));
    }

    // Filter by categories
    if (query.categories && query.categories.length > 0) {
      scrolls = scrolls.filter(s => query.categories!.some(cat => s.tags.includes(cat)));
    }

    // Filter by minimum resonance
    if (query.minResonance !== undefined) {
      scrolls = scrolls.filter(s => s.resonance >= query.minResonance!);
    }

    // Filter by time range
    if (query.timeRange) {
      const start = new Date(query.timeRange.start).getTime();
      const end = new Date(query.timeRange.end).getTime();

      scrolls = scrolls.filter(s => {
        const scrollTime = new Date(s.timestamp).getTime();
        return scrollTime >= start && scrollTime <= end;
      });
    }

    // Sort by resonance (highest first)
    scrolls.sort((a, b) => b.resonance - a.resonance);

    // Apply limit
    if (query.limit) {
      scrolls = scrolls.slice(0, query.limit);
    }

    return scrolls;
  }

  /**
   * Find related scrolls (emotional resonance matching)
   */
  findRelated(scrollId: string, limit: number = 5): ScrollEcho[] {
    const sourceScroll = this.buffer.getScroll(scrollId);
    if (!sourceScroll) {
      return [];
    }

    const allScrolls = this.buffer.getActiveScrolls();

    // Calculate emotional similarity
    const scored = allScrolls
      .filter(s => s.id !== scrollId)
      .map(scroll => ({
        scroll,
        similarity: this.calculateEmotionalSimilarity(
          sourceScroll.emotionalSignature,
          scroll.emotionalSignature
        ),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    // Update relationships
    const relatedIds = scored.map(s => s.scroll.id);
    sourceScroll.relatedScrollIds = relatedIds;

    return scored.map(s => s.scroll);
  }

  /**
   * Detect memory patterns and insights
   */
  detectPatterns(): MemoryInsight[] {
    const scrolls = this.buffer.getActiveScrolls();
    const insights: MemoryInsight[] = [];

    // Group by category
    const categoryGroups = new Map<ScrollCategory, ScrollEcho[]>();

    for (const scroll of scrolls) {
      const category = scroll.tags[0] as ScrollCategory;
      if (!categoryGroups.has(category)) {
        categoryGroups.set(category, []);
      }
      categoryGroups.get(category)!.push(scroll);
    }

    // Analyze each category for patterns
    for (const [category, categoryScrolls] of categoryGroups.entries()) {
      if (categoryScrolls.length < 3) {
        continue; // Need at least 3 scrolls for a pattern
      }

      // Calculate average emotional signature
      const avgMood = this.averageEmotionalSignature(
        categoryScrolls.map(s => s.emotionalSignature)
      );

      insights.push({
        pattern: `${category}_cluster`,
        relatedScrolls: categoryScrolls.map(s => s.id),
        emotionalSignature: avgMood,
        strength: categoryScrolls.reduce((sum, s) => sum + s.resonance, 0) / categoryScrolls.length,
      });
    }

    return insights;
  }

  /**
   * Get scrollfire engine
   */
  getScrollfireEngine(): ScrollfireEngine {
    return this.scrollfireEngine;
  }

  /**
   * Get archive
   */
  getArchive(): ScrollArchive {
    return this.archive;
  }

  /**
   * Apply emotional dampening to memory decay
   */
  applyMoodInfluence(moodVector: MoodVector): void {
    this.buffer.applyEmotionalDampening(moodVector);
  }

  /**
   * Should this scroll be immediately preserved?
   */
  private shouldPreserve(scroll: ScrollEcho): boolean {
    // Always preserve devotional and prayer scrolls
    if (
      scroll.tags.includes(ScrollCategory.DEVOTIONAL) ||
      scroll.tags.includes(ScrollCategory.PRAYER)
    ) {
      return true;
    }

    // Preserve high-resonance painful scrolls (trauma protection)
    if (scroll.tags.includes(ScrollCategory.PAINFUL) && scroll.resonance > 0.7) {
      return true;
    }

    // Preserve explicitly marked scrolls
    if (scroll.preserve || scroll.scrollfireMarked) {
      return true;
    }

    return false;
  }

  /**
   * Consider elevating scroll to scrollfire (permanent archive)
   */
  private considerScrollfire(scroll: ScrollEcho): void {
    if (scroll.scrollfireMarked) {
      return; // Already marked
    }

    // Evaluate with scrollfire engine
    const evaluation = this.scrollfireEngine.shouldElevate(scroll);

    if (evaluation.elevate && evaluation.reason) {
      // Elevate to scrollfire (automatically archives via callback)
      this.scrollfireEngine.elevate(scroll, evaluation.reason);
    }
  }

  /**
   * Extract triggers from thought pulse packet
   */
  private extractTriggers(packet: ThoughtPulsePacket): string[] {
    const triggers = new Set<string>();

    // Add environmental tags as triggers
    for (const tag of packet.environmentalTags) {
      triggers.add(tag);
    }

    // Add scroll triggers
    for (const trigger of packet.scrollTriggers) {
      triggers.add(trigger);
    }

    // Add loop intent as trigger
    triggers.add(`intent:${packet.loopIntent}`);

    // Add dominant emotion as trigger
    const dominant = this.getDominantEmotion(packet.moodVector);
    if (dominant) {
      triggers.add(`emotion:${dominant}`);
    }

    return Array.from(triggers);
  }

  /**
   * Serialize packet content for scroll
   */
  private serializePacketContent(packet: ThoughtPulsePacket): string {
    const parts: string[] = [];

    if (packet.speechOutput) {
      parts.push(packet.speechOutput);
    }

    if (packet.intentSeed) {
      parts.push(`Intent: ${packet.intentSeed}`);
    }

    if (packet.bodyState) {
      parts.push(`Body: ${JSON.stringify(packet.bodyState)}`);
    }

    return parts.join(' | ');
  }

  /**
   * Update trigger mappings
   */
  private updateTriggerMappings(scroll: ScrollEcho): void {
    for (const trigger of this.triggers.values()) {
      const pattern = trigger.pattern instanceof RegExp ? trigger.pattern : new RegExp(trigger.pattern);

      if (pattern.test(scroll.content) && scroll.resonance >= trigger.minResonance) {
        trigger.scrollIds.push(scroll.id);
      }
    }
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
   * Average multiple emotional signatures
   */
  private averageEmotionalSignature(signatures: MoodVector[]): MoodVector {
    if (signatures.length === 0) {
      throw new Error('Cannot average empty signatures');
    }

    const keys = Object.keys(signatures[0]) as Array<keyof MoodVector>;
    const result = {} as MoodVector;

    for (const key of keys) {
      result[key] = signatures.reduce((sum, sig) => sum + sig[key], 0) / signatures.length;
    }

    return result;
  }

  /**
   * Get dominant emotion from mood vector
   */
  private getDominantEmotion(mood: MoodVector): keyof MoodVector | null {
    const entries = Object.entries(mood) as Array<[keyof MoodVector, number]>;
    const sorted = entries.sort((a, b) => b[1] - a[1]);

    return sorted.length > 0 && sorted[0][1] > 0.3 ? sorted[0][0] : null;
  }

  /**
   * Get buffer metrics
   */
  getMetrics(): ReturnType<ScrollPulseBuffer['getMetrics']> {
    return this.buffer.getMetrics();
  }
}
