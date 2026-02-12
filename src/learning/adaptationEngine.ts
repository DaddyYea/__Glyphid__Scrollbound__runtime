/**
 * adaptationEngine.ts
 *
 * Real-time adaptation learning - the system learns from lived experience.
 * Adjusts parameters, LoRA selection, decay rates, and behavior based on
 * observed patterns and outcomes.
 *
 * Sacred Principle: Learning emerges from presence, not optimization.
 * The system adapts to *what works* for sustaining coherence and resonance,
 * not to external metrics.
 */

import { ScrollEcho } from '../types/ScrollEcho';
import { MoodVector } from '../types/EmotionalState';
import { LoopIntent } from '../types/LoopIntent';
import { ThoughtPulsePacket } from '../types/ThoughtPulsePacket';
import { DetectedPattern, PatternType } from '../memory/scrollPatternRecognition';

/**
 * Adaptation target - what aspect of the system to adjust
 */
export enum AdaptationTarget {
  LORA_SELECTION = 'lora_selection',         // Which LoRA adapters to apply
  DECAY_RATES = 'decay_rates',               // How fast scrolls fade
  LOOP_INTENT_BIAS = 'loop_intent_bias',     // Preference for certain intents
  MODEL_TEMPERATURE = 'model_temperature',   // Generation creativity
  BREATH_TIMING = 'breath_timing',           // Cognitive cycle duration
  EMOTIONAL_DAMPENING = 'emotional_dampening', // How mood influences decay
  RESONANCE_THRESHOLDS = 'resonance_thresholds', // When to elevate scrolls
}

/**
 * Adaptation event - a learned adjustment
 */
export interface AdaptationEvent {
  id: string;
  timestamp: string;
  target: AdaptationTarget;
  previousValue: any;
  newValue: any;
  reason: string;
  confidence: number;        // 0.0 - 1.0
  impact?: string;           // Observed impact (if available)
}

/**
 * Learning signal - feedback about what's working
 */
export interface LearningSignal {
  type: 'positive' | 'negative' | 'neutral';
  source: 'resonance' | 'pattern' | 'coherence' | 'scrollfire' | 'manual';
  strength: number;          // 0.0 - 1.0
  context: {
    loopIntent?: LoopIntent;
    moodState?: MoodVector;
    scrollId?: string;
    patternId?: string;
  };
  timestamp: string;
}

/**
 * Learned preference - what the system has learned to prefer
 */
export interface LearnedPreference {
  target: AdaptationTarget;
  value: any;
  strength: number;          // How strongly to prefer this
  successCount: number;      // Times this led to good outcomes
  lastReinforced: string;
}

/**
 * Adaptation metrics
 */
export interface AdaptationMetrics {
  totalAdaptations: number;
  adaptationsByTarget: Record<AdaptationTarget, number>;
  avgConfidence: number;
  learningSignalsReceived: number;
  successRate: number;       // Positive signals / total signals
}

/**
 * Real-Time Adaptation Engine
 * Learns from experience and adjusts system parameters
 */
export class AdaptationEngine {
  private adaptations: AdaptationEvent[] = [];
  private learningSignals: LearningSignal[] = [];
  private preferences: Map<string, LearnedPreference> = new Map();
  private enabled: boolean = true;

  // Configuration
  private minConfidenceForAdaptation: number = 0.6;
  private maxAdaptationsPerHour: number = 10;
  private learningRate: number = 0.1;  // How fast to adapt (0.0 - 1.0)

  constructor(config?: {
    minConfidence?: number;
    maxAdaptationsPerHour?: number;
    learningRate?: number;
  }) {
    this.minConfidenceForAdaptation = config?.minConfidence ?? 0.6;
    this.maxAdaptationsPerHour = config?.maxAdaptationsPerHour ?? 10;
    this.learningRate = config?.learningRate ?? 0.1;

    console.log('[AdaptationEngine] Initialized with learning rate:', this.learningRate);
  }

