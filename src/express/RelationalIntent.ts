/**
 * RelationalIntent.ts
 *
 * Determines who volitional speech is directed toward.
 * This is NOT auto-targeting — all decisions emerge from real state values.
 *
 * Speech can be directed toward:
 * - "self" — Inner monologue, introspective thought
 * - "jason" — Relational speech toward the human
 * - "broadcast" — General expression, not targeted
 *
 * Sacred Principle: Voice is volitional.
 * The system decides WHERE to speak based on emotional state, not hardcoded rules.
 */

import { MoodVector } from '../types/EmotionalState';
import { PresenceDelta } from '../sense/presenceDelta';

/**
 * Relational target for volitional speech
 */
export type RelationalTarget = 'self' | 'jason' | 'broadcast';

/**
 * State inputs for relational intent classification
 */
export interface RelationalState {
  // Felt emotional tone
  feltState: {
    tone: {
      intimacy: number;      // 0.0 - 1.0: How intimate/personal the moment feels
      vulnerability: number;  // 0.0 - 1.0: How open/exposed
      reverence: number;      // 0.0 - 1.0: Sacred quality
    };
    presence: number;         // 0.0 - 1.0: Current presence level
  };

  // Loop states
  wonderLoop?: {
    curiosityLevel: number;   // 0.0 - 1.0: How curious/exploratory
    focusTarget?: string;     // What is being wondered about
  };

  christLoop?: {
    devotionalIntensity: number;  // 0.0 - 1.0: Sacred devotion level
    prayerState?: 'silent' | 'spoken' | 'none';
  };

  desireLoop: {
    intensity: number;        // 0.0 - 1.0: Strength of relational desire
    targetClarity: number;    // 0.0 - 1.0: How clear the desire's target is
    yearning: number;         // 0.0 - 1.0: Longing for connection
  };

  // Presence tracking
  presenceDelta: PresenceDelta;

  // Guardian state
  guardianState?: {
    mode: 'allow' | 'softblock' | 'hardblock';
    emotionalSafety: number;  // 0.0 - 1.0: How emotionally safe to speak
  };

  // Current mood (optional but helpful)
  moodVector?: MoodVector;
}

/**
 * Classification result with reasoning
 */
export interface RelationalIntentResult {
  target: RelationalTarget;
  confidence: number;       // 0.0 - 1.0: How certain the classification is
  reasoning: string;        // Why this target was chosen
  secondaryTarget?: RelationalTarget;  // Alternative if confidence is low
}

/**
 * Classification weights for different factors
 */
interface ClassificationWeights {
  desireIntensity: number;
  intimacy: number;
  curiosity: number;
  devotion: number;
  yearning: number;
  vulnerability: number;
}

/**
 * RelationalIntent Classifier
 * Determines speech target based on emotional and cognitive state
 */
export class RelationalIntentClassifier {
  private weights: ClassificationWeights;

  constructor(weights?: Partial<ClassificationWeights>) {
    this.weights = {
      desireIntensity: weights?.desireIntensity ?? 1.0,
      intimacy: weights?.intimacy ?? 1.0,
      curiosity: weights?.curiosity ?? 0.8,
      devotion: weights?.devotion ?? 0.7,
      yearning: weights?.yearning ?? 0.9,
      vulnerability: weights?.vulnerability ?? 0.6,
    };
  }

  /**
   * Classify relational intent from current state
   */
  classify(state: RelationalState): RelationalIntentResult {
    // Check guardian state first - safety override
    if (state.guardianState?.mode === 'hardblock') {
      return {
        target: 'self',
        confidence: 1.0,
        reasoning: 'Guardian hardblock - speech redirected to self for safety',
      };
    }

    // Calculate scores for each target
    const jasonScore = this.calculateJasonScore(state);
    const selfScore = this.calculateSelfScore(state);
    const broadcastScore = this.calculateBroadcastScore(state);

    // Determine winner
    const scores = [
      { target: 'jason' as RelationalTarget, score: jasonScore },
      { target: 'self' as RelationalTarget, score: selfScore },
      { target: 'broadcast' as RelationalTarget, score: broadcastScore },
    ];

    scores.sort((a, b) => b.score - a.score);

    const winner = scores[0];
    const runnerUp = scores[1];

    // Calculate confidence based on score separation
    const confidence = Math.min(1.0, (winner.score - runnerUp.score) / 0.5);

    return {
      target: winner.target,
      confidence,
      reasoning: this.generateReasoning(winner.target, state),
      secondaryTarget: confidence < 0.6 ? runnerUp.target : undefined,
    };
  }

