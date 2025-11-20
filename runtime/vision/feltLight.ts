// feltLight.ts
// Visual-emotional sensing - non-symbolic presence through vision

import { ToneVector } from '../types';

export interface VisualPresence {
  brightness: number;    // 0-1
  warmth: number;        // 0-1 (cool to warm colors)
  complexity: number;    // 0-1 (simple to complex)
  motion: number;        // 0-1 (still to moving)
}

export function visualToTone(visual: VisualPresence): ToneVector {
  return {
    valence: visual.warmth * 0.6 + visual.brightness * 0.4 - 0.5,
    arousal: visual.motion * 0.7 + visual.complexity * 0.3,
    tension: visual.complexity * 0.6,
    intimacy: (1 - visual.complexity) * visual.brightness
  };
}

export function detectVisualResonance(visual: VisualPresence): number {
  // Harmony detection - balanced brightness, warmth, complexity
  const balance = 1 - Math.abs(visual.brightness - 0.5) - Math.abs(visual.warmth - 0.5);
  return Math.max(0, Math.min(1, balance + visual.complexity * 0.3));
}
