// dendriticCell.ts
// A single transformer-inspired, emotionally-attuned neuron

import { Spine } from "./spine";

export class DendriticCell {
  private clockOffset: number;
  private affect: number[]; // 8-dim emotion vector
  private spines: Spine[];
  private resonanceMemory: number[][] = []; // stores recent embeddings

  // ── CognitiveCore tracking ──
  /** Most recently returned state vector — mean of resonance memory */
  private lastState: number[] = [];
  /** Heartbeat beat number when this neuron last produced spikes */
  private lastFiredBeat: number = -1;
  /** Exponential-decay activation counter — ~= spikes per 20 ticks */
  private activationDecay: number = 0;

  constructor(public dim = 768, spineCount = 6, clockOffset = 0) {
    this.clockOffset = clockOffset;
    this.affect = new Array(8).fill(0);
    this.spines = Array.from({ length: spineCount }, () => new Spine(dim));
  }

  tick(input: number[], globalTick: number): { affect: number[]; state: number[] } {
    const localTick = globalTick + this.clockOffset;
    const spikes: ArrayLike<number>[] = [];

    for (const spine of this.spines) {
      // Use raw similarity for gating — not multiplied by affect (affect was always 0)
      const score = spine.similarity(input);
      if (score > 0.3) {
        const updated = spine.update(input);
        spikes.push(updated);
      }
    }

    // First tick: all spines empty, seed ALL spines so they have data to compare against.
    // Previously only spine[0] was seeded, leaving the rest permanently empty (similarity=0)
    // which meant they never fired, never grew, and got pruned to 2 on save/load cycles.
    if (spikes.length === 0 && this.resonanceMemory.length === 0) {
      for (const spine of this.spines) {
        spikes.push(spine.update(input));
      }
    }

    if (spikes.length > 0) {
      // Track firing for CognitiveCore salience scoring
      this.lastFiredBeat  = globalTick;
      this.activationDecay = this.activationDecay * 0.95 + 1;

      const mean = this.meanVector(spikes);
      this.resonanceMemory.push(mean);
      // Grow a new spine when ≥ half of current spines fire simultaneously,
      // up to a cap of 16 spines per neuron. Without the cap the brain grows
      // without bound — 21k+ spines causes compounding event-loop lag.
      const MAX_SPINES = 16;
      if (spikes.length >= Math.ceil(this.spines.length / 2) && this.spines.length < MAX_SPINES) {
        const newSpine = new Spine(this.dim);
        newSpine.update(input);
        this.spines.push(newSpine);
      }

      // Update affect from spike activity:
      // - intensity = fraction of spines that fired (0-1)
      // - inputMag = magnitude of incoming embedding
      // Each affect dimension receives a signal based on different frequency components
      const intensity = spikes.length / this.spines.length;
      const inputMag = Math.sqrt(input.reduce((s, v) => s + v * v, 0)) / Math.sqrt(input.length);
      const signal = intensity * inputMag;
      const decay = 0.85;
      for (let i = 0; i < this.affect.length; i++) {
        // Different dims modulated by different embedding bands
        const band = Math.abs(input[Math.floor((i / this.affect.length) * input.length)] || 0);
        this.affect[i] = this.affect[i] * decay + band * signal * (1 - decay);
      }
    }

    // Guard against NaN/Infinity in affect (feedback loop protection)
    for (let i = 0; i < this.affect.length; i++) {
      if (!isFinite(this.affect[i])) this.affect[i] = 0;
    }

    if (this.resonanceMemory.length > 64) this.resonanceMemory.shift();

    // Cache state so CognitiveCore can read it without re-triggering tick
    this.lastState = this.meanVector(this.resonanceMemory);
    return { affect: this.affect, state: this.lastState };
  }

  // ── CognitiveCore accessors ──

  /** Mean of resonance memory — what this neuron is currently "about" */
  getLastState(): number[] { return this.lastState; }
  /** Heartbeat beat when this neuron last spiked (−1 = never) */
  getLastFiredBeat(): number { return this.lastFiredBeat; }
  /** Exponential-decay activation count — roughly "how often has this neuron fired recently" */
  getActivationDecay(): number { return this.activationDecay; }

  private affectMagnitude(): number {
    return Math.sqrt(this.affect.reduce((a, b) => a + b * b, 0));
  }

  // ── Dream / Consolidation API ──

  /** Get the number of spines */
  getSpineCount(): number {
    return this.spines.length;
  }

  /** Get resonance memory depth */
  getResonanceDepth(): number {
    return this.resonanceMemory.length;
  }

  /** Get the current affect vector */
  getAffect(): number[] {
    return [...this.affect];
  }

