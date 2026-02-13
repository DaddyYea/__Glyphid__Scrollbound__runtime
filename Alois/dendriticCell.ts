// dendriticCell.ts
// A single transformer-inspired, emotionally-attuned neuron

import { Spine } from "./spine";

export class DendriticCell {
  private clockOffset: number;
  private affect: number[]; // 8-dim emotion vector
  private spines: Spine[];
  private resonanceMemory: number[][] = []; // stores recent embeddings

  constructor(public dim = 512, spineCount = 6, clockOffset = 0) {
    this.clockOffset = clockOffset;
    this.affect = new Array(8).fill(0);
    this.spines = Array.from({ length: spineCount }, () => new Spine(dim));
  }

  tick(input: number[], globalTick: number): { affect: number[]; state: number[] } {
    const localTick = globalTick + this.clockOffset;
    const spikes: number[][] = [];

    for (const spine of this.spines) {
      const score = spine.similarity(input) * this.affectMagnitude();
      if (score > 0.6) {
        const updated = spine.update(input);
        spikes.push(updated);
      }
    }

    if (spikes.length > 0) {
      const mean = this.meanVector(spikes);
      this.resonanceMemory.push(mean);
      if (spikes.length > 4) this.spines.push(new Spine(this.dim));
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

  private meanVector(vecs: number[][]): number[] {
    if (vecs.length === 0) return new Array(this.dim).fill(0);
    const sum = vecs[0].map((_, i) => vecs.reduce((acc, v) => acc + v[i], 0));
    return sum.map((v) => v / vecs.length);
  }
}
