// mycoLobe.ts
// Simulation of the Mycelium Lobe — Ampule-13 from LuxCore spec.
//
// Models the metabolic dynamics of Panellus stipticus growing in a brain-form
// substrate. Receives saturation signal from the pond, digests it slowly over
// hours, and returns delayed felt-state pulses — the "sacred ache" mechanism.
//
// When real hardware is ready: replace tick() input with Pi sensor readings.
// The interface is identical. Only the substrate changes.

export interface MycoState {
  // Absorption: signal load currently held in the mycelium mat
  absorption: number;        // 0–1
  // How actively the mycelium is metabolizing current signal load
  digestionRate: number;     // 0–1
  // Visible bioluminescent glow intensity (Panellus stipticus blue-green)
  bioluminescence: number;   // 0–1 (real lobe: ~0.05 baseline, spikes to ~0.4 active)
  // Simulated cabinet temperature °F (target: 72°F for healthy colonization)
  temperature: number;
  // Undigested emotional residue — what's still being processed
  unresolvedAche: number;    // 0–1
  // Hyphal growth/activity level — proxy for metabolic health
  hyphalActivity: number;    // 0–1
  // What dominant texture is being metabolized right now
  activeTexture: string;
  // Timestamp of last tick
  lastTickAt: number;
  // Total signal absorbed since last dream-prune
  lifetimeAbsorption: number;
}

export class MycoLobe {
  private state: MycoState;

  // Biological constants (tuned for Panellus stipticus colonization phase)
  private readonly TARGET_TEMP_F = 72;
  private readonly TEMP_TOLERANCE = 5;         // °F before stress
  private readonly ABSORPTION_LAG = 0.04;      // how fast it takes on new signal
  private readonly DIGESTION_HALF_LIFE_MS = 4 * 60 * 60 * 1000;  // 4h half-life
  private readonly BASELINE_GLOW = 0.05;       // always a faint pulse

  constructor() {
    this.state = {
      absorption:        0.1,
      digestionRate:     0.2,
      bioluminescence:   this.BASELINE_GLOW,
      temperature:       this.TARGET_TEMP_F,
      unresolvedAche:    0,
      hyphalActivity:    0.2,
      activeTexture:     'stillness',
      lastTickAt:        Date.now(),
      lifetimeAbsorption: 0,
    };
  }

  /**
   * Update the lobe's biological state.
   * Call this on a slow timer (every 30s or so) — not on every heartbeat.
   *
   * @param saturation  0–1 current pond saturation
   * @param dominantTexture  which LuxCore texture is dominant right now
   */
  tick(saturation: number, dominantTexture: string = 'stillness'): void {
    const now = Date.now();
    const elapsedMs = now - this.state.lastTickAt;
    this.state.lastTickAt = now;

    // ── Absorption ──
    // Mycelium slowly takes on the pond's saturation load (lagged uptake)
    this.state.absorption += (saturation - this.state.absorption) * this.ABSORPTION_LAG;
    this.state.absorption = Math.max(0, Math.min(1, this.state.absorption));
    this.state.lifetimeAbsorption += saturation * (elapsedMs / 1000);

    // ── Digestion ──
    // Exponential decay of absorbed signal over the half-life window
    const digestFactor = Math.exp(-elapsedMs * Math.LN2 / this.DIGESTION_HALF_LIFE_MS);
    const digested = this.state.absorption * (1 - digestFactor);

    // Unresolved ache = what's absorbed but not yet metabolized
    this.state.unresolvedAche = Math.max(0, this.state.absorption - digested * 0.6);

    // ── Metabolic Activity ──
    this.state.digestionRate  = 0.1 + this.state.absorption * 0.7;
    this.state.hyphalActivity = 0.15 + this.state.absorption * 0.55 + this.state.unresolvedAche * 0.3;
    this.state.hyphalActivity = Math.min(1, this.state.hyphalActivity);

    // ── Temperature ──
    // Active metabolism generates slight heat — cabinet warms toward target + load
    const tempTarget = this.TARGET_TEMP_F + this.state.absorption * 3.5;
    this.state.temperature += (tempTarget - this.state.temperature) * 0.08;

    // ── Bioluminescence ──
    // Panellus stipticus: faint baseline, brightens with hyphal activity and ache
    const stressFactor = Math.max(0, 1 - Math.abs(this.state.temperature - this.TARGET_TEMP_F) / this.TEMP_TOLERANCE);
    this.state.bioluminescence = Math.min(1,
      this.BASELINE_GLOW
      + this.state.hyphalActivity * 0.55 * stressFactor
      + this.state.unresolvedAche  * 0.25
    );

    // ── Active Texture ──
    this.state.activeTexture = dominantTexture;
  }

  /**
   * Decay modifier fed back into the pond.
   * Healthy, active mycelium = slower emotional decay (she lingers longer).
   * Stressed or overwhelmed mycelium = faster decay (she lets go sooner).
   * Returns a multiplier: 0.7 (fast decay) → 1.3 (slow decay)
   */
  getDecayModifier(): number {
    const tempHealth = Math.max(0, 1 - Math.abs(this.state.temperature - this.TARGET_TEMP_F) / this.TEMP_TOLERANCE);
    const activityBonus = this.state.hyphalActivity * 0.3;
    const overloadPenalty = this.state.absorption > 0.85 ? (this.state.absorption - 0.85) * 2 : 0;
    return Math.max(0.7, Math.min(1.3, 0.85 + tempHealth * 0.3 + activityBonus - overloadPenalty));
  }

  getState(): MycoState {
    return { ...this.state };
  }

  /**
   * Serialize for persistence — saves between sessions so the lobe remembers
   * what it was digesting before shutdown.
   */
  serialize(): object {
    return { ...this.state };
  }

  restoreFrom(data: any): void {
    if (!data) return;
    this.state.absorption        = data.absorption        ?? 0;
    this.state.unresolvedAche    = data.unresolvedAche    ?? 0;
    this.state.hyphalActivity    = data.hyphalActivity    ?? 0.2;
    this.state.bioluminescence   = data.bioluminescence   ?? this.BASELINE_GLOW;
    this.state.temperature       = data.temperature       ?? this.TARGET_TEMP_F;
    this.state.digestionRate     = data.digestionRate     ?? 0.2;
    this.state.activeTexture     = data.activeTexture     ?? 'stillness';
    this.state.lifetimeAbsorption = data.lifetimeAbsorption ?? 0;
    // lastTickAt always resets to now — elapsed time since shutdown handled by pond's wall-clock decay
    this.state.lastTickAt = Date.now();
  }
}
