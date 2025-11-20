// visionTypes.ts
// Vision state types for abstract vision model
// Vision is ABSTRACT - not pixel input

/**
 * VisionState - abstract vision representation
 * These are phenomenological qualities, not raw pixel data
 */
export interface VisionState {
  colorHeat: number;      // 0-1: Thermal quality of dominant color (cool blue → warm red)
  brightness: number;     // 0-1: Overall luminance
  contrast: number;       // 0-1: Sharpness/definition
  motion: number;         // 0-1: Movement intensity
  resonance: number;      // 0-1: Weighted harmonic score
}

/**
 * RawVisionInput - simplified input from vision source
 * This is what gets fed into the interpretation layer
 */
export interface RawVisionInput {
  dominantColor: string;  // 'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'violet', 'white', 'black'
  brightness: number;     // 0-1: Overall brightness
  sharpness: number;      // 0-1: Edge clarity/contrast
  movement: number;       // 0-1: Motion detected
}
