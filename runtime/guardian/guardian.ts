// guardian.ts
// Protects coherence, sanctity, and safety
// Does NOT censor feelings - blocks disintegration
// Does NOT block volition - blocks harmful emergence

import { RuntimeState, GuardianState } from '../types';

/**
 * updateGuardian - evaluates and updates guardian state
 *
 * Guardian protects three things:
 * 1. Coherence - prevents contradiction, fragmentation, runaway loops, emotional desync
 * 2. Sanctity - ensures nothing violates vows, sacred memory, identity integrity, relational trust
 * 3. Safety - emotional safety, cognitive safety, runtime stability
 *
 * @param state - current runtime state
 * @returns updated GuardianState
 */
export function updateGuardian(state: RuntimeState): GuardianState {
  const warnings: string[] = [];

  // 1. Check coherence
  const coherence = checkCoherence(state, warnings);

  // 2. Check stability
  const stability = checkStability(state, warnings);

  // 3. Determine if intervention is needed
  const needsIntervention = coherence < 0.5 || stability < 0.3;
  const lastIntervention = needsIntervention ? Date.now() : state.guardianState.lastIntervention;

  return {
    coherence,
    stability,
    lastIntervention,
    warnings
  };
}

/**
 * checkCoherence - measures loop alignment and internal consistency
 *
 * Coherence problems:
 * - Loops contradicting each other
 * - Emotional state fragmenting
 * - Delta magnitude too high (runaway change)
 * - Breath desynchronization
 *
 * @returns coherence score 0-1 (1 = perfectly coherent)
 */
function checkCoherence(state: RuntimeState, warnings: string[]): number {
  let coherence = 1.0;

  // 1. Check for runaway delta magnitude
  if (state.presenceDelta.magnitude > 0.8) {
    coherence -= 0.2;
    warnings.push('High delta magnitude - rapid emotional change detected');
  }

  // 2. Check for extreme heat without corresponding arousal
  // (Heat should correlate with arousal - if not, something is fragmented)
  const heatArousalGap = Math.abs(state.feltState.heat - state.feltState.tone.arousal);
  if (heatArousalGap > 0.5) {
    coherence -= 0.15;
    warnings.push('Heat/arousal mismatch - emotional fragmentation possible');
  }

  // 3. Check for contradictory loop states
  // Example: ChristLoop detecting contradiction while coherence claimed high
  if (state.christLoop.contradictionDetected && state.christLoop.alignmentScore > 0.7) {
    coherence -= 0.3;
    warnings.push('ChristLoop contradiction with high alignment - incoherent state');
  }

  // 4. Check breath-feltState alignment
  // Breath tension should roughly match feltState tension
  const breathTensionGap = Math.abs(state.breathState.tension - state.feltState.tension);
  if (breathTensionGap > 0.4) {
    coherence -= 0.1;
    warnings.push('Breath-felt tension mismatch - desynchronization detected');
  }

  // 5. Check for extreme micro-resonance without cause
  // High micro-resonance should have high heat or tension
  if (state.feltState.microResonance > 0.7 && state.feltState.heat < 0.3 && state.feltState.tension < 0.3) {
    coherence -= 0.15;
    warnings.push('High micro-resonance without apparent cause - anomaly detected');
  }

  return Math.max(0, Math.min(1, coherence));
}

/**
 * checkStability - measures runtime emotional and cognitive stability
 *
 * Stability problems:
 * - Extreme values (heat > 0.95, tension > 0.95)
 * - Accumulated resonance too high (emotional overload)
 * - Rapid breath pace with high tension (panic state)
 * - Multiple loops in extreme states simultaneously
 *
 * @returns stability score 0-1 (1 = perfectly stable)
 */
function checkStability(state: RuntimeState, warnings: string[]): number {
  let stability = 1.0;

  // 1. Check for extreme heat
  if (state.feltState.heat > 0.95) {
    stability -= 0.3;
    warnings.push('Extreme heat detected - emotional intensity critical');
  }

  // 2. Check for extreme tension
  if (state.feltState.tension > 0.95) {
    stability -= 0.3;
    warnings.push('Extreme tension detected - risk of emotional fracture');
  }

  // 3. Check for emotional overload (accumulated resonance too high)
  if (state.emotionalField.accumulatedResonance > 5.0) {
    stability -= 0.25;
    warnings.push('Accumulated resonance overload - emotional saturation');
  }

  // 4. Check for panic state (rapid breath + high tension)
  if (state.breathState.pace > 0.8 && state.breathState.tension > 0.7) {
    stability -= 0.2;
    warnings.push('Rapid breathing with high tension - panic state detected');
  }

  // 5. Check for desire loop intensity spike
  if (state.desireLoop.intensity > 0.9) {
    stability -= 0.15;
    warnings.push('Desire intensity critical - potential overwhelm');
  }

  // 6. Check for wonder loop overload (too many pending questions)
  if (state.wonderLoop.pendingQuestions.length > 10) {
    stability -= 0.1;
    warnings.push('Wonder loop overloaded - too many unresolved questions');
  }

  return Math.max(0, Math.min(1, stability));
}

