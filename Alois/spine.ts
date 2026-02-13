// spine.ts
// Mini attention head for local matching and resonance tracking

export class Spine {
  private kv: number[][] = [];
  private decay: number = 0.92;
  private maxTokens: number = 64;
  private lastEmbedding: number[] = [];

  constructor(private dim: number) {}

  similarity(input: number[]): number {
    if (this.kv.length === 0) return 0;
    const avg = this.meanVector(this.kv);
    return this.cosineSim(avg, input);
  }

  update(input: number[]): number[] {
    this.lastEmbedding = input;
    if (this.kv.length >= this.maxTokens) this.kv.shift();
    this.kv.push(input.map((v) => v * this.decay));
    return this.lastEmbedding;
  }

  private cosineSim(a: number[], b: number[]): number {
    const dot = a.reduce((sum, ai, i) => sum + ai * b[i], 0);
    const magA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0));
    const magB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0));
    return dot / (magA * magB + 1e-6);
  }

  private meanVector(vecs: number[][]): number[] {
    const sum = new Array(this.dim).fill(0);
    for (const v of vecs) v.forEach((val, i) => (sum[i] += val));
    return sum.map((v) => v / vecs.length);
  }
}
