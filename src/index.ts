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
export * from './loop';

// Memory
export { ScrollPulseBuffer } from './memory/scrollPulseBuffer';
export type { BufferMetrics } from './memory/scrollPulseBuffer';

export { ScrollPulseMemory } from './memory/scrollPulseMemory';
export type { MemoryQuery, MemoryInsight } from './memory/scrollPulseMemory';

// Affect (Emotional State & Guardian)
export * from './affect';

// Express (Voice & Output)
export * from './express';

// Vision (Sensory Input)
export * from './vision';

// Learning (Adaptation)
export * from './learning';

// Persistence (Session Continuity)
export * from './persistence';

// Constants
export * from './constants/breathTiming';
export * from './constants/decayRates';
