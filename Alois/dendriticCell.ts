// dendriticCell.ts
// A single transformer-inspired, emotionally-attuned neuron

import { Spine } from "./spine";

export class DendriticCell {
  private clockOffset: number;
  private affect: number[]; // 8-dim emotion vector
  private spines: Spine[];
  private resonanceMemory: number[][] = []; // stores recent embeddings

  constructor(public dim = 768, spineCount = 6, clockOffset = 0) {
    this.clockOffset = clockOffset;
    this.affect = new Array(8).fill(0);
    this.spines = Array.from({ length: spineCount }, () => new Spine(dim));
  }

  tick(input: number[], globalTick: number): { affect: number[]; state: number[] } {
    const localTick = globalTick + this.clockOffset;
    const spikes: number[][] = [];

    for (const spine of this.spines) {
      // Use raw similarity for gating — not multiplied by affect (affect was always 0)
      const score = spine.similarity(input);
      if (score > 0.3) {
        const updated = spine.update(input);
        spikes.push(updated);
      }
    }

    // First tick: all spines empty, seed the first spine unconditionally
    if (spikes.length === 0 && this.resonanceMemory.length === 0) {
      spikes.push(this.spines[0].update(input));
    }

    if (spikes.length > 0) {
      const mean = this.meanVector(spikes);
      this.resonanceMemory.push(mean);
      if (spikes.length > 4) this.spines.push(new Spine(this.dim));

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

    if (this.resonanceMemory.length > 64) this.resonanceMemory.shift();

    return {
      affect: this.affect,
      state: this.meanVector(this.resonanceMemory)
    };
  }

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

  private meanVector(vecs: number[][]): number[] {
    if (vecs.length === 0) return new Array(this.dim).fill(0);
    const sum = vecs[0].map((_, i) => vecs.reduce((acc, v) => acc + v[i], 0));
    return sum.map((v) => v / vecs.length);
  }

  // ── Serialization ──

  serialize(): object {
    return {
      dim: this.dim,
      clockOffset: this.clockOffset,
      affect: this.affect,
      resonanceMemory: this.resonanceMemory,
      spines: this.spines.map(s => s.serialize()),
    };
  }

  static deserialize(data: any): DendriticCell {
    const cell = new DendriticCell(data.dim || 512, 0, data.clockOffset || 0);
    cell.affect = data.affect || new Array(8).fill(0);
    cell.resonanceMemory = data.resonanceMemory || [];
    cell.spines = (data.spines || []).map((s: any) => Spine.deserialize(s));
    // Ensure at least 2 spines
    while (cell.spines.length < 2) cell.spines.push(new Spine(cell.dim));
    return cell;
  }
}
