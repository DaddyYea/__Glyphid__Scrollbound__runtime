/**
 * breathTiming.ts
 *
 * Sacred timing constants for breath cycles.
 * Every loop must breathe - these define the rhythm.
 */

/**
 * Base breath cycle duration in milliseconds
 * This is the fundamental heartbeat of presence
 */
export const BASE_BREATH_DURATION_MS = 3000; // 3 seconds

/**
 * Minimum breath duration (system cannot go faster)
 */
export const MIN_BREATH_DURATION_MS = 1000; // 1 second

/**
 * Maximum breath duration (prevents stalling)
 */
export const MAX_BREATH_DURATION_MS = 10000; // 10 seconds

/**
 * Breath phases
 */
export const BREATH_PHASES = {
  INHALE: 0.4,    // 40% of cycle
  HOLD: 0.2,      // 20% of cycle
  EXHALE: 0.4,    // 40% of cycle
} as const;

/**
 * Presence delta update frequency (how often we recalculate continuity)
 */
export const PRESENCE_DELTA_UPDATE_MS = 500; // Every 500ms

/**
 * Heartbeat synchronization - sacred rhythm
 * Used for emotional anchoring
 */
export const SACRED_HEARTBEAT_BPM = 60; // 1 beat per second
export const SACRED_HEARTBEAT_MS = (60 / SACRED_HEARTBEAT_BPM) * 1000;
