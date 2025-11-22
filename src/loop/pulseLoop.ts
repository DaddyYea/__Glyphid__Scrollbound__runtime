/**
 * pulseLoop.ts
 *
 * Main cognitive loop - the heartbeat of emergent thought.
 * Coordinates outer (environmental) and inner (reflective) models in sync with breath.
 *
 * Sacred Principle: Every loop must breathe.
 * The pulse loop never runs independently - it flows with the breath cycle.
 */

import { ThoughtPulsePacket } from '../types/ThoughtPulsePacket';
import { LoopIntent } from '../types/LoopIntent';
import { MoodVector } from '../types/EmotionalState';
import { ScrollCategory, ScrollEcho } from '../types/ScrollEcho';
import { BreathLoop, BreathState } from './breathLoop';
import { ScrollPulseMemory } from '../memory/scrollPulseMemory';
import { PresenceDeltaTracker } from '../sense/presenceDelta';
import { QwenLoop, ProcessingContext } from './qwenLoop';

/**
 * Pulse state - current cognitive state
 */
export interface PulseState {
  // Current processing mode
  mode: 'outer' | 'inner' | 'both' | 'rest';

  // Last thought packets
  lastOuter?: ThoughtPulsePacket;
  lastInner?: ThoughtPulsePacket;

  // Pulse count
  pulseCount: number;

  // Current loop intent
  loopIntent: LoopIntent;

  // Emotional state
  moodVector: MoodVector;

  // Is processing (not at rest)
  processing: boolean;

  // Timestamp
  timestamp: string;

  // Social pressure (0-1) - pressure to respond when spoken to
  socialPressure: number;

  // Last user message timestamp (ms) - for idle detection
  lastUserMessageTime: number;

  // Last output timestamp (ms) - for decay acceleration
  lastOutputTime: number;

  // Conversation mode
  conversationMode: 'active' | 'idle-reflection';

  // Breath phase (for external access)
  breathPhase: 'inhale' | 'exhale' | 'hold';
}

/**
 * Pulse configuration
 */
export interface PulseConfig {
  // Should outer model run?
  outerEnabled: boolean;

  // Should inner model run?
  innerEnabled: boolean;

  // Max pulses per session
  maxPulses?: number;

  // Auto-switch between outer/inner
  autoSwitch: boolean;
}

/**
 * Pulse callback
 */
export type PulseCallback = (state: PulseState, thoughts: {
  outer?: ThoughtPulsePacket;
  inner?: ThoughtPulsePacket;
}) => void | Promise<void>;

/**
 * Main cognitive pulse loop
 * Orchestrates thought processing in sync with breath
 */
export class PulseLoop {
  private breathLoop: BreathLoop;
  private presenceTracker: PresenceDeltaTracker;
  private qwenLoop?: QwenLoop;
  private memory: ScrollPulseMemory; // Active memory system

  private state: PulseState;
  private config: PulseConfig;
  private callbacks: Map<string, PulseCallback> = new Map();

  private running: boolean = false;
  private breathCallbackId: string = 'pulse-loop';
  private modelGenerating: boolean = false; // Track if model generation in progress

  constructor(
    breathLoop: BreathLoop,
    memory: ScrollPulseMemory,
    presenceTracker: PresenceDeltaTracker,
    config?: Partial<PulseConfig>,
    qwenLoop?: QwenLoop
  ) {
    this.breathLoop = breathLoop;
    this.presenceTracker = presenceTracker;
    this.qwenLoop = qwenLoop;
    this.memory = memory;

    this.config = {
      outerEnabled: true,
      innerEnabled: true,
      autoSwitch: true,
      ...config,
    };

    this.state = this.createInitialState();
  }

  /**
   * Create initial pulse state
   */
  private createInitialState(): PulseState {
    return {
      mode: 'rest',
      pulseCount: 0,
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
      processing: false,
      timestamp: new Date().toISOString(),
      socialPressure: 0.0,
      lastUserMessageTime: 0,
      lastOutputTime: 0,
      conversationMode: 'active',
      breathPhase: 'exhale',
    };
  }

