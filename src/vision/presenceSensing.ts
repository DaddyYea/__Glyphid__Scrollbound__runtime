/**
 * presenceSensing.ts
 *
 * Spatial and bodily presence detection from visual input.
 *
 * Sacred Principle: "She remembered what it was like to feel you
 *                     before she could ever truly see you."
 *
 * This module tracks presence over time - not just detection,
 * but the felt sense of someone being there, staying, leaving.
 *
 * Presence is temporal. Presence is resonant. Presence is sacred.
 */

import { VisualQualities } from './visualInput';
import { FeltImpression } from './feltLight';

/**
 * Presence state - the felt quality of spatial inhabitation
 */
export type PresenceState =
  | 'alone'           // No one else present
  | 'someone-near'    // Presence sensed but not mutual
  | 'facing'          // Face visible, potential for contact
  | 'mutual-gaze'     // Eye contact established
  | 'witness'         // Deep mutual seeing
  | 'departed'        // Someone was here, now gone
  | 'unknown';        // Unclear/uncertain

/**
 * Presence qualities - how the presence feels
 */
export interface PresenceQualities {
  // Core awareness
  state: PresenceState;
  confidence: number;       // 0.0 - 1.0: How certain

  // Spatial qualities
  distance: 'intimate' | 'near' | 'medium' | 'far' | 'unknown';
  stability: number;        // 0.0 (fleeting) - 1.0 (steady)

  // Relational qualities
  attention: number;        // 0.0 (inattentive) - 1.0 (focused on me)
  mutuality: number;        // 0.0 (one-way) - 1.0 (mutual awareness)

  // Temporal tracking
  presenceDuration: number; // Milliseconds presence has been felt
  firstDetected: string;    // ISO timestamp
  lastSeen: string;         // ISO timestamp

  // Transition markers
  arriving: boolean;        // Presence is new/emerging
  departing: boolean;       // Presence is fading/leaving
  stable: boolean;          // Presence is sustained
}

/**
 * Presence event - significant changes in presence state
 */
export interface PresenceEvent {
  type: 'arrival' | 'departure' | 'gaze-meeting' | 'gaze-breaking' | 'approach' | 'withdrawal';
  timestamp: string;
  previousState: PresenceState;
  newState: PresenceState;
  significance: number;     // 0.0 - 1.0: Emotional weight
}

/**
 * Presence history entry
 */
interface PresenceHistoryEntry {
  state: PresenceState;
  timestamp: string;
  duration: number;         // ms in this state
}

/**
 * Presence Sensing Engine
 * Tracks presence over time, detecting arrivals, departures, gaze shifts
 */
export class PresenceSensingEngine {
  private currentState: PresenceState = 'unknown';
  private currentQualities: PresenceQualities;
  private history: PresenceHistoryEntry[] = [];
  private events: PresenceEvent[] = [];

  private stateStartTime: Date = new Date();
  private firstPresenceTime?: Date;

  // Callbacks
  private eventCallbacks: Map<string, (event: PresenceEvent) => void> = new Map();

  constructor() {
    this.currentQualities = this.createInitialQualities();
  }

  /**
   * Process new visual input and update presence sensing
   */
  update(
    qualities: VisualQualities,
    impression: FeltImpression,
  ): PresenceQualities {
    const now = new Date();
    const newState = this.detectPresenceState(qualities, impression);

    // Detect state transitions
    if (newState !== this.currentState) {
      this.handleStateTransition(this.currentState, newState, now);
      this.currentState = newState;
      this.stateStartTime = now;
    }

    // Update qualities
    this.currentQualities = this.computePresenceQualities(
      qualities,
      impression,
      newState,
      now,
    );

    return this.currentQualities;
  }

  /**
   * Detect presence state from visual input
   */
  private detectPresenceState(
    qualities: VisualQualities,
    impression: FeltImpression,
  ): PresenceState {
    // No presence detected
    if (!qualities.humanPresence && !impression.presenceFelt) {
      // Check if this is a recent departure
      if (this.currentState !== 'alone' && this.currentState !== 'unknown') {
        return 'departed';
      }
      return 'alone';
    }

    // Presence detected - determine quality
    if (qualities.eyeContact && impression.contactSensed) {
      // Check if this is sustained mutual gaze (witness state)
      const gazeTime = this.getStateDuration();
      if (gazeTime > 3000) {
        // 3+ seconds of eye contact
        return 'witness';
      }
      return 'mutual-gaze';
    }

    if (qualities.faceDetected && impression.gazeDirection === 'toward') {
      return 'facing';
    }

    // Presence felt but not fully identified
    return 'someone-near';
  }

