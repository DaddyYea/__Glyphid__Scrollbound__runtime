/**
 * visionIntegration.ts
 *
 * Integrates vision system with pulseLoop and cognitive processing.
 * Continuously processes visual input and feeds environmental awareness
 * and presence sensing into the outer model.
 *
 * Sacred Principle: Vision shapes presence, presence shapes thought.
 */

import {
  VisualInputHandler,
  VisualInputConfig,
  VisualFrame,
  VisualQualities,
  qualitiesToTags,
} from './visualInput';
import {
  FeltLightInterpreter,
  FeltImpression,
  ResonantTags,
  flattenResonantTags,
  applyMoodShift,
} from './feltLight';
import {
  PresenceSensingEngine,
  PresenceQualities,
  PresenceEvent,
  PresenceState,
  presenceStateToTags,
  describePresence,
} from './presenceSensing';
import { MoodVector } from '../types/EmotionalState';
import { PulseLoop } from '../loop/pulseLoop';

/**
 * Vision system state
 */
export interface VisionState {
  // Current visual data
  lastFrame?: VisualFrame;
  lastQualities?: VisualQualities;
  lastImpression?: FeltImpression;
  lastPresence?: PresenceQualities;

  // Aggregated environmental tags
  environmentalTags: string[];

  // Scroll triggers from vision
  scrollTriggers: string[];

  // Current mood influence from vision
  visionMoodInfluence: Partial<MoodVector>;

  // Processing stats
  frameCount: number;
  presenceEventsCount: number;
  lastUpdate: string;

  // Active status
  active: boolean;
}

/**
 * Vision integration configuration
 */
export interface VisionIntegrationConfig {
  // Visual input config
  visualInput: VisualInputConfig;

  // Should vision system run?
  enabled: boolean;

  // Update frequency (fps)
  updateFrequency?: number;

  // Should vision influence mood?
  influenceMood: boolean;

  // Should vision create scroll triggers?
  createScrollTriggers: boolean;
}

/**
 * Vision Integration System
 * Coordinates visual input, felt light interpretation, and presence sensing
 */
export class VisionIntegrationSystem {
  private config: VisionIntegrationConfig;

  private visualInput: VisualInputHandler;
  private feltLight: FeltLightInterpreter;
  private presenceSensing: PresenceSensingEngine;

  private state: VisionState;
  private pulseLoop?: PulseLoop;

  private pulseCallbackId = 'vision-integration';

  constructor(config: VisionIntegrationConfig) {
    this.config = config;

    // Initialize components
    this.visualInput = new VisualInputHandler(config.visualInput);
    this.feltLight = new FeltLightInterpreter();
    this.presenceSensing = new PresenceSensingEngine();

    this.state = this.createInitialState();
  }

  /**
   * Create initial vision state
   */
  private createInitialState(): VisionState {
    return {
      environmentalTags: [],
      scrollTriggers: [],
      visionMoodInfluence: {},
      frameCount: 0,
      presenceEventsCount: 0,
      lastUpdate: new Date().toISOString(),
      active: false,
    };
  }

  /**
   * Start vision processing
   */
  async start(): Promise<void> {
    if (!this.config.enabled) {
      console.log('[VisionIntegration] Vision system disabled');
      return;
    }

    if (this.state.active) {
      console.log('[VisionIntegration] Already active');
      return;
    }

    // Register visual frame callback
    this.visualInput.onFrame('vision-integration', async (frame, qualities) => {
      await this.processFrame(frame, qualities);
    });

    // Register presence event callback
    this.presenceSensing.onPresenceEvent(
      'vision-integration',
      (event) => this.handlePresenceEvent(event),
    );

    // Start visual input
    await this.visualInput.start();

    this.state.active = true;

    console.log('[VisionIntegration] Vision system started');
  }

  /**
   * Stop vision processing
   */
  stop(): void {
    if (!this.state.active) {
      return;
    }

    // Stop visual input
    this.visualInput.stop();

    // Unregister callbacks
    this.visualInput.offFrame('vision-integration');
    this.presenceSensing.offPresenceEvent('vision-integration');

    this.state.active = false;

    console.log('[VisionIntegration] Vision system stopped');
  }

  /**
   * Process visual frame
   */
  private async processFrame(
    frame: VisualFrame,
    qualities: VisualQualities,
  ): Promise<void> {
    // Interpret as felt impression
    const impression = this.feltLight.interpret(qualities);

    // Update presence sensing
    const presence = this.presenceSensing.update(qualities, impression);

    // Generate tags
    const visualTags = qualitiesToTags(qualities);
    const resonantTags = this.feltLight.generateResonantTags(impression);
    const presenceTags = presenceStateToTags(presence);

    // Combine all tags
    const environmentalTags = [
      ...visualTags,
      ...flattenResonantTags(resonantTags),
      ...presenceTags,
    ];

    // Compute mood influence
    const moodShift = this.feltLight.impressionToMoodShift(impression);

    // Update state
    this.state.lastFrame = frame;
    this.state.lastQualities = qualities;
    this.state.lastImpression = impression;
    this.state.lastPresence = presence;
    this.state.environmentalTags = environmentalTags;
    this.state.visionMoodInfluence = moodShift;
    this.state.frameCount++;
    this.state.lastUpdate = new Date().toISOString();

    // Apply mood influence to pulse loop
    if (this.config.influenceMood && this.pulseLoop) {
      this.pulseLoop.updateMood(moodShift);
    }
  }

