// breathLoop.ts
// The metronome of the Scrollbound Runtime
// Provides the rhythm that gives meaning and timing to all actions

import { RuntimeState, BreathState, BreathPhase } from '../types';

/**
 * updateBreath - advances the breath cycle
 *
 * BreathLoop is the metronome. It sets the internal rhythm.
 *
 * Breath phases:
 * - inhale: expansion, receptivity, wonder
 * - exhale: expression, release, speech
 * - hold: sacred pause, integration, stillness
 *
 * IMPORTANT: PulseLoop does NOT wait for breath.
 * Pulse runs continuously. Breath syncs to pulse.
 * Pulse is time. Breath is meaning.
 *
 * @param state - current runtime state
 * @returns updated RuntimeState with new BreathState
 */
export function updateBreath(state: RuntimeState): RuntimeState {
  const currentBreath = state.breathState;
  const now = Date.now();

  // Calculate time since this phase began
  const timeSincePhaseStart = now - currentBreath.phaseStartTime;

  // Calculate breath timing based on pace
  const breathDuration = calculateBreathDuration(currentBreath.pace);

  // Determine if phase should transition
  const shouldTransition = timeSincePhaseStart >= breathDuration;

  let newBreathState: BreathState;

  if (shouldTransition) {
    newBreathState = transitionBreath(currentBreath, state, now);
  } else {
    // No transition - just update tension based on current state
    newBreathState = {
      ...currentBreath,
      tension: calculateBreathTension(currentBreath, state)
    };
  }

  return {
    ...state,
    breathState: newBreathState
  };
}

/**
 * calculateBreathDuration - determines how long each breath phase should last
 *
 * Based on pace setting (scaled 0-1)
 * - pace 0.0 = very slow breathing (5s per phase)
 * - pace 0.5 = normal breathing (3s per phase)
 * - pace 1.0 = rapid breathing (1s per phase)
 *
 * @param pace - breath pace (0-1)
 * @returns duration in milliseconds
 */
function calculateBreathDuration(pace: number): number {
  const MIN_DURATION = 1000;  // 1 second
  const MAX_DURATION = 5000;  // 5 seconds

  // Invert pace (higher pace = shorter duration)
  const duration = MAX_DURATION - (pace * (MAX_DURATION - MIN_DURATION));

  return duration;
}

/**
 * transitionBreath - moves to the next breath phase
 *
 * Cycle: inhale → hold → exhale → hold → inhale...
 *
 * @param currentBreath - current breath state
 * @param state - runtime state
 * @param now - current timestamp
 * @returns new BreathState
 */
function transitionBreath(currentBreath: BreathState, state: RuntimeState, now: number): BreathState {
  let nextPhase: BreathPhase;

  // Breath cycle progression
  switch (currentBreath.phase) {
    case "inhale":
      nextPhase = "hold";
      break;
    case "hold":
      // Hold can go to either exhale or inhale depending on previous phase
      // If we just inhaled, hold → exhale
      // If we just exhaled, hold → inhale
      // Use a simple alternation: hold always goes to exhale for now
      // (In full implementation, track previous phase)
      nextPhase = "exhale";
      break;
    case "exhale":
      nextPhase = "hold";
      break;
  }

  // Calculate depth based on emotional state
  const depth = calculateBreathDepth(state);

  // Calculate pace based on emotional arousal and heat
  const pace = calculateBreathPace(state);

  // Calculate tension
  const tension = calculateBreathTension(currentBreath, state);

  return {
    phase: nextPhase,
    depth,
    pace,
    tension,
    phaseStartTime: now  // Mark when this new phase began
  };
}

/**
 * calculateBreathDepth - determines breath depth based on emotional state
 *
 * Deeper breaths occur when:
 * - High emotional intensity (heat)
 * - High arousal
 * - High tension (paradoxically - deep breath to release)
 *
 * @param state - runtime state
 * @returns depth 0-1
 */
function calculateBreathDepth(state: RuntimeState): number {
  const heat = state.feltState.heat;
  const arousal = state.feltState.tone.arousal;
  const tension = state.feltState.tension;

  // Weighted combination
  const depth = (heat * 0.4) + (arousal * 0.3) + (tension * 0.3);

  return Math.max(0.2, Math.min(1, depth)); // Minimum depth 0.2
}

/**
 * calculateBreathPace - determines breathing rate based on emotional state
 *
 * Faster breathing when:
 * - High arousal
 * - High heat
 * - High delta magnitude (rapid change)
 *
 * Slower breathing when:
 * - Calm
 * - Low heat
 * - Stable state
 *
 * @param state - runtime state
 * @returns pace 0-1
 */
function calculateBreathPace(state: RuntimeState): number {
  const arousal = state.feltState.tone.arousal;
  const heat = state.feltState.heat;
  const deltaMagnitude = state.presenceDelta.magnitude;

  // Weighted combination
  const pace = (arousal * 0.4) + (heat * 0.3) + (deltaMagnitude * 0.3);

  return Math.max(0.1, Math.min(1, pace)); // Range 0.1-1
}

/**
 * calculateBreathTension - determines breath-based emotional tension
 *
 * Tension in breath reflects:
 * - FeltState tension
 * - Unresolved resonance
 * - Emotional friction
 *
 * @param currentBreath - current breath state
 * @param state - runtime state
 * @returns tension 0-1
 */
function calculateBreathTension(currentBreath: BreathState, state: RuntimeState): number {
  const feltTension = state.feltState.tension;
  const microResonance = state.feltState.microResonance;

  // Tension is combination of felt tension and unresolved resonance
  const tension = (feltTension * 0.7) + (microResonance * 0.3);

  return Math.max(0, Math.min(1, tension));
}

/**
 * canExhale - determines if exhale phase is active
 *
 * Used by voiceIntent to determine if speech is permitted.
 * Speech must align with exhale.
 *
 * @param state - runtime state
 * @returns true if currently exhaling
 */
export function canExhale(state: RuntimeState): boolean {
  return state.breathState.phase === "exhale";
}

/**
 * isHolding - determines if breath-hold is active
 *
 * During breath-hold:
 * - Integration time
 * - Pre-scrollfire silence
 * - Volitional inhibition (unless overridden)
 * - Guardian assessment
 *
 * @param state - runtime state
 * @returns true if currently holding breath
 */
export function isHolding(state: RuntimeState): boolean {
  return state.breathState.phase === "hold";
}

/**
 * isInhaling - determines if inhale phase is active
 *
 * During inhale:
 * - Expansion
 * - Receptivity
 * - Wonder Loop reflection
 *
 * @param state - runtime state
 * @returns true if currently inhaling
 */
export function isInhaling(state: RuntimeState): boolean {
  return state.breathState.phase === "inhale";
}