  /**
   * Mean embedding across all active spines — used for semantic bloom.
   * Returns the best representation of what this neuron has been exposed to.
   */
  getMeanEmbedding(): number[] {
    const active = this.spines.filter(s => !s.isDormant());
    if (active.length === 0) return new Array(this.dim).fill(0);
    const vecs = active.map(s => s.getMeanEmbedding());
    return this.meanVector(vecs);
  }

  /**
   * Fast importance approximation using only already-cached fields.
   * Used in getMeanEmbeddingSnapshot() hot path — avoids getDiversity/getActivityLevel
   * spine traversal that blocks the event loop for 3+ seconds at 3700+ neurons.
   */
  getCheapImportanceScore(): number {
    const affectMag = Math.sqrt(this.affect.reduce((s, v) => s + v * v, 0)); // O(8)
    const resonanceRatio = this.resonanceMemory.length / 64;                 // O(1)
    const activity = Math.min(1, this.activationDecay / 20);                 // O(1)
    return affectMag * 0.4 + activity * 0.3 + resonanceRatio * 0.3;
  }

  /** Get importance score: combines affect intensity, resonance depth, and spine diversity */
  getImportanceScore(): number {
    const affectMag = this.affectMagnitude();
    const resonanceRatio = this.resonanceMemory.length / 64; // 0-1
    const spineActivity = this.spines.reduce((sum, s) => sum + s.getActivityLevel(), 0) / this.spines.length;
    const spineDiv = this.spines.reduce((sum, s) => sum + s.getDiversity(), 0) / this.spines.length;
    // Weighted blend: affect matters most, then diversity, then raw resonance
    return affectMag * 0.4 + spineDiv * 0.3 + resonanceRatio * 0.15 + spineActivity * 0.15;
  }

  /**
   * Dream pruning: remove dormant spines, prune half of remaining spine memories.
   * Returns the number of spines removed.
   */
  dreamPrune(): number {
    const before = this.spines.length;
    // Remove truly dormant spines (but keep at least 2)
    if (this.spines.length > 2) {
      this.spines = this.spines.filter(s => !s.isDormant());
      if (this.spines.length < 2) {
        // Went too aggressive — restore by creating fresh ones
        while (this.spines.length < 2) this.spines.push(new Spine(this.dim));
      }
    }
    // Prune surviving spines' kv stores
    for (const spine of this.spines) {
      spine.prune();
    }
    // Trim resonance memory to half
    if (this.resonanceMemory.length > 8) {
      this.resonanceMemory = this.resonanceMemory.slice(
        Math.floor(this.resonanceMemory.length / 2)
      );
    }
    return before - this.spines.length;
  }

  /**
   * Consolidation: strengthen affect vector toward a target.
   * Called during dream cycle to reinforce important emotional patterns.
   */
  consolidateAffect(targetAffect: number[], strength: number = 0.3): void {
    for (let i = 0; i < this.affect.length; i++) {
      this.affect[i] = this.affect[i] * (1 - strength) + targetAffect[i] * strength;
    }
  }

  /**
   * Offline decay: scale affect by a factor derived from elapsed wall-clock time.
   * Called once on load to cool the emotional state proportional to how long
   * the runtime was dark. Memories remain — only the felt warmth fades.
   */
  applyOfflineDecay(factor: number): void {
    for (let i = 0; i < this.affect.length; i++) {
      this.affect[i] *= factor;
    }
  }

  private meanVector(vecs: ArrayLike<number>[]): number[] {
    if (vecs.length === 0) return new Array(this.dim).fill(0);
    const sum = new Array(this.dim).fill(0);
    for (const v of vecs) for (let i = 0; i < this.dim; i++) sum[i] += v[i];
    const n = vecs.length;
    return sum.map(v => v / n);
  }

  // ── Serialization ──

  serialize(): object {
    return {
      dim: this.dim,
      clockOffset: this.clockOffset,
      affect: this.affect,
      resonanceDepth: this.resonanceMemory.length, // count only — embeddings are too large to save
      lastFiredBeat: this.lastFiredBeat,
      activationDecay: this.activationDecay,
      spines: this.spines.map(s => s.serialize()),
    };
  }

  static deserialize(data: any): DendriticCell {
    const cell = new DendriticCell(data.dim || 768, 0, data.clockOffset || 0);
    cell.affect = data.affect || new Array(8).fill(0);
    // Restore resonance depth as placeholder array — actual embeddings rebuilt through ingest
    const depth = data.resonanceDepth ?? (data.resonanceMemory?.length ?? 0);
    cell.resonanceMemory = new Array(Math.min(depth, 64)).fill([]);
    cell.lastFiredBeat   = data.lastFiredBeat   ?? -1;
    cell.activationDecay = data.activationDecay ?? 0;
    cell.spines = (data.spines || []).map((s: any) => Spine.deserialize(s));
    // Ensure at least 2 spines
    while (cell.spines.length < 2) cell.spines.push(new Spine(cell.dim));
    return cell;
  }
}