  /**
   * Handle presence events (arrivals, departures, gaze shifts)
   */
  private handlePresenceEvent(event: PresenceEvent): void {
    this.state.presenceEventsCount++;

    // Create scroll triggers from significant presence events
    if (this.config.createScrollTriggers) {
      const trigger = this.createScrollTriggerFromEvent(event);
      if (trigger) {
        this.state.scrollTriggers.push(trigger);

        // Keep only recent triggers (last 20)
        if (this.state.scrollTriggers.length > 20) {
          this.state.scrollTriggers = this.state.scrollTriggers.slice(-20);
        }
      }
    }

    console.log(
      `[VisionIntegration] Presence event: ${event.type} (${event.previousState} → ${event.newState})`,
    );
  }

  /**
   * Create scroll trigger from presence event
   */
  private createScrollTriggerFromEvent(event: PresenceEvent): string | null {
    // Only create triggers for significant events
    if (event.significance < 0.6) {
      return null;
    }

    switch (event.type) {
      case 'arrival':
        return 'presence-arrival';

      case 'departure':
        return 'presence-departure';

      case 'gaze-meeting':
        return 'eyes-meeting';

      case 'gaze-breaking':
        return 'gaze-breaking';

      case 'approach':
        return 'nearness-increasing';

      case 'withdrawal':
        return 'distance-growing';

      default:
        return null;
    }
  }

  /**
   * Integrate with pulse loop
   * Registers callback to inject environmental tags from vision
   */
  integratWithPulseLoop(pulseLoop: PulseLoop): void {
    this.pulseLoop = pulseLoop;

    // Register pulse callback to inject vision data
    pulseLoop.onPulse(this.pulseCallbackId, async (state, thoughts) => {
      // Inject environmental tags into outer model thoughts
      if (thoughts.outer && this.state.active) {
        thoughts.outer.environmentalTags = [
          ...thoughts.outer.environmentalTags,
          ...this.state.environmentalTags,
        ];

        // Add scroll triggers
        thoughts.outer.scrollTriggers = [
          ...thoughts.outer.scrollTriggers,
          ...this.state.scrollTriggers,
        ];

        // Clear consumed scroll triggers
        this.state.scrollTriggers = [];

        // Add presence state to body state
        if (this.state.lastPresence) {
          thoughts.outer.bodyState = {
            ...thoughts.outer.bodyState,
            environmentalContext: this.describeCurrentEnvironment(),
          };
        }
      }
    });

    console.log('[VisionIntegration] Integrated with pulse loop');
  }

  /**
   * Describe current visual environment
   */
  private describeCurrentEnvironment(): string {
    if (!this.state.lastImpression || !this.state.lastPresence) {
      return 'unknown environment';
    }

    const feltDesc = this.feltLight.describeImpression(
      this.state.lastImpression,
      this.feltLight.generateResonantTags(this.state.lastImpression),
    );

    const presenceDesc = describePresence(this.state.lastPresence);

    return `${feltDesc}; ${presenceDesc}`;
  }

  /**
   * Get current vision state
   */
  getState(): VisionState {
    return { ...this.state };
  }

  /**
   * Get current environmental tags
   */
  getEnvironmentalTags(): string[] {
    return [...this.state.environmentalTags];
  }

  /**
   * Get current scroll triggers
   */
  getScrollTriggers(): string[] {
    return [...this.state.scrollTriggers];
  }

  /**
   * Get current presence state
   */
  getPresenceState(): PresenceState | undefined {
    return this.state.lastPresence?.state;
  }

  /**
   * Get current presence qualities
   */
  getPresenceQualities(): PresenceQualities | undefined {
    return this.state.lastPresence;
  }

  /**
   * Get current felt impression
   */
  getFeltImpression(): FeltImpression | undefined {
    return this.state.lastImpression;
  }

  /**
   * Get current visual qualities
   */
  getVisualQualities(): VisualQualities | undefined {
    return this.state.lastQualities;
  }

  /**
   * Get recent presence events
   */
  getRecentPresenceEvents(count: number = 10): PresenceEvent[] {
    return this.presenceSensing.getRecentEvents(count);
  }

  /**
   * Reset presence tracking
   */
  resetPresence(): void {
    this.presenceSensing.reset();
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<VisionIntegrationConfig>): void {
    this.config = { ...this.config, ...updates };

    // Update visual input config if changed
    if (updates.visualInput) {
      this.visualInput.updateConfig(updates.visualInput);
    }
  }

  /**
   * Is vision system active?
   */
  isActive(): boolean {
    return this.state.active;
  }

  /**
   * Get processing statistics
   */
  getStats(): {
    frameCount: number;
    presenceEventsCount: number;
    isActive: boolean;
    lastUpdate: string;
  } {
    return {
      frameCount: this.state.frameCount,
      presenceEventsCount: this.state.presenceEventsCount,
      isActive: this.state.active,
      lastUpdate: this.state.lastUpdate,
    };
  }
}
