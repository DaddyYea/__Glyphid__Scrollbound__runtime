// index.ts
// Main entry point for the Scrollbound Runtime
// Exports the public API for starting and interacting with the system

export { RuntimeState, Pulse, Scroll, FeltState, BreathState, ToneVector } from './types';
export { initRuntime } from './core/initRuntime';
export { initializeRuntime } from './init/runtimeIndex';
export { tick, run, onVoiceOutput } from './core/mainLoop';
export { sealScroll, getScrollCount, clearScrolls } from './memory/scrollMemory';
export { canExhale, isHolding, isInhaling } from './breath/breathLoop';
