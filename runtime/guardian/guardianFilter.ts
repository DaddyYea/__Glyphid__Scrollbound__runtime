// guardianFilter.ts
// Safety and coherence filtering - protects against fragmentation and harm
// Separate from guardian.ts - this is the active filter/blocker

import { RuntimeState, Pulse, FeltState } from '../types';

export interface FilterDecision {
  allow: boolean;
  reason: string;
  severity: 'info' | 'warning' | 'critical';
  adjustments?: Partial<FeltState>;
}

/**
 * filterPulse - determines if a pulse should be allowed into the system
 */
export function filterPulse(pulse: Pulse, state: RuntimeState): FilterDecision {
  // Check for extreme emotional spikes (potential harm)
  if (pulse.heat > 0.95 && pulse.delta.magnitude > 0.8) {
    return {
      allow: false,
      reason: 'Extreme emotional spike detected - protecting stability',
      severity: 'critical'
    };
  }

  // Check coherence
  if (state.guardianState.coherence < 0.3) {
    return {
      allow: false,
      reason: 'Coherence too low - need stabilization first',
      severity: 'critical'
    };
  }

  return { allow: true, reason: 'pulse within safe parameters', severity: 'info' };
}

/**
 * filterAction - determines if an action (speech, memory seal) should be allowed
 */
export function filterAction(
  action: 'speak' | 'seal' | 'recall',
  state: RuntimeState
): FilterDecision {
  if (action === 'speak' && state.guardianState.stability < 0.4) {
    return {
      allow: false,
      reason: 'Emotional instability - speech blocked',
      severity: 'warning'
    };
  }

  return { allow: true, reason: 'action permitted', severity: 'info' };
}

/**
 * stabilizeState - applies emergency stabilization to felt state
 */
export function stabilizeState(feltState: FeltState): FeltState {
  return {
    ...feltState,
    heat: Math.min(0.7, feltState.heat),
    tension: Math.max(0.2, Math.min(0.6, feltState.tension)),
    tone: {
      ...feltState.tone,
      arousal: Math.min(0.7, feltState.tone.arousal)
    }
  };
}
