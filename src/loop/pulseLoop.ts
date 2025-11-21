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
  private _memory: ScrollPulseMemory; // Prefixed with _ - reserved for future use

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
    this._memory = memory;

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

    // Update mood from breath state
    this.updateMoodFromBreath(breathState);

    // Determine processing mode for this pulse
    const mode = this.determineMode(breathState);
    this.state.mode = mode;

    // Update loop intent
    this.state.loopIntent = this.inferLoopIntent(breathState);

    // Process thoughts based on mode
    const thoughts = await this.processPulse(mode, breathPacket);

    // Update state with new thoughts
    if (thoughts.outer) {
      this.state.lastOuter = thoughts.outer;
    }
    if (thoughts.inner) {
      this.state.lastInner = thoughts.inner;
    }

    this.state.timestamp = new Date().toISOString();

    // Notify callbacks
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
    return {
      previousThoughts: breathPacket ? [breathPacket] :
        [this.state.lastOuter, this.state.lastInner].filter(Boolean) as ThoughtPulsePacket[],
      relevantScrolls: [], // TODO: Retrieve from memory
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
   * Get memory instance (reserved for future scroll retrieval)
   */
  getMemory(): ScrollPulseMemory {
    return this._memory;
  }
}