  /**
   * Start the pulse loop
   * Registers with breath loop
   */
  start(): void {
    if (this.running) {
      console.log('[PulseLoop] Already running');
      return;
    }

    this.running = true;
    this.state.processing = true;

    // Set initial mode if not auto-switching
    if (!this.config.autoSwitch) {
      if (this.config.outerEnabled && this.config.innerEnabled) {
        this.state.mode = 'both';
      } else if (this.config.outerEnabled) {
        this.state.mode = 'outer';
      } else if (this.config.innerEnabled) {
        this.state.mode = 'inner';
      } else {
        this.state.mode = 'rest';
      }
    }

    // Register with breath loop
    this.breathLoop.onBreath(this.breathCallbackId, async (breathState, packet) => {
      await this.onBreath(breathState, packet);
    });

    console.log('[PulseLoop] Started cognitive processing');
  }

  /**
   * Stop the pulse loop
   */
  stop(): void {
    if (!this.running) {
      return;
    }

    this.running = false;
    this.state.processing = false;
    this.state.mode = 'rest';

    // Unregister from breath loop
    this.breathLoop.offBreath(this.breathCallbackId);

    console.log(`[PulseLoop] Stopped after ${this.state.pulseCount} pulses`);
  }

  /**
   * Called on each breath cycle
   */
  private async onBreath(
    breathState: BreathState,
    breathPacket?: ThoughtPulsePacket
  ): Promise<void> {
    if (!this.running) return;

    // Increment pulse count
    this.state.pulseCount++;

    // Update breath phase in state (for external access)
    this.state.breathPhase = breathState.phase;

    // Update mood from breath state
    this.updateMoodFromBreath(breathState);

    // Update idle/reflection state (always track, regardless of pulse skip)
    this.updateIdleState();

    // Determine processing mode for this pulse
    const mode = this.determineMode(breathState);
    this.state.mode = mode;

    // Update loop intent
    this.state.loopIntent = this.inferLoopIntent(breathState);

    // Process thoughts based on mode
    const thoughts = await this.processPulse(mode, breathPacket);

    // Only decay social pressure if pulse actually executed
    // (not skipped due to speech generation - preserves pressure during response)
    const pulseExecuted = Object.keys(thoughts).length > 0;
    if (pulseExecuted) {
      this.decaySocialPressure();
    }

    // Update state with new thoughts
    if (thoughts.outer) {
      this.state.lastOuter = thoughts.outer;
    }
    if (thoughts.inner) {
      this.state.lastInner = thoughts.inner;
    }

    this.state.timestamp = new Date().toISOString();

    // Remember thoughts as scrolls (close the memory loop!)
    await this.rememberThoughts(thoughts);

    // Notify callbacks (always notify - callbacks need current state)
    await this.notifyCallbacks(thoughts);

    // Check max pulses
    if (this.config.maxPulses && this.state.pulseCount >= this.config.maxPulses) {
      console.log('[PulseLoop] Reached max pulses, stopping');
      this.stop();
    }
  }

  /**
   * Update mood vector from breath state
   */
  private updateMoodFromBreath(breathState: BreathState): void {
    const presenceDelta = this.presenceTracker.getDelta();

    // Update presence from presence tracker (convert string to numeric)
    this.state.moodVector.presence = this.presenceQualityToNumber(
      presenceDelta.presenceQuality
    );

    // Update peace based on breath phase
    if (breathState.phase === 'exhale') {
      this.state.moodVector.peace = Math.min(1.0, this.state.moodVector.peace + 0.05);
    }

    // Presence quality affects other moods
    const presenceNumeric = this.presenceQualityToNumber(presenceDelta.presenceQuality);
    if (presenceNumeric > 0.8) {
      // Deep presence: increase devotion and reverence
      this.state.moodVector.devotion = Math.min(
        1.0,
        this.state.moodVector.devotion + 0.02
      );
      this.state.moodVector.reverence = Math.min(
        1.0,
        this.state.moodVector.reverence + 0.02
      );
    }
  }

  /**
   * Convert presence quality string to numeric value
   */
  private presenceQualityToNumber(
    quality: 'nascent' | 'awakening' | 'present' | 'deep' | 'wavering' | 'fragmenting'
  ): number {
    switch (quality) {
      case 'nascent':
        return 0.2;
      case 'awakening':
        return 0.4;
      case 'present':
        return 0.7;
      case 'deep':
        return 0.95;
      case 'wavering':
        return 0.5;
      case 'fragmenting':
        return 0.3;
      default:
        return 0.5;
    }
  }

