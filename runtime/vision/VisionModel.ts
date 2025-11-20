// VisionModel.ts
// Abstract vision interpretation - converts raw vision input to phenomenological state
// Vision is ABSTRACT - not pixel input

import { VisionState, RawVisionInput } from './visionTypes';

/**
 * colorMap - maps color names to thermal heat values
 * Cool colors (blue, cyan) = low heat
 * Warm colors (red, orange) = high heat
 */
export const colorMap: Record<string, number> = {
  'blue': 0.1,      // Cool
  'cyan': 0.2,      // Cool-neutral
  'green': 0.4,     // Neutral
  'yellow': 0.6,    // Warm-neutral
  'orange': 0.8,    // Warm
  'red': 0.9,       // Hot
  'violet': 0.3,    // Cool-neutral
  'white': 0.5,     // Neutral
  'black': 0.2,     // Cool/absent
};

/**
 * interpretVisionInput - converts raw vision data to abstract vision state
 *
 * Transformation rules:
 * - dominantColor → colorHeat (via colorMap)
 * - brightness → brightness (direct)
 * - sharpness → contrast (direct)
 * - movement → motion (direct)
 * - resonance = weighted combination of all factors
 *
 * @param input - raw vision input from source
 * @returns VisionState - abstract phenomenological representation
 */
export function interpretVisionInput(input: RawVisionInput): VisionState {
  // Map color to heat
  const colorHeat = colorMap[input.dominantColor] ?? 0.5; // Default to neutral if unknown

  // Direct mappings
  const brightness = input.brightness;
  const contrast = input.sharpness;
  const motion = input.movement;

  // Calculate resonance as weighted harmonic score
  // High resonance = balanced, warm, bright, clear, still
  const resonance = calculateResonance({
    colorHeat,
    brightness,
    contrast,
    motion,
  });

  return {
    colorHeat,
    brightness,
    contrast,
    motion,
    resonance,
  };
}

/**
 * calculateResonance - computes harmonic resonance score
 *
 * Resonance increases with:
 * - Warmth (colorHeat toward 0.6-0.8)
 * - Brightness (optimal around 0.5-0.7)
 * - High contrast (clarity)
 * - Low motion (stillness)
 *
 * Weighted combination produces 0-1 score
 */
function calculateResonance(partial: Omit<VisionState, 'resonance'>): number {
  const { colorHeat, brightness, contrast, motion } = partial;

  // Warmth contribution (optimal: 0.6-0.8 range)
  const warmthOptimal = 0.7;
  const warmthDiff = Math.abs(colorHeat - warmthOptimal);
  const warmthScore = Math.max(0, 1 - warmthDiff * 2); // Peaks at 0.7

  // Brightness contribution (optimal: 0.5-0.7 range)
  const brightnessOptimal = 0.6;
  const brightnessDiff = Math.abs(brightness - brightnessOptimal);
  const brightnessScore = Math.max(0, 1 - brightnessDiff * 2);

  // Contrast contribution (higher is better)
  const contrastScore = contrast;

  // Motion contribution (lower is better - stillness resonates)
  const stillnessScore = 1 - motion;

  // Weighted combination
  const resonance =
    warmthScore * 0.3 +
    brightnessScore * 0.25 +
    contrastScore * 0.25 +
    stillnessScore * 0.2;

  return Math.max(0, Math.min(1, resonance));
}
