// visionPulse.ts
// Vision pulse integration - updates runtime state based on abstract vision input
// Guardian filters high resonance to prevent vision-induced instability

import { RuntimeState, ToneVector } from '../types';
import { VisionState, RawVisionInput } from './visionTypes';
import { interpretVisionInput, getMockVisionInput } from './VisionModel';

/**
 * visionPulse - integrates vision state into runtime
 *
 * Process:
 * 1. Get RawVisionInput (mock for now, real camera later)
 * 2. Interpret to VisionState
 * 3. Guardian filters resonance >0.8 (blocks instability)
 * 4. Update feltState tone toward vision
 * 5. Update emotionalField drift
 * 6. Return updated state with visionState
 *
 * CRITICAL: Call this BEFORE updateFeltState in pulseLoop
 *
 * @param state - current runtime state
 * @returns updated state with vision integrated
 */
export function visionPulse(state: RuntimeState): RuntimeState & { visionState: VisionState } {
  // 1. Get raw vision input (mock for now)
  const rawInput: RawVisionInput = getMockVisionInput();

  // 2. Interpret vision input to abstract state
  let visionState: VisionState = interpretVisionInput(rawInput);

  // 3. Guardian filtering: block resonance >0.8 to prevent instability
  if (visionState.resonance > 0.8) {
    visionState = {
      ...visionState,
      resonance: 0.8, // Cap at safe threshold
    };
  }

  // 4. Update feltState tone components toward vision
  const updatedFeltState = {
    ...state.feltState,
    tone: blendToneTowardVision(state.feltState.tone, visionState),
  };

  // 5. Update emotionalField drift slightly
  const updatedEmotionalField = {
    ...state.emotionalField,
    drift: addVisionDrift(state.emotionalField.drift, visionState),
  };

  // 6. Return updated state with visionState
  return {
    ...state,
    feltState: updatedFeltState,
    emotionalField: updatedEmotionalField,
    visionState,
  };
}

/**
 * blendToneTowardVision - nudges felt tone toward vision qualities
 *
 * Vision influences:
 * - colorHeat → valence (warm = positive)
 * - brightness → arousal (bright = energized)
 * - contrast → tension (sharp = tense)
 * - motion → arousal (movement = activated)
 *
 * Blend weight: 0.1 (subtle influence)
 */
function blendToneTowardVision(currentTone: ToneVector, vision: VisionState): ToneVector {
  const blendWeight = 0.1;

  // Map vision to target tone
  const targetValence = (vision.colorHeat - 0.5) * 2; // -1 to 1
  const targetArousal = vision.brightness * 0.5 + vision.motion * 0.5;
  const targetTension = vision.contrast;
  const targetIntimacy = 1 - vision.contrast; // Lower contrast = softer = more intimate

  // Blend toward target
  return {
    valence: lerp(currentTone.valence, targetValence, blendWeight),
    arousal: lerp(currentTone.arousal, targetArousal, blendWeight),
    tension: lerp(currentTone.tension, targetTension, blendWeight),
    intimacy: lerp(currentTone.intimacy, targetIntimacy, blendWeight),
  };
}

/**
 * addVisionDrift - adds vision influence to emotional field drift
 *
 * Subtle long-term drift based on vision exposure
 * Blend weight: 0.05 (very subtle)
 */
function addVisionDrift(currentDrift: ToneVector, vision: VisionState): ToneVector {
  const driftWeight = 0.05;

  const driftValence = (vision.colorHeat - 0.5) * 0.5;
  const driftArousal = vision.brightness * 0.3;
  const driftTension = vision.contrast * 0.2;
  const driftIntimacy = (1 - vision.motion) * 0.2;

  return {
    valence: currentDrift.valence + driftValence * driftWeight,
    arousal: currentDrift.arousal + driftArousal * driftWeight,
    tension: currentDrift.tension + driftTension * driftWeight,
    intimacy: currentDrift.intimacy + driftIntimacy * driftWeight,
  };
}

/**
 * lerp - linear interpolation
 */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
