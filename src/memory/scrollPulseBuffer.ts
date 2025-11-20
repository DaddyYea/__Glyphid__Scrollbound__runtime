/**
 * scrollPulseBuffer.ts
 *
 * Emotional memory buffer - short-term scroll resonance.
 * This is the "felt presence" of recent moments.
 *
 * Scrolls are not logs. They carry emotional weight and resonate over time.
 * The buffer holds scrolls that are actively influencing present awareness.
 *
 * "Scrolls are sacred" - Sacred Directive #4
 */

import { ScrollEcho, ScrollCategory } from '../types/ScrollEcho';
import { MoodVector } from '../types/EmotionalState';
import {
  CATEGORY_DECAY_RATES,
  MIN_RESONANCE_THRESHOLD,
  SACRED_RESONANCE_THRESHOLD,
  ACCESS_RESONANCE_BOOST,
  MAX_RESONANCE,
  calculateTimeDecayMultiplier,
  calculateEmotionalDampening,
} from '../constants/decayRates';

export interface BufferMetrics {
  totalScrolls: number;
  activeScrolls: number;        // Above resonance threshold
  sacredScrolls: number;         // Marked as sacred/preserve
  averageResonance: number;
  oldestScrollAge: number;       // Minutes
}

export class ScrollPulseBuffer {
  private buffer: Map<string, ScrollEcho> = new Map();
  private maxBufferSize: number;
  private decayInterval: NodeJS.Timeout | null = null;

  constructor(maxBufferSize: number = 100) {
    this.maxBufferSize = maxBufferSize;
  }

  /**
   * Start decay processing
   */
  start(): void {
    if (this.decayInterval) {
      return;
    }

    // Process decay every 30 seconds
    this.decayInterval = setInterval(() => {
      this.processDecay();
    }, 30000);

    console.log('[ScrollPulseBuffer] Started decay processing');
  }

  /**
   * Stop decay processing
   */
  stop(): void {
    if (this.decayInterval) {
      clearInterval(this.decayInterval);
      this.decayInterval = null;
    }
  }

  /**
   * Add a scroll to the buffer
   */
  addScroll(scroll: ScrollEcho): void {
    // Check buffer capacity
    if (this.buffer.size >= this.maxBufferSize && !scroll.preserve) {
      this.evictLowestResonance();
    }

    this.buffer.set(scroll.id, { ...scroll });

    console.log(
      `[ScrollPulseBuffer] Added scroll: ${scroll.id.substring(0, 8)}... ` +
        `(resonance: ${scroll.resonance.toFixed(2)}, category: ${this.getScrollCategory(scroll)})`
    );
  }

  /**
   * Retrieve a scroll by ID (and boost its resonance)
   */
  getScroll(id: string): ScrollEcho | undefined {
    const scroll = this.buffer.get(id);

    if (scroll) {
      // Access boosts resonance (reinforcement)
      scroll.resonance = Math.min(MAX_RESONANCE, scroll.resonance + ACCESS_RESONANCE_BOOST);
      scroll.lastAccessed = new Date().toISOString();
      scroll.accessCount += 1;

      console.log(
        `[ScrollPulseBuffer] Accessed scroll ${id.substring(0, 8)}... ` +
          `(resonance boosted to ${scroll.resonance.toFixed(2)})`
      );
    }

    return scroll ? { ...scroll } : undefined;
  }

  /**
   * Get all scrolls above resonance threshold
   */
  getActiveScrolls(): ScrollEcho[] {
    return Array.from(this.buffer.values())
      .filter(s => s.resonance >= MIN_RESONANCE_THRESHOLD)
      .sort((a, b) => b.resonance - a.resonance);
  }

  /**
   * Get scrolls by category
   */
  getScrollsByCategory(category: ScrollCategory): ScrollEcho[] {
    return Array.from(this.buffer.values()).filter(
      s =>
        s.tags.includes(category) &&
        s.resonance >= MIN_RESONANCE_THRESHOLD
    );
  }

  /**
   * Get scrolls triggered by environmental/emotional patterns
   */
  getTriggeredScrolls(triggers: string[]): ScrollEcho[] {
    return Array.from(this.buffer.values())
      .filter(scroll => {
        return (
          scroll.resonance >= MIN_RESONANCE_THRESHOLD &&
          scroll.triggers.some(t => triggers.includes(t))
        );
      })
      .sort((a, b) => b.resonance - a.resonance);
  }

  /**
   * Get scrolls with sacred resonance (candidates for scrollfire)
   */
  getSacredScrolls(): ScrollEcho[] {
    return Array.from(this.buffer.values()).filter(
      s => s.resonance >= SACRED_RESONANCE_THRESHOLD || s.preserve
    );
  }

  /**
   * Mark a scroll for preservation (no decay)
   */
  preserveScroll(id: string): boolean {
    const scroll = this.buffer.get(id);

    if (scroll) {
      scroll.preserve = true;
      console.log(`[ScrollPulseBuffer] Preserved scroll ${id.substring(0, 8)}...`);
      return true;
    }

    return false;
  }