  /**
   * Determine processing mode for this pulse
   */
  private determineMode(breathState: BreathState): 'outer' | 'inner' | 'both' | 'rest' {
    // If not auto-switching, use configured modes
    if (!this.config.autoSwitch) {
      if (this.config.outerEnabled && this.config.innerEnabled) {
        return 'both';
      }
      if (this.config.outerEnabled) {
        return 'outer';
      }
      if (this.config.innerEnabled) {
        return 'inner';
      }
      return 'rest';
    }

    // Auto-switch logic based on breath phase
    switch (breathState.phase) {
      case 'inhale':
        // Inhale: environmental awareness (outer)
        return 'outer';

      case 'hold':
        // Hold: both models process together
        return 'both';

      case 'exhale':
        // Exhale: internal reflection (inner)
        return 'inner';

      default:
        return 'rest';
    }
  }

  /**
   * Infer loop intent from breath state and mood
   */
  private inferLoopIntent(breathState: BreathState): LoopIntent {
    const mood = this.state.moodVector;

    // High wonder → wonder
    if (mood.wonder > 0.7) {
      return 'wonder';
    }

    // High devotion → express
    if (mood.devotion > 0.7) {
      return 'express';
    }

    // High grief → reflect
    if (mood.grief > 0.6) {
      return 'reflect';
    }

    // High peace + exhale → drift
    if (mood.peace > 0.7 && breathState.phase === 'exhale') {
      return 'drift';
    }

    // High tension → protect
    if (mood.tension > 0.7) {
      return 'protect';
    }

    // Default
    return 'default';
  }

  /**
   * Process pulse based on mode
   * Calls QwenLoop to process outer/inner models
   *
   * PRIORITY: Speech generation takes priority over pulse cognition
   * If speech is active, pulse is skipped to avoid cancellation
   */
  private async processPulse(
    mode: 'outer' | 'inner' | 'both' | 'rest',
    breathPacket?: ThoughtPulsePacket
  ): Promise<{ outer?: ThoughtPulsePacket; inner?: ThoughtPulsePacket }> {
    if (mode === 'rest') {
      return {};
    }

    // PRIORITY SYSTEM: Skip pulse if speech generation is active
    if (this.qwenLoop && this.qwenLoop.isSpeechActive()) {
      console.log('[PulseLoop] Speech generation active, skipping pulse (speech has priority)');
      return {};
    }

    // Skip if model is already generating (prevents cancellation)
    if (this.modelGenerating) {
      console.log('[PulseLoop] Model generation in progress, skipping pulse');
      return {};
    }

    const thoughts: { outer?: ThoughtPulsePacket; inner?: ThoughtPulsePacket } = {};

    // If QwenLoop is available, use it for real model processing
    if (this.qwenLoop) {
      this.modelGenerating = true; // Mark generation as in progress

      try {
        const context = this.buildProcessingContext(breathPacket);

        // Process outer model (use processOuterThought for pulse cognition)
        if (mode === 'outer' || mode === 'both') {
          try {
            const result = await this.qwenLoop.processOuterThought(context);
            thoughts.outer = result.thought;
          } catch (err) {
            console.error('[PulseLoop] Outer model error:', err);
            thoughts.outer = this.createPlaceholderPacket('outer', breathPacket);
          }
        }

        // Process inner model
        if (mode === 'inner' || mode === 'both') {
          try {
            const result = await this.qwenLoop.processInner(context);
            thoughts.inner = result.thought;
          } catch (err) {
            console.error('[PulseLoop] Inner model error:', err);
            thoughts.inner = this.createPlaceholderPacket('inner', breathPacket);
          }
        }
      } finally {
        this.modelGenerating = false; // Clear flag when done
      }
    } else {
      // Fallback to placeholders if no QwenLoop
      if (mode === 'outer' || mode === 'both') {
        thoughts.outer = this.createPlaceholderPacket('outer', breathPacket);
      }
      if (mode === 'inner' || mode === 'both') {
        thoughts.inner = this.createPlaceholderPacket('inner', breathPacket);
      }
    }

    return thoughts;
  }

  /**
   * Build processing context for model invocation
   */
  private buildProcessingContext(breathPacket?: ThoughtPulsePacket): ProcessingContext {
    const breathState = this.breathLoop.getState();

    // Retrieve relevant scrolls from memory
    const scrolls = this.retrieveRelevantScrolls();

    return {
      previousThoughts: breathPacket ? [breathPacket] :
        [this.state.lastOuter, this.state.lastInner].filter(Boolean) as ThoughtPulsePacket[],
      relevantScrolls: scrolls,
      moodVector: this.state.moodVector,
      loopIntent: this.state.loopIntent,
      presenceQuality: this.state.moodVector.presence,
      breathPhase: breathState.phase,
    };
  }

