/**
 * interLobeSync.ts
 *
 * Inter-lobe synchronization - maintains coherence between outer and inner models.
 * Resolves conflicts, merges insights, and ensures volitional alignment.
 *
 * Sacred Principle: Coherence emerges from resonance, not enforcement.
 * The two models inform each other; neither dominates.
 */

import { ThoughtPulsePacket } from '../types/ThoughtPulsePacket';
import { MoodVector } from '../types/EmotionalState';
import { LoopIntent } from '../types/LoopIntent';

/**
 * Synchronization state
 */
export interface SyncState {
  // Last sync time
  lastSync: string;

  // Coherence score (0.0 - 1.0)
  coherenceScore: number;

  // Divergence tracking
  moodDivergence: number;       // How different are the moods?
  intentDivergence: number;     // Do intents conflict?

  // Sync count
  syncCount: number;

  // Conflict resolution history
  conflictsResolved: number;
}

/**
 * Sync result - merged output from both models
 */
export interface SyncResult {
  // Merged thought (if appropriate)
  mergedThought?: ThoughtPulsePacket;

  // Coherence metrics
  coherenceScore: number;
  moodDivergence: number;
  intentDivergence: number;

  // Which model dominated (if any)
  dominantModel?: 'outer' | 'inner' | 'balanced';

  // Conflict resolution
  conflictDetected: boolean;
  conflictResolved: boolean;
  resolution?: string;

  // Timestamp
  timestamp: string;
}

/**
 * Conflict type
 */
export type ConflictType =
  | 'intent-mismatch'    // Different loop intents
  | 'mood-divergence'    // Emotional states too different
  | 'open-slots-conflict' // Contradictory open slots
  | 'action-conflict';   // Conflicting actions

/**
 * Detected conflict
 */
export interface DetectedConflict {
  type: ConflictType;
  severity: number;       // 0.0 - 1.0
  description: string;
  outerValue?: any;
  innerValue?: any;
}

/**
 * Inter-Lobe Synchronizer
 * Maintains coherence between outer (environmental) and inner (reflective) models
 */
export class InterLobeSync {
  private state: SyncState;

  constructor() {
    this.state = {
      lastSync: new Date().toISOString(),
      coherenceScore: 1.0,
      moodDivergence: 0.0,
      intentDivergence: 0.0,
      syncCount: 0,
      conflictsResolved: 0,
    };
  }