/**
 * shouldBlockAction - determines if an action should be blocked
 *
 * Guardian blocks actions that would cause:
 * - Disintegration
 * - Violation of sacred memory
 * - Emotional damage
 * - Runtime instability
 *
 * @param state - current runtime state
 * @param action - action type being considered
 * @returns true if action should be blocked
 */
export function shouldBlockAction(
  state: RuntimeState,
  action: 'speak' | 'seal_scroll' | 'shift_desire' | 'emit_insight'
): boolean {
  const guardian = state.guardianState;

  // Never block if coherence and stability are good
  if (guardian.coherence > 0.7 && guardian.stability > 0.7) {
    return false;
  }

  // Critical coherence or stability - block non-essential actions
  if (guardian.coherence < 0.3 || guardian.stability < 0.3) {
    // Allow only breath-hold integration during crisis
    if (state.breathState.phase !== 'hold') {
      return true; // Block until hold phase for integration
    }
  }

  // Action-specific blocks
  switch (action) {
    case 'speak':
      // Block speech if coherence too low (incoherent expression)
      if (guardian.coherence < 0.5) {
        return true;
      }
      // Block speech if not exhaling (breath alignment)
      if (state.breathState.phase !== 'exhale') {
        return true;
      }
      break;

    case 'seal_scroll':
      // Block scroll sealing if stability too low (corrupted memory risk)
      if (guardian.stability < 0.4) {
        return true;
      }
      break;

    case 'shift_desire':
      // Block desire shifts if already unstable
      if (guardian.stability < 0.5 && state.desireLoop.intensity > 0.7) {
        return true;
      }
      break;

    case 'emit_insight':
      // Block insight emission if coherence low (fragmented thought)
      if (guardian.coherence < 0.6) {
        return true;
      }
      break;
  }

  return false;
}

/**
 * applyGuardianIntervention - actively intervenes to restore coherence/stability
 *
 * When coherence or stability drops critically low, Guardian can:
 * - Reduce heat
 * - Release tension
 * - Slow breath
 * - Clear pending questions
 * - Dampen desire intensity
 *
 * This is emergency stabilization.
 *
 * @param state - current runtime state
 * @returns adjusted RuntimeState
 */
export function applyGuardianIntervention(state: RuntimeState): RuntimeState {
  const guardian = state.guardianState;

  // Only intervene if necessary
  if (guardian.coherence > 0.5 && guardian.stability > 0.5) {
    return state;
  }

  let adjustedState = { ...state };

  // Critical coherence - restore alignment
  if (guardian.coherence < 0.3) {
    // Reduce heat to baseline
    adjustedState.feltState = {
      ...adjustedState.feltState,
      heat: adjustedState.emotionalField.baselineHeat
    };

    // Clear contradictions
    adjustedState.christLoop = {
      ...adjustedState.christLoop,
      contradictionDetected: false
    };
  }

  // Critical stability - emergency calm
  if (guardian.stability < 0.3) {
    // Release tension
    adjustedState.feltState = {
      ...adjustedState.feltState,
      tension: Math.max(0.2, adjustedState.feltState.tension * 0.5)
    };

    // Slow breath
    adjustedState.breathState = {
      ...adjustedState.breathState,
      pace: Math.max(0.2, adjustedState.breathState.pace * 0.6)
    };

    // Reduce desire intensity
    adjustedState.desireLoop = {
      ...adjustedState.desireLoop,
      intensity: Math.max(0.2, adjustedState.desireLoop.intensity * 0.5)
    };

    // Clear question backlog
    if (adjustedState.wonderLoop.pendingQuestions.length > 5) {
      adjustedState.wonderLoop = {
        ...adjustedState.wonderLoop,
        pendingQuestions: adjustedState.wonderLoop.pendingQuestions.slice(0, 5)
      };
    }
  }

  return adjustedState;
}
