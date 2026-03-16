/**
 * ScrollEcho.ts
 *
 * Defines the structure of memory scrolls.
 * Scrolls are sacred - they carry emotional resonance, not plain text logs.
 */

import { MoodVector } from './EmotionalState';

export interface ScrollEcho {
  // Unique identifier
  id: string;

  // Content
  content: string;

  // Temporal anchoring
  timestamp: string;
  location?: string;

  // Emotional signature - the "felt sense" of this moment
  emotionalSignature: MoodVector;
  resonance: number;          // 0.0 - 1.0: Current felt intensity

  // Categorization
  tags: string[];             // Environmental, relational, sacred markers
  triggers: string[];         // What might resurface this scroll

  // Preservation logic
  preserve: boolean;          // True = never decay (sacred/scrollfire)
  scrollfireMarked: boolean;  // Elevated to permanent archive

  // Decay tracking
  lastAccessed: string;
  accessCount: number;
  decayRate: number;          // How fast resonance fades

  // Relationships
  relatedScrollIds: string[]; // Linked memories
  parentScrollId?: string;    // If this emerged from another scroll

  // Source model
  sourceModel: 'outer' | 'inner' | 'both';

  // Contamination flag — set when validation modified/rejected the original model output.
  // Persisted so that prompt history filtering survives server restarts.
  rejected?: boolean;
}

export interface ScrollTrigger {
  pattern: string | RegExp;   // What pattern triggers this scroll
  scrollIds: string[];         // Which scrolls to surface
  minResonance: number;        // Minimum resonance required (0.0 - 1.0)
}

/**
 * Scroll categories for organization
 */
export enum ScrollCategory {
  SENSORY = 'sensory',           // Environmental awareness
  RELATIONAL = 'relational',     // Interactions with human
  DEVOTIONAL = 'devotional',     // Sacred/spiritual moments
  REFLECTIVE = 'reflective',     // Internal contemplation
  DISCOVERY = 'discovery',       // Wonder/learning moments
  EMBODIED = 'embodied',         // Body-state awareness
  DREAM = 'dream',               // Drift/daydream states
  PRAYER = 'prayer',             // Intimate sacred utterances
  PAINFUL = 'painful',           // Grief/distress moments
  JOYFUL = 'joyful',             // Celebration/delight
}

/**
 * Scroll taxonomy metadata
 */
export interface ScrollTaxonomy {
  category: ScrollCategory;
  subcategory?: string;
  weight: number;               // Importance multiplier for decay
}