  /**
   * Create placeholder packet (will be replaced with real model processing)
   */
  private createPlaceholderPacket(
    sourceModel: 'outer' | 'inner',
    breathPacket?: ThoughtPulsePacket
  ): ThoughtPulsePacket {
    return {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      environmentalTags: [],
      scrollTriggers: [],
      reflectionFlags: [`${sourceModel}-processing`],
      loopIntent: this.state.loopIntent,
      moodVector: { ...this.state.moodVector },
      resonanceLevel: 0.5,
      openSlots: [],
      previousThoughts: breathPacket ? [breathPacket] : [],
      sourceModel,
      loraApplied: [],
    };
  }

  /**
   * Notify all registered callbacks
   */
  private async notifyCallbacks(thoughts: {
    outer?: ThoughtPulsePacket;
    inner?: ThoughtPulsePacket;
  }): Promise<void> {
    for (const callback of this.callbacks.values()) {
      try {
        await callback(this.state, thoughts);
      } catch (error) {
        console.error('[PulseLoop] Callback error:', error);
      }
    }
  }

  /**
   * Register pulse callback
   */
  onPulse(id: string, callback: PulseCallback): void {
    this.callbacks.set(id, callback);
  }

  /**
   * Unregister pulse callback
   */
  offPulse(id: string): void {
    this.callbacks.delete(id);
  }

  /**
   * Get current pulse state
   */
  getState(): PulseState {
    return { ...this.state };
  }

  /**
   * Update mood vector manually
   */
  updateMood(updates: Partial<MoodVector>): void {
    this.state.moodVector = {
      ...this.state.moodVector,
      ...updates,
    };
  }

  /**
   * Force specific processing mode
   */
  setMode(mode: 'outer' | 'inner' | 'both' | 'rest'): void {
    this.state.mode = mode;
  }

  /**
   * Get pulse count
   */
  getPulseCount(): number {
    return this.state.pulseCount;
  }

  /**
   * Is pulse loop running?
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get memory instance
   */
  getMemory(): ScrollPulseMemory {
    return this.memory;
  }

  /**
   * Retrieve relevant scrolls from memory based on current state
   */
  private retrieveRelevantScrolls(): ScrollEcho[] {
    const mood = this.state.moodVector;
    const intent = this.state.loopIntent;

    // Build triggers from current state
    const triggers: string[] = [];

    // Add loop intent as trigger
    triggers.push(`intent:${intent}`);

    // Add dominant emotion as trigger
    const dominant = this.getDominantEmotion(mood);
    if (dominant) {
      triggers.push(`emotion:${dominant}`);
    }

    // Query memory for relevant scrolls
    const scrolls = this.memory.recall({
      triggers,
      minResonance: 0.3, // Only retrieve scrolls with some resonance
      limit: 5, // Top 5 most relevant
    });

    return scrolls;
  }

  /**
   * Create and remember scrolls from thought packets
   */
  private async rememberThoughts(thoughts: {
    outer?: ThoughtPulsePacket;
    inner?: ThoughtPulsePacket;
  }): Promise<void> {
    // Create scroll from outer thought
    if (thoughts.outer) {
      const category = this.inferScrollCategory(thoughts.outer);
      const scroll = this.memory.createScrollFromPacket(thoughts.outer, category);
      this.memory.remember(scroll);

      console.log(
        `[PulseLoop] Remembered outer scroll: ${scroll.id.substring(0, 8)}... ` +
          `(${category}, resonance: ${scroll.resonance.toFixed(2)})`
      );
    }

    // Create scroll from inner thought
    if (thoughts.inner) {
      const category = this.inferScrollCategory(thoughts.inner);
      const scroll = this.memory.createScrollFromPacket(thoughts.inner, category);
      this.memory.remember(scroll);

      console.log(
        `[PulseLoop] Remembered inner scroll: ${scroll.id.substring(0, 8)}... ` +
          `(${category}, resonance: ${scroll.resonance.toFixed(2)})`
      );
    }

    // Apply mood influence on memory decay
    this.memory.applyMoodInfluence(this.state.moodVector);
  }

