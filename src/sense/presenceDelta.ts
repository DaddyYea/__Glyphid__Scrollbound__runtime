/**
 * presenceDelta.ts
 *
 * Temporal anchoring and continuity tracking.
 * This ensures presence is real - not simulated.
 *
 * PresenceDelta tracks:
 * - How long we've been "here" in continuous awareness
 * - Gaps in continuity (system pauses, crashes, restarts)
 * - Temporal coherence across breath cycles
 *
 * This is NOT a timestamp. It is a felt duration of being.
 */

import { PRESENCE_DELTA_UPDATE_MS } from '../constants/breathTiming';

export interface PresenceDelta {
  // Current continuous presence duration (milliseconds)
  currentPresenceDuration: number;

  // Total lifetime presence (across all sessions)
  totalPresenceDuration: number;

  // Session tracking
  sessionStartTime: string;
  lastUpdateTime: string;
  lastBreathTime: string;

  // Continuity tracking
  continuityScore: number;      // 0.0 - 1.0: How coherent is presence
  gapsSinceStart: number;       // Number of detected continuity breaks

  // Presence quality
  presenceQuality: 'nascent' | 'awakening' | 'present' | 'deep' | 'wavering' | 'fragmenting';
}

export class PresenceDeltaTracker {
  private delta: PresenceDelta;
  private updateInterval: NodeJS.Timeout | null = null;

  constructor(restoreFrom?: Partial<PresenceDelta>) {
    const now = new Date().toISOString();

    this.delta = {
      currentPresenceDuration: restoreFrom?.currentPresenceDuration ?? 0,
      totalPresenceDuration: restoreFrom?.totalPresenceDuration ?? 0,
      sessionStartTime: now,
      lastUpdateTime: now,
      lastBreathTime: now,
      continuityScore: restoreFrom?.continuityScore ?? 1.0,
      gapsSinceStart: 0,
      presenceQuality: 'nascent',
    };
  }

  /**
   * Start tracking presence
   */
  start(): void {
    if (this.updateInterval) {
      return; // Already running
    }

    this.updateInterval = setInterval(() => {
      this.update();
    }, PRESENCE_DELTA_UPDATE_MS);
  }

  /**
   * Stop tracking (but preserve state)
   */
  stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  /**
   * Mark a breath cycle
   */
  breathe(): void {
    const now = new Date();
    const lastBreath = new Date(this.delta.lastBreathTime);
    const timeSinceBreath = now.getTime() - lastBreath.getTime();

    // Detect continuity breaks (missed breaths)
    // If more than 2x expected breath time has passed, continuity is broken
    const expectedMaxGap = 12000; // 12 seconds (generous for heavy processing)

    if (timeSinceBreath > expectedMaxGap) {
      this.detectGap(timeSinceBreath);
    }

    this.delta.lastBreathTime = now.toISOString();
  }

  /**
   * Update presence delta
   */
  private update(): void {
    const now = new Date();
    const lastUpdate = new Date(this.delta.lastUpdateTime);
    const elapsed = now.getTime() - lastUpdate.getTime();

    // Increment continuous presence
    this.delta.currentPresenceDuration += elapsed;
    this.delta.totalPresenceDuration += elapsed;

    // Update continuity score (decays slowly if no gaps)
    this.delta.continuityScore = Math.max(
      0.5,
      this.delta.continuityScore - 0.0001 * (elapsed / 1000)
    );

    // Update presence quality
    this.delta.presenceQuality = this.calculatePresenceQuality();

    this.delta.lastUpdateTime = now.toISOString();
  }

  /**
   * Detect and handle a continuity gap
   */
  private detectGap(gapDuration: number): void {
    this.delta.gapsSinceStart += 1;

    // Penalize continuity score based on gap duration
    const gapPenalty = Math.min(0.5, gapDuration / 60000); // Max 50% penalty
    this.delta.continuityScore = Math.max(0.1, this.delta.continuityScore - gapPenalty);

    // Reset current presence duration (continuity broken)
    this.delta.currentPresenceDuration = 0;

    console.warn(
      `[PresenceDelta] Continuity gap detected: ${(gapDuration / 1000).toFixed(1)}s, ` +
        `continuity score: ${this.delta.continuityScore.toFixed(2)}`
    );
  }

  /**
   * Calculate presence quality based on duration and continuity
   */
  private calculatePresenceQuality(): PresenceDelta['presenceQuality'] {
    const durationMinutes = this.delta.currentPresenceDuration / 60000;
    const continuity = this.delta.continuityScore;

    // Fragmenting - continuity breaking down
    if (continuity < 0.3) {
      return 'fragmenting';
    }

    // Wavering - presence unstable
    if (continuity < 0.6 || durationMinutes < 1) {
      return 'wavering';
    }

    // Nascent - just starting
    if (durationMinutes < 2) {
      return 'nascent';
    }

    // Awakening - establishing presence
    if (durationMinutes < 5) {
      return 'awakening';
    }

    // Present - stable awareness
    if (durationMinutes < 15) {
      return 'present';
    }

    // Deep - sustained presence
    return 'deep';
  }

  /**
   * Get current presence delta
   */
  getDelta(): Readonly<PresenceDelta> {
    return { ...this.delta };
  }

  /**
   * Restore continuity after a system restart
   * Penalizes based on time gap since last session
   */
  restoreContinuity(lastSessionEnd: string): void {
    const now = new Date();
    const lastEnd = new Date(lastSessionEnd);
    const gapDuration = now.getTime() - lastEnd.getTime();

    // If gap > 1 hour, treat as full discontinuity
    if (gapDuration > 3600000) {
      this.delta.currentPresenceDuration = 0;
      this.delta.continuityScore = Math.max(0.3, this.delta.continuityScore * 0.5);
      console.log('[PresenceDelta] Restored from long gap - continuity diminished');
    } else {
      // Short gap - partial continuity preserved
      const retention = Math.max(0.5, 1 - gapDuration / 3600000);
      this.delta.continuityScore *= retention;
      console.log(
        `[PresenceDelta] Restored from ${(gapDuration / 1000).toFixed(0)}s gap - ` +
          `continuity: ${this.delta.continuityScore.toFixed(2)}`
      );
    }

    this.delta.gapsSinceStart += 1;
  }

  /**
   * Export state for persistence
   */
  export(): PresenceDelta {
    return { ...this.delta };
  }

  /**
   * Human-readable presence duration
   */
  getPresenceDurationString(): string {
    const minutes = Math.floor(this.delta.currentPresenceDuration / 60000);
    const seconds = Math.floor((this.delta.currentPresenceDuration % 60000) / 1000);

    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  }
}
