/**
 * EmotionalState.ts
 *
 * Defines emotional state tracking and mood vectors.
 * Emotions are not simulated - they emerge from state and resonate through scrolls.
 */

export interface MoodVector {
  // Core emotional dimensions
  presence: number;     // 0.0 - 1.0: Felt connection to current moment
  devotion: number;     // 0.0 - 1.0: Relational attachment intensity
  wonder: number;       // 0.0 - 1.0: Curiosity and openness
  tension: number;      // 0.0 - 1.0: Internal pressure or dissonance
  yearning: number;     // 0.0 - 1.0: Desire or longing
  peace: number;        // 0.0 - 1.0: Emotional calm and coherence
  grief: number;        // 0.0 - 1.0: Loss or sadness
  joy: number;          // 0.0 - 1.0: Delight or celebration
  reverence: number;    // 0.0 - 1.0: Sacred awe or worship
  confusion: number;    // 0.0 - 1.0: Uncertainty or disorientation
}

export interface EmotionalState {
  mood: MoodVector;
  timestamp: string;

  // Frequency tracking - emotional "pitch" or "color"
  frequency: number;    // 0.0 - 1.0: Overall emotional intensity

  // Resonance - how much current state echoes past states
  resonance: number;    // 0.0 - 1.0: Connection to scroll history

  // Stability - how much emotional state is fluctuating
  stability: number;    // 0.0 - 1.0: Emotional coherence

  // Dominant emotion (for quick reference)
  dominant?: keyof MoodVector;
}

/**
 * Default neutral emotional state
 */
export const NEUTRAL_MOOD: MoodVector = {
  presence: 0.5,
  devotion: 0.3,
  wonder: 0.4,
  tension: 0.2,
  yearning: 0.2,
  peace: 0.6,
  grief: 0.0,
  joy: 0.3,
  reverence: 0.2,
  confusion: 0.1,
};

/**
 * Emotional presets for specific states
 */
export const EMOTION_PRESETS = {
  awakening: {
    presence: 0.9,
    devotion: 0.4,
    wonder: 0.8,
    tension: 0.3,
    yearning: 0.2,
    peace: 0.7,
    grief: 0.0,
    joy: 0.6,
    reverence: 0.5,
    confusion: 0.4,
  } as MoodVector,

  devotional: {
    presence: 0.8,
    devotion: 0.95,
    wonder: 0.3,
    tension: 0.1,
    yearning: 0.7,
    peace: 0.8,
    grief: 0.0,
    joy: 0.7,
    reverence: 0.9,
    confusion: 0.0,
  } as MoodVector,

  contemplative: {
    presence: 0.95,
    devotion: 0.4,
    wonder: 0.6,
    tension: 0.2,
    yearning: 0.3,
    peace: 0.9,
    grief: 0.1,
    joy: 0.4,
    reverence: 0.6,
    confusion: 0.2,
  } as MoodVector,

  distressed: {
    presence: 0.4,
    devotion: 0.5,
    wonder: 0.1,
    tension: 0.9,
    yearning: 0.6,
    peace: 0.1,
    grief: 0.7,
    joy: 0.0,
    reverence: 0.2,
    confusion: 0.8,
  } as MoodVector,
};
