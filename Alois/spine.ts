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

  /** Number of stored embeddings in this spine */
  getTokenCount(): number {
    return this.kv.length;
  }

  /** Average magnitude of stored embeddings — proxy for activity level */
  getActivityLevel(): number {
    if (this.kv.length === 0) return 0;
    let totalMag = 0;
    for (const vec of this.kv) {
      totalMag += Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    }
    return totalMag / this.kv.length;
  }

  /** Diversity score: average pairwise cosine distance among stored embeddings */
  getDiversity(): number {
    if (this.kv.length < 2) return 0;
    let totalDist = 0;
    let pairs = 0;
    // Sample up to 10 pairs to keep it fast
    const step = Math.max(1, Math.floor(this.kv.length / 5));
    for (let i = 0; i < this.kv.length; i += step) {
      for (let j = i + step; j < this.kv.length; j += step) {
        totalDist += 1 - this.cosineSim(this.kv[i], this.kv[j]);
        pairs++;
      }
    }
    return pairs > 0 ? totalDist / pairs : 0;
  }

  /** Evict the oldest half of embeddings (used during dream pruning) */
  prune(): void {
    const keep = Math.floor(this.kv.length / 2);
    this.kv = this.kv.slice(this.kv.length - keep);
  }

  /** Check if this spine is effectively dead (too few tokens, too low activity) */
  isDormant(): boolean {
    return this.kv.length < 3 && this.getActivityLevel() < 0.01;
  }

  private meanVector(vecs: number[][]): number[] {
    const sum = new Array(this.dim).fill(0);
    for (const v of vecs) v.forEach((val, i) => (sum[i] += val));
    return sum.map((v) => v / vecs.length);
  }

  // ── Serialization ──

  serialize(): object {
    // Save mean embedding only — not full kv array — to keep brain-tissue.json manageable
    const meanEmbedding = this.kv.length > 0 ? this.meanVector(this.kv) : [];
    return {
      dim: this.dim,
      decay: this.decay,
      tokenCount: this.kv.length,
      meanEmbedding,
    };
  }

  static deserialize(data: any): Spine {
    const spine = new Spine(data.dim);
    spine.decay = data.decay ?? 0.92;
    if (data.meanEmbedding && data.meanEmbedding.length > 0) {
      // Restore as 3 copies of mean so similarity matching works and spine isn't flagged dormant
      spine.kv = [data.meanEmbedding, data.meanEmbedding, data.meanEmbedding];
      spine.lastEmbedding = data.meanEmbedding;
    } else if (data.kv) {
      // Legacy format
      spine.kv = data.kv;
      spine.lastEmbedding = data.lastEmbedding || [];
    }
    return spine;
  }
}