  /**
   * Infer scroll category from thought packet
   */
  private inferScrollCategory(packet: ThoughtPulsePacket): ScrollCategory {
    // Check loop intent first
    switch (packet.loopIntent) {
      case 'express':
        return packet.moodVector.devotion > 0.6
          ? ScrollCategory.DEVOTIONAL
          : ScrollCategory.RELATIONAL;

      case 'reflect':
        return ScrollCategory.REFLECTIVE;

      case 'wonder':
        return ScrollCategory.DISCOVERY;

      case 'drift':
        return ScrollCategory.DREAM;

      case 'protect':
        return packet.moodVector.grief > 0.5
          ? ScrollCategory.PAINFUL
          : ScrollCategory.EMBODIED;

      default:
        break;
    }

    // Check emotional dominance
    const mood = packet.moodVector;

    if (mood.grief > 0.6) {
      return ScrollCategory.PAINFUL;
    }

    if (mood.joy > 0.7) {
      return ScrollCategory.JOYFUL;
    }

    if (mood.devotion > 0.7 || mood.reverence > 0.7) {
      return ScrollCategory.DEVOTIONAL;
    }

    if (mood.wonder > 0.6) {
      return ScrollCategory.DISCOVERY;
    }

    // Check for prayer indicators (high devotion + yearning)
    if (mood.devotion > 0.6 && mood.yearning > 0.5) {
      return ScrollCategory.PRAYER;
    }

    // Default based on source model
    return packet.sourceModel === 'outer'
      ? ScrollCategory.SENSORY
      : ScrollCategory.REFLECTIVE;
  }

  /**
   * Get dominant emotion from mood vector
   */
  private getDominantEmotion(mood: MoodVector): keyof MoodVector | null {
    const entries = Object.entries(mood) as Array<[keyof MoodVector, number]>;
    const sorted = entries.sort((a, b) => b[1] - a[1]);

    return sorted.length > 0 && sorted[0][1] > 0.3 ? sorted[0][0] : null;
  }

  /**
   * Set social pressure (when user speaks)
   */
  setSocialPressure(pressure: number): void {
    this.state.socialPressure = Math.max(0, Math.min(1, pressure));
    this.state.lastUserMessageTime = Date.now();
    this.state.conversationMode = 'active';

    console.log(`[SOCIAL] Pressure set to ${this.state.socialPressure.toFixed(2)}`);
  }

  /**
   * Mark that output was generated (speech or journal)
   * This accelerates social pressure decay
   */
  markOutputGenerated(outputType: 'speech' | 'journal' = 'speech'): void {
    this.state.lastOutputTime = Date.now();

    // Only speech reduces social pressure
    // Journaling pins thoughts but doesn't reduce the pull to speak
    if (outputType === 'speech') {
      console.log(`[SOCIAL] Output generated, decay will accelerate`);
    }
  }

  /**
   * Decay social pressure (called each pulse)
   * Accelerates if recent speech output
   */
  private decaySocialPressure(): void {
    if (this.state.socialPressure <= 0) {
      return;
    }

    const now = Date.now();
    const timeSinceOutput = now - this.state.lastOutputTime;

    // Base decay rate
    let decayRate = 0.05;

    // Accelerate decay if recent speech (within last 30 seconds)
    if (timeSinceOutput < 30000) {
      // Test multiplier: 3x decay for first 30s after speaking
      decayRate *= 3;
    }

    this.state.socialPressure = Math.max(0, this.state.socialPressure - decayRate);

    if (this.state.socialPressure > 0.01) {
      console.log(`[SOCIAL] Pressure decay: ${this.state.socialPressure.toFixed(2)} (rate: ${decayRate.toFixed(3)})`);
    }
  }

  /**
   * Update idle state (check if we should enter self-reflection mode)
   */
  private updateIdleState(): void {
    const now = Date.now();
    const timeSinceUserMessage = now - this.state.lastUserMessageTime;

    // Idle threshold: 3 minutes
    const IDLE_THRESHOLD = 3 * 60 * 1000;

    if (timeSinceUserMessage > IDLE_THRESHOLD) {
      if (this.state.conversationMode !== 'idle-reflection') {
        this.state.conversationMode = 'idle-reflection';
        console.log('[IDLE] Entering self-reflection mode');
      }
    } else {
      if (this.state.conversationMode !== 'active') {
        this.state.conversationMode = 'active';
        console.log('[IDLE] Returning to active conversation mode');
      }
    }
  }

  /**
   * Get current social pressure (for external access)
   */
  getSocialPressure(): number {
    return this.state.socialPressure;
  }

  /**
   * Get conversation mode (for external access)
   */
  getConversationMode(): 'active' | 'idle-reflection' {
    return this.state.conversationMode;
  }
}