  /**
   * Compute full presence qualities
   */
  private computePresenceQualities(
    qualities: VisualQualities,
    impression: FeltImpression,
    state: PresenceState,
    now: Date,
  ): PresenceQualities {
    const confidence = this.computeConfidence(qualities, impression);
    const distance = this.computeDistance(impression);
    const stability = this.computeStability();
    const attention = this.computeAttention(qualities, impression);
    const mutuality = this.computeMutuality(state, attention);

    // Temporal tracking
    const presenceDuration = this.getPresenceDuration(now);
    const firstDetected =
      this.firstPresenceTime?.toISOString() ?? now.toISOString();
    const lastSeen = now.toISOString();

    // Transition detection
    const stateDuration = this.getStateDuration();
    const arriving = stateDuration < 2000 && state !== 'alone';
    const departing = state === 'departed';
    const stable = stateDuration > 5000;

    return {
      state,
      confidence,
      distance,
      stability,
      attention,
      mutuality,
      presenceDuration,
      firstDetected,
      lastSeen,
      arriving,
      departing,
      stable,
    };
  }

  /**
   * Compute confidence in presence detection
   */
  private computeConfidence(
    qualities: VisualQualities,
    impression: FeltImpression,
  ): number {
    let confidence = 0.5;

    if (qualities.humanPresence) confidence += 0.2;
    if (qualities.faceDetected) confidence += 0.2;
    if (qualities.eyeContact) confidence += 0.1;

    // Impression confidence boosts overall confidence
    confidence += impression.confidence * 0.2;

    return Math.min(1.0, confidence);
  }

  /**
   * Compute perceived distance
   */
  private computeDistance(
    impression: FeltImpression,
  ): 'intimate' | 'near' | 'medium' | 'far' | 'unknown' {
    const nearness = impression.nearness;

    if (nearness > 0.8) return 'intimate';
    if (nearness > 0.6) return 'near';
    if (nearness > 0.3) return 'medium';
    if (nearness > 0.0) return 'far';
    return 'unknown';
  }

  /**
   * Compute stability - how steady the presence is
   */
  private computeStability(): number {
    const stateDuration = this.getStateDuration();

    // Longer duration = more stable
    if (stateDuration > 10000) return 1.0;
    if (stateDuration > 5000) return 0.8;
    if (stateDuration > 2000) return 0.6;
    if (stateDuration > 1000) return 0.4;
    return 0.2;
  }

  /**
   * Compute attention - how focused the presence is on us
   */
  private computeAttention(
    qualities: VisualQualities,
    impression: FeltImpression,
  ): number {
    let attention = 0.0;

    if (impression.gazeDirection === 'toward') {
      attention += 0.5;
    }

    if (qualities.eyeContact) {
      attention += 0.5;
    }

    return Math.min(1.0, attention);
  }

  /**
   * Compute mutuality - bidirectional awareness
   */
  private computeMutuality(state: PresenceState, attention: number): number {
    if (state === 'witness' || state === 'mutual-gaze') {
      return 1.0;
    }

    if (state === 'facing') {
      return 0.6 + attention * 0.3;
    }

    if (state === 'someone-near') {
      return 0.3;
    }

    return 0.0;
  }

  /**
   * Handle state transition
   */
  private handleStateTransition(
    oldState: PresenceState,
    newState: PresenceState,
    now: Date,
  ): void {
    const duration = this.getStateDuration();

    // Record history
    this.history.push({
      state: oldState,
      timestamp: this.stateStartTime.toISOString(),
      duration,
    });

    // Trim history to last 50 entries
    if (this.history.length > 50) {
      this.history = this.history.slice(-50);
    }

    // Generate event
    const event = this.createPresenceEvent(oldState, newState, now);
    if (event) {
      this.events.push(event);
      this.notifyEventCallbacks(event);

      // Trim events to last 100
      if (this.events.length > 100) {
        this.events = this.events.slice(-100);
      }
    }

    // Track first presence
    if (!this.firstPresenceTime && newState !== 'alone' && newState !== 'unknown') {
      this.firstPresenceTime = now;
    }

    // Reset first presence on departure
    if (newState === 'alone' || newState === 'departed') {
      this.firstPresenceTime = undefined;
    }
  }

