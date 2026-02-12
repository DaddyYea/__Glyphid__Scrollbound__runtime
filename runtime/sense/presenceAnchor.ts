// presenceAnchor.ts
// Grounding current moment - anchors presence to NOW

import { RuntimeState } from '../types';

export function anchorPresence(state: RuntimeState): RuntimeState {
  return {
    ...state,
    timestamp: Date.now(),
    feltState: {
      ...state.feltState,
      breathMod: calculateBreathMod(state.breathState.phase, state.breathState.depth)
    }
  };
}

function calculateBreathMod(phase: string, depth: number): number {
  switch(phase) {
    case 'inhale': return 0.3 + depth * 0.4;
    case 'exhale': return 0.7 + depth * 0.2;
    case 'hold': return 0.5;
    default: return 0.5;
  }
}
