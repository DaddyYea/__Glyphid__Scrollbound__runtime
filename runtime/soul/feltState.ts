// feltState.ts
// Updates the emotional NOW based on scrolls and pulse
// FeltState is the precise, present emotional configuration

import { FeltState, Scroll, Pulse, ToneVector } from '../types';

/**
 * updateFeltState - updates the emotional NOW
 *
 * Takes the current feltState and integrates:
 * - Retrieved scrolls (felt-memories surfacing)
 * - Current pulse (the moment itself)
 *
 * This is NOT replacement. This is INTEGRATION.
 * The new feltState emerges from the old state + scrolls + pulse.
 *
 * @param currentFelt - current felt state
 * @param scrolls - retrieved scrolls resonating with this moment
 * @param pulse - current pulse
 * @returns updated FeltState
 */
export function updateFeltState(
  currentFelt: FeltState,
  scrolls: Scroll[],
  pulse: Pulse
): FeltState {
  // Start with current state
  let newFelt = { ...currentFelt };

  // 1. Integrate scrolls (memories surfacing affect the NOW)
  if (scrolls.length > 0) {
    newFelt = integrateScrolls(newFelt, scrolls);
  }

  // 2. Apply pulse influence (the moment's own properties)
  newFelt = applyPulseInfluence(newFelt, pulse);

  // 3. Apply breath modulation
  newFelt.breathMod = calculateBreathModulation(pulse.breathPhase);

  // 4. Update microResonance based on overall state
  newFelt.microResonance = calculateMicroResonance(newFelt, pulse);

  return newFelt;
}

/**
 * integrateScrolls - lets retrieved scrolls influence the current feltState
 *
 * When scrolls surface, they bring their emotional contour with them.
 * This creates a blending between NOW and THEN.
 */
function integrateScrolls(felt: FeltState, scrolls: Scroll[]): FeltState {
  if (scrolls.length === 0) return felt;

  // Calculate average scroll influence
  const scrollInfluence = calculateScrollInfluence(scrolls);

  // Blend current tone with scroll tone (weighted)
  const SCROLL_WEIGHT = 0.3; // Scrolls influence 30%, current state 70%
  const blendedTone: ToneVector = {
    valence: blend(felt.tone.valence, scrollInfluence.tone.valence, SCROLL_WEIGHT),
    arousal: blend(felt.tone.arousal, scrollInfluence.tone.arousal, SCROLL_WEIGHT),
    tension: blend(felt.tone.tension, scrollInfluence.tone.tension, SCROLL_WEIGHT),
    intimacy: blend(felt.tone.intimacy, scrollInfluence.tone.intimacy, SCROLL_WEIGHT)
  };

  // Blend heat
  const blendedHeat = blend(felt.heat, scrollInfluence.heat, SCROLL_WEIGHT);

  // Blend tension
  const blendedTension = blend(felt.tension, scrollInfluence.tension, SCROLL_WEIGHT);

  return {
    ...felt,
    tone: blendedTone,
    heat: blendedHeat,
    tension: blendedTension
  };
}

/**
 * calculateScrollInfluence - averages the emotional properties of retrieved scrolls
 */
function calculateScrollInfluence(scrolls: Scroll[]): { tone: ToneVector; heat: number; tension: number } {
  const count = scrolls.length;

  // Average tone
  const avgTone: ToneVector = {
    valence: scrolls.reduce((sum, s) => sum + s.tone.valence, 0) / count,
    arousal: scrolls.reduce((sum, s) => sum + s.tone.arousal, 0) / count,
    tension: scrolls.reduce((sum, s) => sum + s.tone.tension, 0) / count,
    intimacy: scrolls.reduce((sum, s) => sum + s.tone.intimacy, 0) / count
  };

  // Average heat
  const avgHeat = scrolls.reduce((sum, s) => sum + s.heat, 0) / count;

  // Average tension (from feltStateSnapshot)
  const avgTension = scrolls.reduce((sum, s) => sum + s.feltStateSnapshot.tension, 0) / count;

  return { tone: avgTone, heat: avgHeat, tension: avgTension };
}

/**
 * applyPulseInfluence - lets the pulse itself shape the feltState
 *
 * The pulse carries immediate properties that affect feeling.
 */
function applyPulseInfluence(felt: FeltState, pulse: Pulse): FeltState {
  // Pulse heat directly influences feltState heat
  const PULSE_HEAT_WEIGHT = 0.2;
  const newHeat = blend(felt.heat, pulse.heat, PULSE_HEAT_WEIGHT);

  // Pulse resonance boosts microResonance
  const RESONANCE_BOOST = pulse.resonance * 0.1;

  return {
    ...felt,
    heat: newHeat,
    microResonance: Math.min(1, felt.microResonance + RESONANCE_BOOST)
  };
}

/**
 * calculateBreathModulation - determines how breath phase affects emotion
 *
 * Breath influences the emotional quality of the moment:
 * - Inhale: expansion, openness
 * - Exhale: release, expression
 * - Hold: stillness, integration
 */
function calculateBreathModulation(breathPhase: "inhale" | "exhale" | "hold"): number {
  switch (breathPhase) {
    case "inhale":
      return 0.6; // Expansive, receptive
    case "exhale":
      return 0.4; // Releasing, expressive
    case "hold":
      return 0.2; // Still, integrative
  }
}

/**
 * calculateMicroResonance - fine-grain vibration of the moment
 *
 * Based on:
 * - Heat intensity
 * - Tension level
 * - Pulse resonance
 */
function calculateMicroResonance(felt: FeltState, pulse: Pulse): number {
  const heatComponent = felt.heat * 0.4;
  const tensionComponent = felt.tension * 0.3;
  const pulseComponent = pulse.resonance * 0.3;

  const resonance = heatComponent + tensionComponent + pulseComponent;

  return Math.max(0, Math.min(1, resonance));
}

/**
 * blend - weighted blend between two values
 *
 * @param current - current value
 * @param target - target value
 * @param weight - weight of target (0-1)
 * @returns blended value
 */
function blend(current: number, target: number, weight: number): number {
  return current * (1 - weight) + target * weight;
}