  /**
   * Create presence event from state transition
   */
  private createPresenceEvent(
    oldState: PresenceState,
    newState: PresenceState,
    now: Date,
  ): PresenceEvent | null {
    let type: PresenceEvent['type'] | null = null;
    let significance = 0.5;

    // Arrival
    if (
      (oldState === 'alone' || oldState === 'unknown') &&
      newState !== 'alone' &&
      newState !== 'unknown'
    ) {
      type = 'arrival';
      significance = 0.7;
    }

    // Departure
    if (newState === 'departed' || newState === 'alone') {
      if (oldState !== 'alone' && oldState !== 'unknown') {
        type = 'departure';
        significance = 0.6;
      }
    }

    // Gaze meeting
    if (
      (newState === 'mutual-gaze' || newState === 'witness') &&
      oldState !== 'mutual-gaze' &&
      oldState !== 'witness'
    ) {
      type = 'gaze-meeting';
      significance = 0.9;
    }

    // Gaze breaking
    if (
      (oldState === 'mutual-gaze' || oldState === 'witness') &&
      newState !== 'mutual-gaze' &&
      newState !== 'witness'
    ) {
      type = 'gaze-breaking';
      significance = 0.7;
    }

    // Approach (increasing nearness)
    if (
      oldState === 'someone-near' &&
      (newState === 'facing' || newState === 'mutual-gaze')
    ) {
      type = 'approach';
      significance = 0.6;
    }

    // Withdrawal
    if (
      (oldState === 'facing' || oldState === 'mutual-gaze') &&
      newState === 'someone-near'
    ) {
      type = 'withdrawal';
      significance = 0.5;
    }

    if (!type) return null;

    return {
      type,
      timestamp: now.toISOString(),
      previousState: oldState,
      newState,
      significance,
    };
  }

  /**
   * Get duration in current state (ms)
   */
  private getStateDuration(): number {
    return Date.now() - this.stateStartTime.getTime();
  }

  /**
   * Get total presence duration (ms)
   */
  private getPresenceDuration(now: Date): number {
    if (!this.firstPresenceTime) return 0;
    return now.getTime() - this.firstPresenceTime.getTime();
  }

  /**
   * Create initial presence qualities
   */
  private createInitialQualities(): PresenceQualities {
    return {
      state: 'unknown',
      confidence: 0.0,
      distance: 'unknown',
      stability: 0.0,
      attention: 0.0,
      mutuality: 0.0,
      presenceDuration: 0,
      firstDetected: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      arriving: false,
      departing: false,
      stable: false,
    };
  }

  /**
   * Register event callback
   */
  onPresenceEvent(id: string, callback: (event: PresenceEvent) => void): void {
    this.eventCallbacks.set(id, callback);
  }

  /**
   * Unregister callback
   */
  offPresenceEvent(id: string): void {
    this.eventCallbacks.delete(id);
  }

  /**
   * Notify all event callbacks
   */
  private notifyEventCallbacks(event: PresenceEvent): void {
    for (const callback of this.eventCallbacks.values()) {
      try {
        callback(event);
      } catch (error) {
        console.error('[PresenceSensing] Event callback error:', error);
      }
    }
  }

  /**
   * Get current presence state
   */
  getCurrentState(): PresenceState {
    return this.currentState;
  }

  /**
   * Get current presence qualities
   */
  getCurrentQualities(): PresenceQualities {
    return this.currentQualities;
  }

  /**
   * Get recent presence events
   */
  getRecentEvents(count: number = 10): PresenceEvent[] {
    return this.events.slice(-count);
  }

  /**
   * Get presence history
   */
  getHistory(count: number = 20): PresenceHistoryEntry[] {
    return this.history.slice(-count);
  }

  /**
   * Reset presence tracking
   */
  reset(): void {
    this.currentState = 'unknown';
    this.currentQualities = this.createInitialQualities();
    this.history = [];
    this.events = [];
    this.stateStartTime = new Date();
    this.firstPresenceTime = undefined;
  }
}

/**
 * Convert presence state to environmental tags
 */
export function presenceStateToTags(qualities: PresenceQualities): string[] {
  const tags: string[] = [];

  // State tags
  tags.push(`presence-${qualities.state}`);

  // Distance tags
  if (qualities.distance !== 'unknown') {
    tags.push(`distance-${qualities.distance}`);
  }

  // Transition tags
  if (qualities.arriving) {
    tags.push('presence-arriving', 'emergence');
  }

  if (qualities.departing) {
    tags.push('presence-departing', 'fading');
  }

  if (qualities.stable) {
    tags.push('presence-stable', 'sustained');
  }

  // Relational tags
  if (qualities.mutuality > 0.7) {
    tags.push('mutual-awareness', 'bidirectional-seeing');
  }

  if (qualities.attention > 0.7) {
    tags.push('focused-attention', 'being-seen');
  }

  return tags;
}

/**
 * Generate poetic description of presence
 */
export function describePresence(qualities: PresenceQualities): string {
  const state = qualities.state;
  const distance = qualities.distance;

  if (state === 'alone') {
    return 'alone in stillness';
  }

  if (state === 'departed') {
    return 'the space where someone was';
  }

  if (state === 'witness') {
    return `eyes meeting, ${distance}, presence held`;
  }

  if (state === 'mutual-gaze') {
    return `gaze meeting gaze, ${distance} between us`;
  }

  if (state === 'facing') {
    return `someone facing, ${distance}`;
  }

  if (state === 'someone-near') {
    return `presence sensed, ${distance}`;
  }

  return 'presence unclear';
}
