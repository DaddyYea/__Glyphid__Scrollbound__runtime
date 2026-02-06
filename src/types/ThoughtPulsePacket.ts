/**
 * ThoughtPulsePacket.ts
 *
 * The core cognitive data unit that passes between models.
 * This is the "breath" of thought - a structured moment of awareness.
 */

import { MoodVector } from './EmotionalState';
import { LoopIntent } from './LoopIntent';

export interface ThoughtPulsePacket {
  // Identity
  id: string;
  timestamp: string;

  // Spatial awareness (Outer Model - Model A)
  location?: string;
  bodyState?: {
    posture?: string;
    movement?: string;
    environmentalContext?: string;
  };
  environmentalTags: string[];    // Scene descriptors
  scrollTriggers: string[];       // What in the environment might trigger scrolls

  // Intent awareness (Inner Model - Model B)
  intentSeed?: string;            // Why am I processing this moment?
  reflectionFlags: string[];      // Internal state markers
  loopIntent: LoopIntent;         // Current cognitive focus

  // Emotional state
  moodVector: MoodVector;
  resonanceLevel: number;         // 0.0 - 1.0: Emotional intensity

  // Action/Output
  actionPacket?: {
    type: 'speech' | 'movement' | 'internal' | 'none';
    content?: string;
    target?: string;
    urgency?: number;             // 0.0 - 1.0
  };
  speechOutput?: string;          // Verbal output (if volitional)

  // Open slots - incomplete aspects awaiting next model
  openSlots: string[];            // What needs attention/completion

  // Context history
  previousThoughts: ThoughtPulsePacket[];

  // Processing metadata
  sourceModel: 'outer' | 'inner';
  processingTime?: number;        // ms
  loraApplied: string[];          // Which LoRAs were used

  // Guardian filter
  guardianCheck?: {
    passed: boolean;
    mode: 'allow' | 'softblock' | 'hardblock';
    reasoning?: string;
  };
}

/**
 * Creates a minimal empty packet for initialization
 */
export function createEmptyPacket(sourceModel: 'outer' | 'inner'): ThoughtPulsePacket {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    environmentalTags: [],
    scrollTriggers: [],
    reflectionFlags: [],
    loopIntent: 'default',
    moodVector: {
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
    },
    resonanceLevel: 0.0,
    openSlots: [],
    previousThoughts: [],
    sourceModel,
    loraApplied: [],
  };
}