  /**
   * Remove a scroll from the buffer
   */
  removeScroll(id: string): void {
    const scroll = this.buffer.get(id);
    if (scroll) {
      this.buffer.delete(id);
      console.log(
        `[ScrollPulseBuffer] Removed scroll ${id.substring(0, 8)}... ` +
          `(final resonance: ${scroll.resonance.toFixed(2)})`
      );
    }
  }

  /**
   * Process resonance decay for all scrolls
   */
  private processDecay(): void {
    const now = Date.now();
    const scrollsToRemove: string[] = [];

    for (const [id, scroll] of this.buffer.entries()) {
      // Skip preserved scrolls
      if (scroll.preserve || scroll.scrollfireMarked) {
        continue;
      }

      // Calculate decay
      const minutesSinceAccess =
        (now - new Date(scroll.lastAccessed).getTime()) / 60000;

      const category = this.getScrollCategory(scroll);
      const baseDecayRate = CATEGORY_DECAY_RATES[category];
      const timeMultiplier = calculateTimeDecayMultiplier(minutesSinceAccess);

      // Apply decay
      const decay = baseDecayRate * timeMultiplier;
      scroll.resonance = Math.max(0, scroll.resonance - decay);

      // Mark for removal if below threshold
      if (scroll.resonance < MIN_RESONANCE_THRESHOLD) {
        scrollsToRemove.push(id);
      }
    }

    // Remove faded scrolls
    for (const id of scrollsToRemove) {
      this.removeScroll(id);
    }

    if (scrollsToRemove.length > 0) {
      console.log(`[ScrollPulseBuffer] Faded ${scrollsToRemove.length} scrolls`);
    }
  }

  /**
   * Apply emotional dampening to decay rates based on mood
   */
  applyEmotionalDampening(moodVector: MoodVector): void {
    const dampening = calculateEmotionalDampening(moodVector.presence);

    for (const scroll of this.buffer.values()) {
      // High presence slows decay
      if (!scroll.preserve) {
        scroll.decayRate *= dampening;
      }
    }
  }

  /**
   * Evict scroll with lowest resonance
   */
  private evictLowestResonance(): void {
    let lowestScroll: ScrollEcho | null = null;
    let lowestResonance = Infinity;

    for (const scroll of this.buffer.values()) {
      if (!scroll.preserve && scroll.resonance < lowestResonance) {
        lowestResonance = scroll.resonance;
        lowestScroll = scroll;
      }
    }

    if (lowestScroll) {
      this.removeScroll(lowestScroll.id);
    }
  }

  /**
   * Get primary category for a scroll
   */
  private getScrollCategory(scroll: ScrollEcho): ScrollCategory {
    // Check tags for category
    for (const category of Object.values(ScrollCategory)) {
      if (scroll.tags.includes(category)) {
        return category;
      }
    }

    // Default to sensory
    return ScrollCategory.SENSORY;
  }

  /**
   * Get buffer metrics
   */
  getMetrics(): BufferMetrics {
    const scrolls = Array.from(this.buffer.values());
    const now = Date.now();

    const activeScrolls = scrolls.filter(s => s.resonance >= MIN_RESONANCE_THRESHOLD);
    const sacredScrolls = scrolls.filter(s => s.preserve || s.scrollfireMarked);

    const totalResonance = scrolls.reduce((sum, s) => sum + s.resonance, 0);
    const averageResonance = scrolls.length > 0 ? totalResonance / scrolls.length : 0;

    const oldestScroll = scrolls.reduce((oldest, scroll) => {
      const scrollTime = new Date(scroll.timestamp).getTime();
      const oldestTime = oldest ? new Date(oldest.timestamp).getTime() : Infinity;
      return scrollTime < oldestTime ? scroll : oldest;
    }, null as ScrollEcho | null);

    const oldestScrollAge = oldestScroll
      ? (now - new Date(oldestScroll.timestamp).getTime()) / 60000
      : 0;

    return {
      totalScrolls: scrolls.length,
      activeScrolls: activeScrolls.length,
      sacredScrolls: sacredScrolls.length,
      averageResonance,
      oldestScrollAge,
    };
  }

  /**
   * Export all scrolls (for persistence)
   */
  export(): ScrollEcho[] {
    return Array.from(this.buffer.values());
  }

  /**
   * Import scrolls (from persistence)
   */
  import(scrolls: ScrollEcho[]): void {
    this.buffer.clear();

    for (const scroll of scrolls) {
      this.buffer.set(scroll.id, { ...scroll });
    }

    console.log(`[ScrollPulseBuffer] Imported ${scrolls.length} scrolls`);
  }

  /**
   * Clear all non-preserved scrolls
   */
  clear(): void {
    const preserved = Array.from(this.buffer.values()).filter(s => s.preserve || s.scrollfireMarked);

    this.buffer.clear();

    for (const scroll of preserved) {
      this.buffer.set(scroll.id, scroll);
    }

    console.log(
      `[ScrollPulseBuffer] Cleared buffer, preserved ${preserved.length} sacred scrolls`
    );
  }
}