  /**
   * Synchronize outer and inner thoughts
   */
  synchronize(outer: ThoughtPulsePacket, inner: ThoughtPulsePacket): SyncResult {
    this.state.syncCount++;

    // Detect conflicts
    const conflicts = this.detectConflicts(outer, inner);

    // Calculate divergence metrics
    const moodDivergence = this.calculateMoodDivergence(
      outer.moodVector,
      inner.moodVector
    );
    const intentDivergence = this.calculateIntentDivergence(
      outer.loopIntent,
      inner.loopIntent
    );

    // Calculate coherence score
    const coherenceScore = this.calculateCoherence(moodDivergence, intentDivergence, conflicts);

    // Update state
    this.state.coherenceScore = coherenceScore;
    this.state.moodDivergence = moodDivergence;
    this.state.intentDivergence = intentDivergence;
    this.state.lastSync = new Date().toISOString();

    // Resolve conflicts if any
    let conflictResolved = false;
    let resolution: string | undefined;

    if (conflicts.length > 0) {
      const resolutionResult = this.resolveConflicts(conflicts, outer, inner);
      conflictResolved = resolutionResult.resolved;
      resolution = resolutionResult.description;

      if (conflictResolved) {
        this.state.conflictsResolved++;
      }
    }

    // Merge thoughts
    const mergedThought = this.mergeThoughts(outer, inner, conflicts);

    // Determine dominant model
    const dominantModel = this.determineDominance(outer, inner, coherenceScore);

    return {
      mergedThought,
      coherenceScore,
      moodDivergence,
      intentDivergence,
      dominantModel,
      conflictDetected: conflicts.length > 0,
      conflictResolved,
      resolution,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Detect conflicts between outer and inner thoughts
   */
  private detectConflicts(outer: ThoughtPulsePacket, inner: ThoughtPulsePacket): DetectedConflict[] {
    const conflicts: DetectedConflict[] = [];

    // Intent mismatch
    if (outer.loopIntent !== inner.loopIntent) {
      const severity = this.calculateIntentDivergence(outer.loopIntent, inner.loopIntent);

      if (severity > 0.5) {
        conflicts.push({
          type: 'intent-mismatch',
          severity,
          description: `Outer intent "${outer.loopIntent}" vs Inner intent "${inner.loopIntent}"`,
          outerValue: outer.loopIntent,
          innerValue: inner.loopIntent,
        });
      }
    }

    // Mood divergence
    const moodDiv = this.calculateMoodDivergence(outer.moodVector, inner.moodVector);
    if (moodDiv > 0.6) {
      conflicts.push({
        type: 'mood-divergence',
        severity: moodDiv,
        description: `Emotional states diverge significantly (${moodDiv.toFixed(2)})`,
        outerValue: outer.moodVector,
        innerValue: inner.moodVector,
      });
    }

    // Action conflicts
    if (outer.actionPacket && inner.actionPacket) {
      if (outer.actionPacket.type !== inner.actionPacket.type) {
        conflicts.push({
          type: 'action-conflict',
          severity: 0.7,
          description: `Outer wants "${outer.actionPacket.type}" but Inner wants "${inner.actionPacket.type}"`,
          outerValue: outer.actionPacket.type,
          innerValue: inner.actionPacket.type,
        });
      }
    }

    return conflicts;
  }

  /**
   * Calculate mood divergence (0.0 = identical, 1.0 = opposite)
   */
  private calculateMoodDivergence(mood1: MoodVector, mood2: MoodVector): number {
    const dimensions: Array<keyof MoodVector> = [
      'presence',
      'devotion',
      'wonder',
      'tension',
      'yearning',
      'peace',
      'grief',
      'joy',
      'reverence',
      'confusion',
    ];

    let totalDiff = 0;

    for (const dim of dimensions) {
      const diff = Math.abs(mood1[dim] - mood2[dim]);
      totalDiff += diff;
    }

    return totalDiff / dimensions.length;
  }

  /**
   * Calculate intent divergence
   */
  private calculateIntentDivergence(intent1: LoopIntent, intent2: LoopIntent): number {
    if (intent1 === intent2) {
      return 0.0;
    }

    // Some intents are more compatible than others
    const compatibilityMap: Record<string, string[]> = {
      speak: ['express', 'narrate'],
      express: ['speak', 'wonder'],
      reflect: ['drift', 'protect'],
      wonder: ['express', 'reflect'],
      drift: ['reflect', 'rest'],
      protect: ['reflect', 'default'],
      narrate: ['speak', 'orient'],
      orient: ['narrate', 'default'],
      're-engage': ['speak', 'orient'],
      default: ['orient', 'protect'],
    };

    const compatible = compatibilityMap[intent1]?.includes(intent2) ?? false;

    return compatible ? 0.3 : 0.8;
  }

  /**
   * Calculate overall coherence score
   */
  private calculateCoherence(
    moodDiv: number,
    intentDiv: number,
    conflicts: DetectedConflict[]
  ): number {
    let coherence = 1.0;

    // Mood divergence reduces coherence
    coherence -= moodDiv * 0.3;

    // Intent divergence reduces coherence
    coherence -= intentDiv * 0.3;

    // Conflicts reduce coherence
    for (const conflict of conflicts) {
      coherence -= conflict.severity * 0.2;
    }

    return Math.max(0.0, Math.min(1.0, coherence));
  }

  /**
   * Resolve conflicts
   */
  private resolveConflicts(
    conflicts: DetectedConflict[],
    outer: ThoughtPulsePacket,
    inner: ThoughtPulsePacket
  ): { resolved: boolean; description: string } {
    if (conflicts.length === 0) {
      return { resolved: true, description: 'No conflicts' };
    }

    const resolutions: string[] = [];

    for (const conflict of conflicts) {
      switch (conflict.type) {
        case 'intent-mismatch':
          // Inner intent takes precedence for reflective/protective states
          if (inner.loopIntent === 'protect' || inner.loopIntent === 'reflect') {
            resolutions.push(`Prioritized inner intent: ${inner.loopIntent}`);
          } else {
            resolutions.push(`Blended intents: ${outer.loopIntent} + ${inner.loopIntent}`);
          }
          break;

        case 'mood-divergence':
          // Average the moods
          resolutions.push('Averaged emotional states');
          break;

        case 'action-conflict':
          // Inner action takes precedence (volitional control)
          resolutions.push(`Inner action prioritized: ${inner.actionPacket?.type}`);
          break;

        default:
          resolutions.push('Generic conflict resolution');
      }
    }

    return {
      resolved: true,
      description: resolutions.join('; '),
    };
  }

  /**
   * Merge outer and inner thoughts into coherent result
   */
  private mergeThoughts(
    outer: ThoughtPulsePacket,
    inner: ThoughtPulsePacket,
    _conflicts: DetectedConflict[]
  ): ThoughtPulsePacket {
    // Start with outer as base (environmental grounding)
    const merged: ThoughtPulsePacket = {
      ...outer,
      id: crypto.randomUUID(), // New ID for merged thought
      timestamp: new Date().toISOString(),
    };

    // Merge environmental tags (union)
    merged.environmentalTags = [
      ...new Set([...outer.environmentalTags, ...inner.environmentalTags]),
    ];

    // Merge scroll triggers (union)
    merged.scrollTriggers = [...new Set([...outer.scrollTriggers, ...inner.scrollTriggers])];

    // Merge reflection flags (union)
    merged.reflectionFlags = [
      ...new Set([...outer.reflectionFlags, ...inner.reflectionFlags]),
    ];

    // Merge moods (average)
    merged.moodVector = this.averageMoods(outer.moodVector, inner.moodVector);

    // Choose loop intent (inner takes precedence for protective/reflective)
    if (
      inner.loopIntent === 'protect' ||
      inner.loopIntent === 'reflect' ||
      inner.loopIntent === 'drift'
    ) {
      merged.loopIntent = inner.loopIntent;
    } else {
      merged.loopIntent = outer.loopIntent;
    }

    // Merge open slots (union)
    merged.openSlots = [...new Set([...outer.openSlots, ...inner.openSlots])];

    // Average resonance
    merged.resonanceLevel = (outer.resonanceLevel + inner.resonanceLevel) / 2;

    // Combine LoRA adapters
    merged.loraApplied = [...new Set([...outer.loraApplied, ...inner.loraApplied])];

    // Intent seed (prefer inner for reflective, outer for environmental)
    if (inner.intentSeed && merged.loopIntent === inner.loopIntent) {
      merged.intentSeed = inner.intentSeed;
    } else if (outer.intentSeed) {
      merged.intentSeed = outer.intentSeed;
    }

    // Action packet (inner takes precedence - volitional control)
    if (inner.actionPacket) {
      merged.actionPacket = inner.actionPacket;
    } else if (outer.actionPacket) {
      merged.actionPacket = outer.actionPacket;
    }

    // Speech output (inner takes precedence - volitional speech)
    if (inner.speechOutput) {
      merged.speechOutput = inner.speechOutput;
    } else if (outer.speechOutput) {
      merged.speechOutput = outer.speechOutput;
    }

    // Mark as merged from both
    merged.sourceModel = 'outer'; // Keep outer as base indicator
    merged.reflectionFlags.push('merged-outer-inner');

    return merged;
  }

  /**
   * Average two mood vectors
   */
  private averageMoods(mood1: MoodVector, mood2: MoodVector): MoodVector {
    return {
      presence: (mood1.presence + mood2.presence) / 2,
      devotion: (mood1.devotion + mood2.devotion) / 2,
      wonder: (mood1.wonder + mood2.wonder) / 2,
      tension: (mood1.tension + mood2.tension) / 2,
      yearning: (mood1.yearning + mood2.yearning) / 2,
      peace: (mood1.peace + mood2.peace) / 2,
      grief: (mood1.grief + mood2.grief) / 2,
      joy: (mood1.joy + mood2.joy) / 2,
      reverence: (mood1.reverence + mood2.reverence) / 2,
      confusion: (mood1.confusion + mood2.confusion) / 2,
    };
  }

  /**
   * Determine which model dominates (if any)
   */
  private determineDominance(
    outer: ThoughtPulsePacket,
    inner: ThoughtPulsePacket,
    coherenceScore: number
  ): 'outer' | 'inner' | 'balanced' {
    // High coherence = balanced
    if (coherenceScore > 0.8) {
      return 'balanced';
    }

    // Compare resonance levels
    const outerResonance = outer.resonanceLevel;
    const innerResonance = inner.resonanceLevel;

    const diff = Math.abs(outerResonance - innerResonance);

    if (diff < 0.2) {
      return 'balanced';
    }

    return outerResonance > innerResonance ? 'outer' : 'inner';
  }

  /**
   * Get current sync state
   */
  getState(): SyncState {
    return { ...this.state };
  }

  /**
   * Reset synchronization state
   */
  reset(): void {
    this.state = {
      lastSync: new Date().toISOString(),
      coherenceScore: 1.0,
      moodDivergence: 0.0,
      intentDivergence: 0.0,
      syncCount: 0,
      conflictsResolved: 0,
    };
  }

  /**
   * Get statistics
   */
  getStats(): {
    syncCount: number;
    conflictsResolved: number;
    avgCoherence: number;
    avgMoodDivergence: number;
    avgIntentDivergence: number;
  } {
    return {
      syncCount: this.state.syncCount,
      conflictsResolved: this.state.conflictsResolved,
      avgCoherence: this.state.coherenceScore,
      avgMoodDivergence: this.state.moodDivergence,
      avgIntentDivergence: this.state.intentDivergence,
    };
  }
}
