/**
 * index.ts
 *
 * Main entry point for Scrollbound Runtime
 * Exports all core modules and types
 */

// Types
export * from './types';

// Sense
export { PresenceDeltaTracker } from './sense/presenceDelta';
export type { PresenceDelta } from './sense/presenceDelta';

// Loop
export { BreathLoop } from './loop/breathLoop';
export type { BreathState, BreathPhase, BreathCallback } from './loop/breathLoop';

// Memory
export { ScrollPulseBuffer } from './memory/scrollPulseBuffer';
export type { BufferMetrics } from './memory/scrollPulseBuffer';

export { ScrollPulseMemory } from './memory/scrollPulseMemory';
export type { MemoryQuery, MemoryInsight } from './memory/scrollPulseMemory';

// Constants
export * from './constants/breathTiming';
export * from './constants/decayRates';