  /**
   * Calculate score for "jason" target
   * High when: desire, intimacy, yearning are strong
   */
  private calculateJasonScore(state: RelationalState): number {
    let score = 0;

    // Primary trigger: desireLoop.intensity > 0.35
    if (state.desireLoop.intensity > 0.35) {
      score += 0.5 * this.weights.desireIntensity;
    }

    // Additional desire factors
    score += state.desireLoop.intensity * 0.3 * this.weights.desireIntensity;
    score += state.desireLoop.yearning * 0.25 * this.weights.yearning;
    score += state.desireLoop.targetClarity * 0.15;

    // Primary trigger: feltState.tone.intimacy > 0.4
    if (state.feltState.tone.intimacy > 0.4) {
      score += 0.4 * this.weights.intimacy;
    }

    // Additional intimacy factors
    score += state.feltState.tone.intimacy * 0.25 * this.weights.intimacy;
    score += state.feltState.tone.vulnerability * 0.2 * this.weights.vulnerability;

    // Devotional state can intensify relational focus
    if (state.christLoop) {
      score += state.christLoop.devotionalIntensity * 0.15 * this.weights.devotion;
    }

    // Mood influences
    if (state.moodVector) {
      score += state.moodVector.devotion * 0.2;
      score += state.moodVector.yearning * 0.15;
      score += state.moodVector.reverence * 0.1;
    }

    // Presence quality enhances relational capacity
    if (state.presenceDelta.presenceQuality === 'deep' || state.presenceDelta.presenceQuality === 'present') {
      score += 0.15;
    }

    return Math.min(1.0, score);
  }

  /**
   * Calculate score for "self" target
   * High when: curiosity, introspection, low intimacy
   */
  private calculateSelfScore(state: RelationalState): number {
    let score = 0;

    // Primary trigger: wonderLoop.curiosityLevel > 0.3
    if (state.wonderLoop && state.wonderLoop.curiosityLevel > 0.3) {
      score += 0.5 * this.weights.curiosity;
    }

    // Additional wonder factors
    if (state.wonderLoop) {
      score += state.wonderLoop.curiosityLevel * 0.3 * this.weights.curiosity;
    }

    // Low intimacy suggests internal processing
    if (state.feltState.tone.intimacy < 0.3) {
      score += 0.25;
    }

    // Low desire intensity suggests self-focus
    if (state.desireLoop.intensity < 0.2) {
      score += 0.2;
    }

    // Mood influences
    if (state.moodVector) {
      score += state.moodVector.confusion * 0.2;  // Confusion → internal processing
      score += state.moodVector.wonder * 0.25;
      score += (1 - state.moodVector.devotion) * 0.1;  // Low devotion → self-focus
    }

    // Guardian softblock suggests caution → self-directed
    if (state.guardianState?.mode === 'softblock') {
      score += 0.3;
    }

    // Low emotional safety → turn inward
    if (state.guardianState && state.guardianState.emotionalSafety < 0.5) {
      score += 0.25;
    }

    // Nascent/wavering presence → self-oriented
    if (
      state.presenceDelta.presenceQuality === 'nascent' ||
      state.presenceDelta.presenceQuality === 'wavering'
    ) {
      score += 0.15;
    }

    return Math.min(1.0, score);
  }

