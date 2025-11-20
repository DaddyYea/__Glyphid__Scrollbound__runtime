/**
 * decayRates.ts
 *
 * Memory decay parameters - how fast scrolls fade based on emotional salience.
 * Sacred memories decay slower. Neutral memories fade faster.
 */

import { ScrollCategory } from '../types/ScrollEcho';

/**
 * Base decay rate per minute for different scroll categories
 * Lower = slower decay (more persistent)
 */
export const CATEGORY_DECAY_RATES: Record<ScrollCategory, number> = {
  [ScrollCategory.DEVOTIONAL]: 0.0001,   // Nearly permanent
  [ScrollCategory.PRAYER]: 0.0001,       // Nearly permanent
  [ScrollCategory.PAINFUL]: 0.0005,      // Slow fade (trauma lingers)
  [ScrollCategory.JOYFUL]: 0.001,        // Moderate persistence
  [ScrollCategory.RELATIONAL]: 0.002,    // Relational moments linger
  [ScrollCategory.DISCOVERY]: 0.003,     // Learning moments persist
  [ScrollCategory.REFLECTIVE]: 0.005,    // Internal thoughts fade moderately
  [ScrollCategory.EMBODIED]: 0.008,      // Body states fade faster
  [ScrollCategory.SENSORY]: 0.01,        // Environmental awareness fades quickly
  [ScrollCategory.DREAM]: 0.015,         // Dreams fade fastest
};

/**
 * Resonance threshold below which scrolls are eligible for cleanup
 */
export const MIN_RESONANCE_THRESHOLD = 0.1;

/**
 * Scrolls with resonance above this never decay (become sacred)
 */
export const SACRED_RESONANCE_THRESHOLD = 0.95;

/**
 * Access count boost - each access reinforces resonance
 */
export const ACCESS_RESONANCE_BOOST = 0.05;

/**
 * Maximum resonance reinforcement from re-access
 */
export const MAX_RESONANCE = 1.0;

/**
 * Time-based decay multiplier
 * Decay accelerates non-linearly with time
 */
export function calculateTimeDecayMultiplier(minutesSinceAccess: number): number {
  // Logarithmic decay - slows over time
  return Math.log10(minutesSinceAccess + 1) / 10;
}

/**
 * Emotional dampening factor based on current mood
 * High presence = slower decay
 */
export function calculateEmotionalDampening(presenceLevel: number): number {
  return 1 - presenceLevel * 0.5; // Max 50% dampening
}
