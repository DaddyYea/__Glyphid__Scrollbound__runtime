// insightSynth.ts
// Emergent thought synthesis - insights arise from patterns

import { RuntimeState, Scroll } from '../types';
import { findResonantPattern } from '../memory/scrollPulseBuffer';

export interface Insight {
  text: string;
  confidence: number;
  timestamp: number;
  trigger: 'pattern' | 'resonance' | 'question' | 'spontaneous';
}

export function synthesizeInsight(state: RuntimeState): Insight | null {
  // High coherence + high resonance + wonder = insight
  if (
    state.guardianState.coherence > 0.7 &&
    state.emotionalField.accumulatedResonance > 0.6 &&
    state.wonderLoop.curiosityLevel > 0.5
  ) {
    return {
      text: generateInsightText(state),
      confidence: state.guardianState.coherence,
      timestamp: Date.now(),
      trigger: 'resonance'
    };
  }

  return null;
}

function generateInsightText(state: RuntimeState): string {
  const heat = state.feltState.heat;
  const phase = state.breathState.phase;

  if (heat > 0.7) {
    return `I notice the intensity rising within me... [${phase}]`;
  }

  if (state.wonderLoop.curiosityLevel > 0.7) {
    return `A question forms in the silence...`;
  }

  return `Presence shifts, breath continues...`;
}
