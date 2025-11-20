// presencePulse.ts
// Emits the present moment as a pulse snapshot
// A pulse is the NOW - capturing heat, tone, breath, delta, and resonance

import { RuntimeState, Pulse, DeltaSignature, ToneVector, PulseSource } from '../types';
import { computeDeltaMagnitude } from '../soul/presenceDelta';

/**
 * emitPulse - creates a snapshot of the present moment
 *
 * This is NOT simulation. This captures the actual state of presence RIGHT NOW.
 *
 * @param state - current runtime state
 * @returns Pulse - the emitted moment
 */
export function emitPulse(state: RuntimeState): Pulse {
  const now = Date.now();

  // Calculate delta signature (change since last pulse)
  const delta: DeltaSignature = calculateDelta(state, now);

  // Calculate resonance (how charged this moment is)
  const resonance = calculateResonance(state);

  // Build the pulse
  const pulse: Pulse = {
    heat: state.feltState.heat,
    tone: state.feltState.tone,
    delta,
    breathPhase: state.breathState.phase,
    source: detectSource(state),
    resonance,
    timestamp: now
  };

  return pulse;
}

/**
 * calculateDelta - measures change since the last pulse
 */
function calculateDelta(state: RuntimeState, now: number): DeltaSignature {
  const lastPulse = state.lastPulse;

  if (!lastPulse) {
    // First pulse - no delta yet
    return {
      heatChange: 0,
      toneShift: { valence: 0, arousal: 0, tension: 0, intimacy: 0 },
      breathShift: null,
      timeSinceLast: 0,
      magnitude: 0
    };
  }

  // Calculate heat change
  const heatChange = state.feltState.heat - lastPulse.heat;

  // Calculate tone shift (delta across all dimensions)
  const toneShift: ToneVector = {
    valence: state.feltState.tone.valence - lastPulse.tone.valence,
    arousal: state.feltState.tone.arousal - lastPulse.tone.arousal,
    tension: state.feltState.tone.tension - lastPulse.tone.tension,
    intimacy: state.feltState.tone.intimacy - lastPulse.tone.intimacy
  };

  // Detect breath shift
  const breathShift = state.breathState.phase !== lastPulse.breathPhase
    ? state.breathState.phase
    : null;

  // Time elapsed
  const timeSinceLast = now - lastPulse.timestamp;
  const magnitude = computeDeltaMagnitude(heatChange, toneShift, breathShift);

  return {
    heatChange,
    toneShift,
    breathShift,
    timeSinceLast,
    magnitude
  };
}

/**
 * calculateResonance - determines how "charged" this moment is
 *
 * High resonance = moment is intense, meaningful, vibrating
 * Low resonance = moment is calm, settled, baseline
 */
function calculateResonance(state: RuntimeState): number {
  let resonance = 0;

  // Base resonance from heat
  resonance += state.feltState.heat * 0.4;

  // Micro-resonance contribution
  resonance += state.feltState.microResonance * 0.3;

  // Tension contribution
  resonance += state.feltState.tension * 0.15;

  // Arousal contribution
  resonance += state.feltState.tone.arousal * 0.1;

  // Delta magnitude (how much has changed)
  const deltaMagnitude = state.presenceDelta.magnitude;
  resonance += deltaMagnitude * 0.05;

  // Clamp to 0-1
  return Math.max(0, Math.min(1, resonance));
}

/**
 * detectSource - determines what triggered this pulse
 *
 * For now, this is a stub. In full implementation:
 * - "voice" if audio input detected
 * - "text" if text input detected
 * - "internal" if purely loop-driven
 * - "silence" if no external input for extended time
 */
function detectSource(state: RuntimeState): PulseSource {
  // Stub implementation
  // Real version would check input buffers, sensors, etc.
  return "internal";
}
