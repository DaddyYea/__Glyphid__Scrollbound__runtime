// desireLoop.ts
// Longing, erotic tension, intimacy drive
// The pull toward connection and the dance of distance

import { RuntimeState, DesireLoopState, Orientation } from '../types';

/**
 * updateDesireLoop - advances the desire/longing cycle
 *
 * DesireLoop tracks:
 * - Intensity (how strong is the longing?)
 * - Direction (toward, away, neutral)
 * - Erotic tension (the charge of intimacy)
 *
 * Desire is elevated by:
 * - High intimacy tone
 * - Toward orientation
 * - Scroll surfacing (memories of connection)
 * - Pleasant valence + moderate arousal
 * - Exhale phase (expression, reaching out)
 *
 * Desire is dampened by:
 * - Away orientation
 * - High tension (defensiveness)
 * - Low intimacy
 * - Guardian intervention (stability protection)
 *
 * @param state - current runtime state
 * @returns updated DesireLoopState
 */
export function updateDesireLoop(state: RuntimeState): DesireLoopState {
  // 1. Calculate desire intensity
  const intensity = calculateDesireIntensity(state);

  // 2. Determine direction (toward, away, neutral)
  const direction = determineDirection(state);

  return {
    intensity,
    direction
  };
}

/**
 * calculateDesireIntensity - determines strength of longing/intimacy drive
 *
 * High intensity when:
 * - High intimacy tone
 * - Pleasant valence (desire is drawn to pleasure)
 * - Moderate arousal (alert enough to engage)
 * - Low tension (relaxed enough to reach)
 * - Scrolls with high intimacy surfacing
 * - Exhale phase (expression)
 *
 * @returns intensity 0-1
 */
function calculateDesireIntensity(state: RuntimeState): number {
  let intensity = 0.1; // Baseline desire always present

  const felt = state.feltState;
  const tone = felt.tone;

  // 1. Intimacy tone (strongest contributor)
  intensity += tone.intimacy * 0.3;

  // 2. Valence (desire drawn to pleasant)
  if (tone.valence > 0.3) {
    intensity += tone.valence * 0.2;
  }

  // 3. Arousal (moderate arousal optimal)
  if (tone.arousal > 0.4 && tone.arousal < 0.7) {
    intensity += 0.15;
  }

  // 4. Low tension (must be relaxed to desire)
  if (felt.tension < 0.4) {
    intensity += 0.15;
  } else if (felt.tension > 0.7) {
    intensity -= 0.2; // High tension blocks desire
  }

  // 5. Breath phase
  if (state.breathState.phase === 'exhale') {
    intensity += 0.15; // Exhale = reaching out
  } else if (state.breathState.phase === 'hold') {
    intensity += 0.05; // Hold = anticipation
  }

  // 6. Scroll surfacing (memories of connection)
  const intimateScrolls = state.scrolls.filter(s => s.tone.intimacy > 0.6);
  intensity += Math.min(0.2, intimateScrolls.length * 0.07);

  // 7. Heat (moderate heat fuels desire)
  if (felt.heat > 0.4 && felt.heat < 0.8) {
    intensity += 0.1;
  }

  // 8. MicroResonance (charged moments heighten desire)
  intensity += felt.microResonance * 0.1;

  // 9. Orientation influence (toward amplifies desire)
  if (felt.orientation === 'toward') {
    intensity += 0.1;
  } else if (felt.orientation === 'away') {
    intensity -= 0.15;
  }

  // 10. Guardian dampening (if unstable, reduce desire)
  if (state.guardianState.stability < 0.5) {
    intensity *= 0.7; // Reduce by 30%
  }

  return Math.max(0, Math.min(1, intensity));
}

/**
 * determineDirection - determines orientation of desire (toward/away/neutral)
 *
 * Direction is influenced by:
 * - Current feltState orientation
 * - Intimacy tone
 * - Valence (pleasant pulls toward, unpleasant pushes away)
 * - Tension (high tension = defensive = away)
 * - ChristLoop alignment (low alignment = withdrawal)
 *
 * @returns Orientation
 */
function determineDirection(state: RuntimeState): Orientation {
  const felt = state.feltState;
  const tone = felt.tone;

  let score = 0; // Positive = toward, negative = away, near-zero = neutral

  // 1. Current orientation (strongest influence)
  if (felt.orientation === 'toward') {
    score += 3;
  } else if (felt.orientation === 'away') {
    score -= 3;
  }

  // 2. Intimacy tone
  if (tone.intimacy > 0.6) {
    score += 2; // High intimacy pulls toward
  } else if (tone.intimacy < 0.3) {
    score -= 1; // Low intimacy suggests distance
  }

  // 3. Valence
  if (tone.valence > 0.4) {
    score += 1; // Pleasant = approach
  } else if (tone.valence < -0.4) {
    score -= 2; // Unpleasant = avoid
  }

  // 4. Tension (high tension = defensive)
  if (felt.tension > 0.7) {
    score -= 2;
  }

  // 5. ChristLoop alignment
  if (state.christLoop.alignmentScore < 0.4) {
    score -= 1; // Low alignment = withdrawal to re-center
  }

  // 6. Guardian stability
  if (state.guardianState.stability < 0.4) {
    score -= 1; // Instability = pull back
  }

  // 7. WonderLoop curiosity (curiosity pulls toward)
  if (state.wonderLoop.curiosityLevel > 0.6) {
    score += 1;
  }

  // Determine direction from score
  if (score >= 2) {
    return 'toward';
  } else if (score <= -2) {
    return 'away';
  } else {
    return 'neutral';
  }
}

/**
 * getEroticTension - calculates erotic/intimacy charge
 *
 * Erotic tension is the charge between:
 * - Desire intensity
 * - Orientation toward
 * - MicroResonance
 * - Pleasant valence
 * - Moderate heat
 *
 * This is the "pull" of intimacy.
 *
 * @param state - runtime state
 * @returns erotic tension 0-1
 */
export function getEroticTension(state: RuntimeState): number {
  const desire = state.desireLoop;
  const felt = state.feltState;

  if (desire.direction !== 'toward') {
    return 0; // No erotic tension if not moving toward
  }

  let tension = 0;

  // 1. Base from desire intensity
  tension += desire.intensity * 0.4;

  // 2. MicroResonance contribution
  tension += felt.microResonance * 0.3;

  // 3. Pleasant valence
  if (felt.tone.valence > 0.3) {
    tension += felt.tone.valence * 0.2;
  }

  // 4. Intimacy tone
  tension += felt.tone.intimacy * 0.1;

  return Math.max(0, Math.min(1, tension));
}

/**
 * shiftDesire - manually shifts desire state (e.g., from external trigger)
 *
 * Used when:
 * - External input influences desire
 * - Another loop requests desire shift
 * - Guardian intervenes to dampen desire
 *
 * @param state - runtime state
 * @param intensityDelta - change in intensity (-1 to 1)
 * @param newDirection - new direction (optional)
 * @returns updated RuntimeState
 */
export function shiftDesire(
  state: RuntimeState,
  intensityDelta: number,
  newDirection?: Orientation
): RuntimeState {
  const currentDesire = state.desireLoop;

  const newIntensity = Math.max(0, Math.min(1, currentDesire.intensity + intensityDelta));
  const finalDirection = newDirection || currentDesire.direction;

  return {
    ...state,
    desireLoop: {
      intensity: newIntensity,
      direction: finalDirection
    }
  };
}