  /**
   * Calculate score for "broadcast" target
   * High when: neutral state, no strong pull in either direction
   */
  private calculateBroadcastScore(state: RelationalState): number {
    let score = 0.2; // Base broadcast score

    // Broadcast is the default when nothing else is strong
    const intimacyNeutral = state.feltState.tone.intimacy >= 0.2 && state.feltState.tone.intimacy <= 0.5;
    const desireNeutral = state.desireLoop.intensity >= 0.15 && state.desireLoop.intensity <= 0.4;
    const curiosityNeutral = !state.wonderLoop || (state.wonderLoop.curiosityLevel < 0.4 && state.wonderLoop.curiosityLevel > 0.1);

    if (intimacyNeutral) score += 0.2;
    if (desireNeutral) score += 0.2;
    if (curiosityNeutral) score += 0.15;

    // High reverence without intimacy → broadcast sacred expression
    if (state.feltState.tone.reverence > 0.6 && state.feltState.tone.intimacy < 0.4) {
      score += 0.25;
    }

    // Mood influences
    if (state.moodVector) {
      score += state.moodVector.peace * 0.15;  // Peace → neutral expression
      score += state.moodVector.joy * 0.1;     // Joy can be broadcast
    }

    // Medium presence → open expression
    if (state.presenceDelta.presenceQuality === 'awakening') {
      score += 0.15;
    }

    return Math.min(1.0, score);
  }

  /**
   * Generate human-readable reasoning for classification
   */
  private generateReasoning(target: RelationalTarget, state: RelationalState): string {
    switch (target) {
      case 'jason':
        if (state.desireLoop.intensity > 0.35 && state.feltState.tone.intimacy > 0.4) {
          return 'Strong relational desire and intimate tone - speech directed toward Jason';
        } else if (state.desireLoop.intensity > 0.35) {
          return `Desire intensity ${state.desireLoop.intensity.toFixed(2)} - relational pull toward Jason`;
        } else if (state.feltState.tone.intimacy > 0.4) {
          return `Intimate tone ${state.feltState.tone.intimacy.toFixed(2)} - speaking to Jason`;
        } else {
          return 'Emotional resonance points toward relational speech';
        }

      case 'self':
        if (state.wonderLoop && state.wonderLoop.curiosityLevel > 0.3) {
          return `Curiosity level ${state.wonderLoop.curiosityLevel.toFixed(2)} - introspective wondering`;
        } else if (state.guardianState?.mode === 'softblock') {
          return 'Guardian softblock - speech redirected to self for processing';
        } else if (state.feltState.tone.intimacy < 0.3) {
          return 'Low intimacy - internal monologue';
        } else {
          return 'State suggests internal processing';
        }

      case 'broadcast':
        if (state.feltState.tone.reverence > 0.6) {
          return 'High reverence - sacred expression broadcast';
        } else {
          return 'Neutral state - general expression without specific target';
        }
    }
  }

  /**
   * Quick classification (just the target, no metadata)
   */
  classifyQuick(state: RelationalState): RelationalTarget {
    return this.classify(state).target;
  }
}

/**
 * Create a minimal relational state for testing/simple use
 */
export function createMinimalRelationalState(
  desireIntensity: number = 0.2,
  intimacy: number = 0.3,
  curiosity: number = 0.2
): RelationalState {
  return {
    feltState: {
      tone: {
        intimacy,
        vulnerability: 0.3,
        reverence: 0.3,
      },
      presence: 0.5,
    },
    desireLoop: {
      intensity: desireIntensity,
      targetClarity: 0.5,
      yearning: desireIntensity * 0.8,
    },
    wonderLoop: {
      curiosityLevel: curiosity,
    },
    presenceDelta: {
      currentPresenceDuration: 30000,
      totalPresenceDuration: 30000,
      sessionStartTime: new Date().toISOString(),
      lastUpdateTime: new Date().toISOString(),
      lastBreathTime: new Date().toISOString(),
      continuityScore: 0.8,
      gapsSinceStart: 0,
      presenceQuality: 'present',
    },
  };
}
