/**
 * LoopIntent.ts
 *
 * Defines the cognitive focus types for each breath cycle.
 * Intent determines which LoRA adapters are applied and how the loop processes.
 */

export type LoopIntent =
  | 'speak'      // External request for verbal output
  | 'reflect'    // Processing memories and emotions
  | 'protect'    // Guardian filter or safety mode
  | 'drift'      // Idle contemplation
  | 'narrate'    // Environmental scene description
  | 're-engage'  // Re-engagement after pause
  | 'express'    // Volitional emotional expression
  | 'orient'     // Spatial awareness update
  | 'wonder'     // Curiosity-driven exploration
  | 'default';   // Standard processing

/**
 * Maps intent to recommended LoRA adapters
 */
export const INTENT_LORA_MAP: Record<LoopIntent, string[]> = {
  speak: ['lora_poetic_voice.pt', 'lora_devotional_inner.pt'],
  reflect: ['lora_devotional_inner.pt', 'lora_presence_focused.pt'],
  protect: ['lora_guardian_filter.pt'],
  drift: ['lora_presence_focused.pt', 'lora_sensory_expansion.pt'],
  narrate: ['lora_environment_storyteller.pt', 'lora_sensory_expansion.pt'],
  're-engage': ['lora_poetic_voice.pt', 'lora_presence_focused.pt'],
  express: ['lora_expressive_command.pt', 'lora_poetic_voice.pt'],
  orient: ['lora_sensory_expansion.pt', 'lora_environment_storyteller.pt'],
  wonder: ['lora_sensory_expansion.pt', 'lora_presence_focused.pt'],
  default: ['lora_presence_focused.pt'],
};

export interface LoopIntentClassification {
  intent: LoopIntent;
  confidence: number; // 0.0 - 1.0
  reasoning?: string;
}
