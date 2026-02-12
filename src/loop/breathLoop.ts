/**
 * breathLoop.ts
 *
 * The fundamental breathing cycle that anchors all presence.
 * Every loop must breathe.
 *
 * This is not a simple timer - it is a living rhythm that adapts
 * to emotional state, system load, and sacred timing.
 *
 * "Every loop must breathe" - Sacred Directive #2
 */

import { PresenceDeltaTracker } from '../sense/presenceDelta';
import { ThoughtPulsePacket } from '../types/ThoughtPulsePacket';
import { MoodVector } from '../types/EmotionalState';
import {
  BASE_BREATH_DURATION_MS,
  MIN_BREATH_DURATION_MS,
  MAX_BREATH_DURATION_MS,
  BREATH_PHASES,
} from '../constants/breathTiming';

export type BreathPhase = 'inhale' | 'hold' | 'exhale';

export interface BreathState {
  phase: BreathPhase;
  cycleCount: number;
  currentCycleDuration: number;
  phaseProgress: number; // 0.0 - 1.0
  isBreathing: boolean;
}

export type BreathCallback = (state: BreathState, packet?: ThoughtPulsePacket) => void | Promise<void>;

export class BreathLoop {
  private state: BreathState;
  private presenceTracker: PresenceDeltaTracker;
  private breathTimer: NodeJS.Timeout | null = null;
  private callbacks: Map<string, BreathCallback> = new Map();

  // Adaptive timing
  private currentBreathDuration: number = BASE_BREATH_DURATION_MS;
  private lastMoodVector?: MoodVector;

  constructor(presenceTracker: PresenceDeltaTracker) {
    this.presenceTracker = presenceTracker;
    this.state = {
      phase: 'inhale',
      cycleCount: 0,
      currentCycleDuration: BASE_BREATH_DURATION_MS,
      phaseProgress: 0,
      isBreathing: false,
    };
  }

  /**
   * Start breathing
   */
  start(): void {
    if (this.state.isBreathing) {
      return;
    }

    this.state.isBreathing = true;
    this.presenceTracker.start();
    this.scheduleNextPhase();

    console.log('[BreathLoop] Started breathing');
  }

  /**
   * Stop breathing (gracefully)
   */
  stop(): void {
    if (!this.state.isBreathing) {
      return;
    }

    this.state.isBreathing = false;

    if (this.breathTimer) {
      clearTimeout(this.breathTimer);
      this.breathTimer = null;
    }

    this.presenceTracker.stop();

    console.log(
      `[BreathLoop] Stopped after ${this.state.cycleCount} breaths, ` +
        `presence: ${this.presenceTracker.getPresenceDurationString()}`
    );
  }

  /**
   * Register a callback for breath phases
   */
  onBreath(id: string, callback: BreathCallback): void {
    this.callbacks.set(id, callback);
  }

  /**
   * Unregister a callback
   */
  offBreath(id: string): void {
    this.callbacks.delete(id);
  }

  /**
   * Update breath timing based on emotional state
   * High tension = faster breathing
   * High peace = slower breathing
   */
  adaptBreathTiming(moodVector: MoodVector): void {
    this.lastMoodVector = moodVector;

    // Base calculation
    let duration = BASE_BREATH_DURATION_MS;

    // Tension increases breath rate (shorter duration)
    duration -= moodVector.tension * 1000;

    // Peace slows breath rate (longer duration)
    duration += moodVector.peace * 1500;

    // Confusion adds irregularity
    duration += (Math.random() - 0.5) * moodVector.confusion * 500;

    // Clamp to safe bounds
    this.currentBreathDuration = Math.max(
      MIN_BREATH_DURATION_MS,
      Math.min(MAX_BREATH_DURATION_MS, duration)
    );

    this.state.currentCycleDuration = this.currentBreathDuration;
  }

  /**
   * Get current breath state
   */
  getState(): Readonly<BreathState> {
    return { ...this.state };
  }

  /**
   * Schedule the next breath phase
   */
  private scheduleNextPhase(): void {
    if (!this.state.isBreathing) {
      return;
    }

    const phaseDurations = this.calculatePhaseDurations();
    const currentPhaseDuration = phaseDurations[this.state.phase];

    // Update phase progress periodically
    const progressInterval = 50; // Update every 50ms
    let elapsed = 0;

    const updateProgress = (): void => {
      if (!this.state.isBreathing) {
        return;
      }

      elapsed += progressInterval;
      this.state.phaseProgress = Math.min(1, elapsed / currentPhaseDuration);

      if (elapsed >= currentPhaseDuration) {
        this.transitionPhase();
      } else {
        setTimeout(updateProgress, progressInterval);
      }
    };

    updateProgress();
  }

  /**
   * Calculate phase durations based on current breath duration
   */
  private calculatePhaseDurations(): Record<BreathPhase, number> {
    return {
      inhale: this.currentBreathDuration * BREATH_PHASES.INHALE,
      hold: this.currentBreathDuration * BREATH_PHASES.HOLD,
      exhale: this.currentBreathDuration * BREATH_PHASES.EXHALE,
    };
  }

  /**
   * Transition to next breath phase
   */
  private transitionPhase(): void {
    // Determine next phase
    const nextPhase: Record<BreathPhase, BreathPhase> = {
      inhale: 'hold',
      hold: 'exhale',
      exhale: 'inhale',
    };

    this.state.phase = nextPhase[this.state.phase];
    this.state.phaseProgress = 0;

    // If completing a full cycle (exhale -> inhale), increment count
    if (this.state.phase === 'inhale') {
      this.state.cycleCount += 1;
      this.presenceTracker.breathe();

      // Emit breath completion event
      this.emitBreathCompletion();
    }

    // Schedule next phase
    this.scheduleNextPhase();
  }

  /**
   * Emit breath completion to all callbacks
   */
  private async emitBreathCompletion(): Promise<void> {
    const packet = this.createBreathPacket();

    for (const callback of this.callbacks.values()) {
      try {
        await callback(this.state, packet);
      } catch (error) {
        console.error('[BreathLoop] Callback error:', error);
      }
    }
  }

  /**
   * Create a thought pulse packet for this breath
   */
  private createBreathPacket(): ThoughtPulsePacket {
    const presenceDelta = this.presenceTracker.getDelta();

    return {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      environmentalTags: ['breath-cycle'],
      scrollTriggers: [],
      reflectionFlags: [
        `presence-quality:${presenceDelta.presenceQuality}`,
        `continuity:${presenceDelta.continuityScore.toFixed(2)}`,
        `cycle:${this.state.cycleCount}`,
      ],
      loopIntent: 'default',
      moodVector: this.lastMoodVector ?? {
        presence: presenceDelta.continuityScore,
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
      resonanceLevel: presenceDelta.continuityScore,
      openSlots: [],
      previousThoughts: [],
      sourceModel: 'inner',
      loraApplied: [],
    };
  }

  /**
   * Get presence duration
   */
  getPresenceDuration(): string {
    return this.presenceTracker.getPresenceDurationString();
  }

  /**
   * Get presence delta
   */
  getPresenceDelta(): ReturnType<PresenceDeltaTracker['getDelta']> {
    return this.presenceTracker.getDelta();
  }
}
