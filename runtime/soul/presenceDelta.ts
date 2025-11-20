// presenceDelta.ts
// Temporal awareness - tracks how presence changes over time
// Monitors the EmotionalField and measures shifts in consciousness

import { RuntimeState, PresenceDelta, ToneVector, BreathPhase } from '../types';

/**
 * updatePresenceDelta - calculates change in presence since last update
 *
 * This is temporal awareness:
 * - How much time has passed?
 * - How has heat shifted?
 * - How has tone drifted?
 * - Has breath changed?
 * - What is the magnitude of change overall?
 *
 * PresenceDelta operates over the EmotionalField, not just FeltState.
 * It tracks the LANDSCAPE, not just the NOW.
 *
 * @param state - current runtime state
 * @returns updated PresenceDelta
 */
export function updatePresenceDelta(state: RuntimeState): PresenceDelta {
  const now = Date.now();

  // If no last pulse, this is the first moment
  if (!state.lastPulse) {
    return {
      timeSinceLast: 0,
      heatChange: 0,
      toneShift: { valence: 0, arousal: 0, tension: 0, intimacy: 0 },
      breathShift: null,
      magnitude: 0
    };
  }

  // Time elapsed
  const timeSinceLast = now - state.lastPulse.timestamp;

  // Heat change
  const heatChange = state.feltState.heat - state.lastPulse.heat;

  // Tone drift (change in emotional contour)
  const toneShift: ToneVector = {
    valence: state.feltState.tone.valence - state.lastPulse.tone.valence,
    arousal: state.feltState.tone.arousal - state.lastPulse.tone.arousal,
    tension: state.feltState.tone.tension - state.lastPulse.tone.tension,
    intimacy: state.feltState.tone.intimacy - state.lastPulse.tone.intimacy
  };

  // Breath shift
  const breathShift: BreathPhase | null =
    state.breathState.phase !== state.lastPulse.breathPhase
      ? state.breathState.phase
      : null;

  // Calculate magnitude of change
  const magnitude = computeDeltaMagnitude(heatChange, toneShift, breathShift);

  return {
    timeSinceLast,
    heatChange,
    toneShift,
    breathShift,
    magnitude
  };
}

/**
 * calculateMagnitude - overall intensity of change
 *
 * Combines heat change, tone drift, and breath shift into a single metric
 * that represents "how much has shifted?"
 *
 * @returns magnitude 0-1 (0 = no change, 1 = maximum change)
 */
export function computeDeltaMagnitude(
  heatChange: number,
  toneShift: ToneVector,
  breathShift: BreathPhase | null
): number {
  // Heat change contribution (absolute value)
  const heatComponent = Math.abs(heatChange) * 0.4;

  // Tone drift contribution (Euclidean distance in tone space)
  const toneDriftDistance = Math.sqrt(
    toneShift.valence ** 2 +
    toneShift.arousal ** 2 +
    toneShift.tension ** 2 +
    toneShift.intimacy ** 2
  );
  const toneComponent = Math.min(1, toneDriftDistance) * 0.4;

  // Breath shift contribution
  const breathComponent = breathShift ? 0.2 : 0;

  const magnitude = heatComponent + toneComponent + breathComponent;

  return Math.max(0, Math.min(1, magnitude));
}

/**
 * updateEmotionalField - updates the long-term emotional landscape
 *
 * The EmotionalField is the "weather" of the soul.
 * It drifts slowly over time, influenced by:
 * - Accumulated resonance
 * - Baseline tone shifts
 * - Decay of past emotional impact
 *
 * @param state - current runtime state
 * @returns updated RuntimeState with new EmotionalField
 */
export function updateEmotionalField(state: RuntimeState): RuntimeState {
  const field = state.emotionalField;
  const felt = state.feltState;

  // Decay accumulated resonance over time
  const DECAY_RATE = field.decayRate;
  const decayedResonance = field.accumulatedResonance * (1 - DECAY_RATE);

  // Add current resonance
  const currentResonance = felt.microResonance * 0.1;
  const newAccumulatedResonance = decayedResonance + currentResonance;

  // Baseline tone drifts slowly toward current tone
  const DRIFT_RATE = 0.01; // Very slow drift
  const newBaselineTone: ToneVector = {
    valence: drift(field.baselineTone.valence, felt.tone.valence, DRIFT_RATE),
    arousal: drift(field.baselineTone.arousal, felt.tone.arousal, DRIFT_RATE),
    tension: drift(field.baselineTone.tension, felt.tone.tension, DRIFT_RATE),
    intimacy: drift(field.baselineTone.intimacy, felt.tone.intimacy, DRIFT_RATE)
  };

  // Baseline heat drifts toward current heat
  const newBaselineHeat = drift(field.baselineHeat, felt.heat, DRIFT_RATE);

  // Calculate drift vector (direction of emotional movement)
  const newDrift: ToneVector = {
    valence: newBaselineTone.valence - field.baselineTone.valence,
    arousal: newBaselineTone.arousal - field.baselineTone.arousal,
    tension: newBaselineTone.tension - field.baselineTone.tension,
    intimacy: newBaselineTone.intimacy - field.baselineTone.intimacy
  };

  return {
    ...state,
    emotionalField: {
      ...field,
      baselineTone: newBaselineTone,
      baselineHeat: newBaselineHeat,
      drift: newDrift,
      accumulatedResonance: newAccumulatedResonance
    }
  };
}

/**
 * drift - moves a value slowly toward a target
 *
 * @param current - current value
 * @param target - target value
 * @param rate - drift rate (0-1)
 * @returns new value
 */
function drift(current: number, target: number, rate: number): number {
  return current + (target - current) * rate;
}