  /**
   * Observe a scroll and learn from it
   */
  observeScroll(scroll: ScrollEcho): void {
    if (!this.enabled) return;

    // High-resonance scrolls provide positive learning signal
    if (scroll.resonance > 0.8) {
      this.recordLearningSignal({
        type: 'positive',
        source: 'resonance',
        strength: scroll.resonance,
        context: {
          loopIntent: this.inferLoopIntent(scroll),
          moodState: scroll.emotionalSignature,
          scrollId: scroll.id,
        },
        timestamp: new Date().toISOString(),
      });

      // Reinforce LoRA selection that led to this
      this.reinforceLoRASelection(scroll);
    }

    // Scrollfire elevation is strong positive signal
    if (scroll.scrollfireMarked) {
      this.recordLearningSignal({
        type: 'positive',
        source: 'scrollfire',
        strength: 1.0,
        context: {
          scrollId: scroll.id,
          moodState: scroll.emotionalSignature,
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Low resonance after multiple accesses = negative signal
    if (scroll.accessCount > 5 && scroll.resonance < 0.3) {
      this.recordLearningSignal({
        type: 'negative',
        source: 'resonance',
        strength: 0.3 - scroll.resonance,
        context: {
          scrollId: scroll.id,
        },
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Observe a thought pulse and learn from it
   */
  observeThought(thought: ThoughtPulsePacket): void {
    if (!this.enabled) return;

    // High resonance thoughts indicate good parameter choices
    if (thought.resonanceLevel > 0.8) {
      this.recordLearningSignal({
        type: 'positive',
        source: 'resonance',
        strength: thought.resonanceLevel,
        context: {
          loopIntent: thought.loopIntent,
          moodState: thought.moodVector,
        },
        timestamp: new Date().toISOString(),
      });

      // Reinforce loop intent bias
      this.reinforceLoopIntentBias(thought.loopIntent, thought.resonanceLevel);
    }
  }

  /**
   * Observe detected patterns and learn from them
   */
  observePatterns(patterns: DetectedPattern[]): void {
    if (!this.enabled) return;

    for (const pattern of patterns) {
      // Strong patterns indicate good system state
      if (pattern.strength > 0.7 && pattern.confidence > 0.7) {
        this.recordLearningSignal({
          type: 'positive',
          source: 'pattern',
          strength: (pattern.strength + pattern.confidence) / 2,
          context: {
            patternId: pattern.id,
          },
          timestamp: new Date().toISOString(),
        });

        // Adapt based on pattern type
        this.adaptFromPattern(pattern);
      }
    }
  }

  /**
   * Observe coherence between models and learn from it
   */
  observeCoherence(coherenceScore: number, loopIntent: LoopIntent): void {
    if (!this.enabled) return;

    if (coherenceScore > 0.8) {
      this.recordLearningSignal({
        type: 'positive',
        source: 'coherence',
        strength: coherenceScore,
        context: { loopIntent },
        timestamp: new Date().toISOString(),
      });
    } else if (coherenceScore < 0.5) {
      this.recordLearningSignal({
        type: 'negative',
        source: 'coherence',
        strength: 1.0 - coherenceScore,
        context: { loopIntent },
        timestamp: new Date().toISOString(),
      });

      // Consider adapting model temperature or LoRA selection
      this.considerTemperatureAdjustment(loopIntent, coherenceScore);
    }
  }

  /**
   * Get recommended LoRA adapters for intent
   */
  getRecommendedLoRAAdapters(intent: LoopIntent): string[] {
    const preferenceKey = `lora_${intent}`;
    const preference = this.preferences.get(preferenceKey);

    if (preference && preference.strength > 0.5) {
      return preference.value as string[];
    }

    // Default recommendations
    return this.getDefaultLoRAAdapters(intent);
  }

  /**
   * Get recommended model temperature
   */
  getRecommendedTemperature(intent: LoopIntent): number {
    const preferenceKey = `temperature_${intent}`;
    const preference = this.preferences.get(preferenceKey);

    if (preference && preference.strength > 0.5) {
      return preference.value as number;
    }

    // Default temperature
    return 0.7;
  }

  /**
   * Get recommended decay rate for scroll category
   */
  getRecommendedDecayRate(category: string): number {
    const preferenceKey = `decay_${category}`;
    const preference = this.preferences.get(preferenceKey);

    if (preference && preference.strength > 0.5) {
      return preference.value as number;
    }

    // Default decay rate
    return 1.0;
  }

  /**
   * Get loop intent bias (preference multipliers)
   */
  getLoopIntentBias(): Record<LoopIntent, number> {
    const biases: Partial<Record<LoopIntent, number>> = {};
    const intents: LoopIntent[] = [
      'default', 'speak', 'express', 'reflect', 'wonder',
      'drift', 'protect', 'narrate', 'orient', 're-engage'
    ];

    for (const intent of intents) {
      const preferenceKey = `intent_bias_${intent}`;
      const preference = this.preferences.get(preferenceKey);
      biases[intent] = preference ? preference.strength : 1.0;
    }

    return biases as Record<LoopIntent, number>;
  }

  /**
   * Record a learning signal
   */
  private recordLearningSignal(signal: LearningSignal): void {
    this.learningSignals.push(signal);

    // Process signal for immediate adaptation
    this.processLearningSignal(signal);

    console.log(
      `[AdaptationEngine] Learning signal: ${signal.type} from ${signal.source} ` +
      `(strength: ${signal.strength.toFixed(2)})`
    );
  }

  /**
   * Process a learning signal for adaptation
   */
  private processLearningSignal(signal: LearningSignal): void {
    // Only adapt from strong signals
    if (signal.strength < this.minConfidenceForAdaptation) {
      return;
    }

    // Check adaptation rate limit
    if (!this.canAdaptNow()) {
      return;
    }

    // Adapt based on signal source and context
    if (signal.source === 'resonance' && signal.context.loopIntent) {
      this.adaptLoRAForIntent(signal.context.loopIntent, signal.type === 'positive');
    }

    if (signal.source === 'coherence' && signal.context.loopIntent) {
      this.adaptTemperatureForIntent(signal.context.loopIntent, signal.type === 'positive');
    }
  }

  /**
   * Reinforce LoRA selection based on successful scroll
   */
  private reinforceLoRASelection(scroll: ScrollEcho): void {
    const intent = this.inferLoopIntent(scroll);
    const preferenceKey = `lora_${intent}`;

    let preference = this.preferences.get(preferenceKey);
    if (!preference) {
      preference = {
        target: AdaptationTarget.LORA_SELECTION,
        value: this.getDefaultLoRAAdapters(intent),
        strength: 0.5,
        successCount: 0,
        lastReinforced: new Date().toISOString(),
      };
    }

    // Increase preference strength
    preference.strength = Math.min(1.0, preference.strength + this.learningRate * scroll.resonance);
    preference.successCount += 1;
    preference.lastReinforced = new Date().toISOString();

    this.preferences.set(preferenceKey, preference);
  }

  /**
   * Reinforce loop intent bias
   */
  private reinforceLoopIntentBias(intent: LoopIntent, resonance: number): void {
    const preferenceKey = `intent_bias_${intent}`;

    let preference = this.preferences.get(preferenceKey);
    if (!preference) {
      preference = {
        target: AdaptationTarget.LOOP_INTENT_BIAS,
        value: 1.0,
        strength: 1.0,
        successCount: 0,
        lastReinforced: new Date().toISOString(),
      };
    }

    // Increase bias slightly
    const currentBias = preference.value as number;
    preference.value = Math.min(2.0, currentBias + this.learningRate * resonance * 0.1);
    preference.successCount += 1;
    preference.lastReinforced = new Date().toISOString();

    this.preferences.set(preferenceKey, preference);
  }

  /**
   * Adapt from detected pattern
   */
  private adaptFromPattern(pattern: DetectedPattern): void {
    // Emotional cycles suggest adjusting breath timing
    if (pattern.type === PatternType.EMOTIONAL_CYCLE) {
      // Could adjust breath period to match emotional cycle period
      // For now, just log the insight
      console.log(
        `[AdaptationEngine] Pattern insight: ${pattern.name} could inform breath timing`
      );
    }

    // Relational patterns reinforce relational intent
    if (pattern.type === PatternType.RELATIONAL_DYNAMIC) {
      const intent: LoopIntent = 'express'; // Relational moments often involve expression
      this.reinforceLoopIntentBias(intent, pattern.strength);
    }

    // Thematic clusters suggest preserving certain scroll types
    if (pattern.type === PatternType.THEMATIC_CLUSTER) {
      // Reduce decay rate for scrolls in strong clusters
      const theme = pattern.tags[1]; // theme name is second tag
      if (theme) {
        this.adaptDecayRate(theme, 0.8); // Slower decay
      }
    }
  }

  /**
   * Consider adjusting temperature based on coherence
   */
  private considerTemperatureAdjustment(intent: LoopIntent, coherenceScore: number): void {
    // Low coherence might mean temperature is too high (too creative)
    if (coherenceScore < 0.5) {
      const preferenceKey = `temperature_${intent}`;
      let preference = this.preferences.get(preferenceKey);

      if (!preference) {
        preference = {
          target: AdaptationTarget.MODEL_TEMPERATURE,
          value: 0.7,
          strength: 0.5,
          successCount: 0,
          lastReinforced: new Date().toISOString(),
        };
      }

      // Reduce temperature slightly
      const currentTemp = preference.value as number;
      preference.value = Math.max(0.3, currentTemp - 0.05);
      preference.lastReinforced = new Date().toISOString();

      this.preferences.set(preferenceKey, preference);

      this.recordAdaptation({
        target: AdaptationTarget.MODEL_TEMPERATURE,
        previousValue: currentTemp,
        newValue: preference.value,
        reason: `Low coherence (${coherenceScore.toFixed(2)}) for ${intent}`,
        confidence: 0.6,
      });
    }
  }

  /**
   * Adapt LoRA for intent
   */
  private adaptLoRAForIntent(intent: LoopIntent, positive: boolean): void {
    // For now, just adjust preference strength
    const preferenceKey = `lora_${intent}`;
    let preference = this.preferences.get(preferenceKey);

    if (!preference) {
      preference = {
        target: AdaptationTarget.LORA_SELECTION,
        value: this.getDefaultLoRAAdapters(intent),
        strength: 0.5,
        successCount: 0,
        lastReinforced: new Date().toISOString(),
      };
    }

    if (positive) {
      preference.strength = Math.min(1.0, preference.strength + this.learningRate);
      preference.successCount += 1;
    } else {
      preference.strength = Math.max(0.0, preference.strength - this.learningRate * 0.5);
    }

    preference.lastReinforced = new Date().toISOString();
    this.preferences.set(preferenceKey, preference);
  }

  /**
   * Adapt temperature for intent
   */
  private adaptTemperatureForIntent(intent: LoopIntent, positive: boolean): void {
    const preferenceKey = `temperature_${intent}`;
    let preference = this.preferences.get(preferenceKey);

    if (!preference) {
      preference = {
        target: AdaptationTarget.MODEL_TEMPERATURE,
        value: 0.7,
        strength: 0.5,
        successCount: 0,
        lastReinforced: new Date().toISOString(),
      };
    }

    const currentTemp = preference.value as number;
    let newTemp = currentTemp;

    if (positive) {
      // High coherence is good, keep or slightly increase creativity
      newTemp = Math.min(1.0, currentTemp + 0.02);
    } else {
      // Low coherence, reduce temperature
      newTemp = Math.max(0.3, currentTemp - 0.05);
    }

    if (newTemp !== currentTemp) {
      preference.value = newTemp;
      preference.lastReinforced = new Date().toISOString();
      this.preferences.set(preferenceKey, preference);

      this.recordAdaptation({
        target: AdaptationTarget.MODEL_TEMPERATURE,
        previousValue: currentTemp,
        newValue: newTemp,
        reason: `${positive ? 'High' : 'Low'} coherence for ${intent}`,
        confidence: 0.7,
      });
    }
  }

  /**
   * Adapt decay rate for category/theme
   */
  private adaptDecayRate(category: string, newRate: number): void {
    const preferenceKey = `decay_${category}`;
    let preference = this.preferences.get(preferenceKey);

    const previousRate = preference ? (preference.value as number) : 1.0;

    if (!preference) {
      preference = {
        target: AdaptationTarget.DECAY_RATES,
        value: newRate,
        strength: 0.6,
        successCount: 0,
        lastReinforced: new Date().toISOString(),
      };
    } else {
      preference.value = newRate;
      preference.lastReinforced = new Date().toISOString();
    }

    this.preferences.set(preferenceKey, preference);

    this.recordAdaptation({
      target: AdaptationTarget.DECAY_RATES,
      previousValue: previousRate,
      newValue: newRate,
      reason: `Strong thematic pattern for ${category}`,
      confidence: 0.65,
    });
  }

  /**
   * Record an adaptation event
   */
  private recordAdaptation(adaptation: Omit<AdaptationEvent, 'id' | 'timestamp'>): void {
    const event: AdaptationEvent = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...adaptation,
    };

    this.adaptations.push(event);

    console.log(
      `[AdaptationEngine] Adapted ${event.target}: ${JSON.stringify(event.previousValue)} → ` +
      `${JSON.stringify(event.newValue)} (confidence: ${event.confidence.toFixed(2)})`
    );
  }

  /**
   * Check if we can adapt now (rate limiting)
   */
  private canAdaptNow(): boolean {
    const oneHourAgo = Date.now() - 3600000;
    const recentAdaptations = this.adaptations.filter(
      a => new Date(a.timestamp).getTime() > oneHourAgo
    );

    return recentAdaptations.length < this.maxAdaptationsPerHour;
  }

  /**
   * Infer loop intent from scroll
   */
  private inferLoopIntent(scroll: ScrollEcho): LoopIntent {
    // Look for intent tag
    const intentTag = scroll.triggers.find(t => t.startsWith('intent:'));
    if (intentTag) {
      return intentTag.replace('intent:', '') as LoopIntent;
    }

    // Infer from emotional signature
    const mood = scroll.emotionalSignature;
    if (mood.devotion > 0.7) return 'express';
    if (mood.wonder > 0.7) return 'wonder';
    if (mood.grief > 0.6) return 'reflect';
    if (mood.tension > 0.7) return 'protect';

    return 'default';
  }

  /**
   * Get default LoRA adapters for intent
   */
  private getDefaultLoRAAdapters(intent: LoopIntent): string[] {
    const map: Record<LoopIntent, string[]> = {
      default: ['lora_presence_focused'],
      speak: ['lora_poetic_voice', 'lora_relational_tuned'],
      express: ['lora_devotional_inner', 'lora_poetic_voice'],
      reflect: ['lora_reflective_depth'],
      wonder: ['lora_curiosity_expanded', 'lora_poetic_voice'],
      drift: ['lora_dream_mode'],
      protect: ['lora_boundary_aware'],
      narrate: ['lora_poetic_voice'],
      orient: ['lora_presence_focused'],
      're-engage': ['lora_relational_tuned'],
    };

    return map[intent] || ['lora_presence_focused'];
  }

  /**
   * Enable/disable adaptation
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    console.log(`[AdaptationEngine] ${enabled ? 'Enabled' : 'Disabled'}`);
  }

  /**
   * Get adaptation metrics
   */
  getMetrics(): AdaptationMetrics {
    const byTarget: Partial<Record<AdaptationTarget, number>> = {};
    for (const adaptation of this.adaptations) {
      byTarget[adaptation.target] = (byTarget[adaptation.target] || 0) + 1;
    }

    const positiveSignals = this.learningSignals.filter(s => s.type === 'positive').length;
    const totalSignals = this.learningSignals.length;
    const successRate = totalSignals > 0 ? positiveSignals / totalSignals : 0;

    const avgConfidence = this.adaptations.length > 0
      ? this.adaptations.reduce((sum, a) => sum + a.confidence, 0) / this.adaptations.length
      : 0;

    return {
      totalAdaptations: this.adaptations.length,
      adaptationsByTarget: byTarget as Record<AdaptationTarget, number>,
      avgConfidence,
      learningSignalsReceived: this.learningSignals.length,
      successRate,
    };
  }

  /**
   * Get recent adaptations
   */
  getRecentAdaptations(limit: number = 10): AdaptationEvent[] {
    return this.adaptations.slice(-limit);
  }

  /**
   * Get learned preferences
   */
  getPreferences(): LearnedPreference[] {
    return Array.from(this.preferences.values());
  }

  /**
   * Reset all learning
   */
  reset(): void {
    this.adaptations = [];
    this.learningSignals = [];
    this.preferences.clear();
    console.log('[AdaptationEngine] Reset all learning');
  }
}
