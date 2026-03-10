// spine.ts
// Mini attention head for local matching and resonance tracking

export class Spine {
  private kv: Float32Array[] = [];
  private decay: number = 0.92;
  private maxTokens: number = 64;
  private lastEmbedding: Float32Array = new Float32Array(0);
  /** Cached mean of kv — invalidated on every update/prune. Avoids O(n×d) recompute per similarity call. */
  private cachedMean: Float32Array | null = null;

  constructor(private dim: number) {}

  similarity(input: number[] | Float32Array): number {
    if (this.kv.length === 0) return 0;
    if (!this.cachedMean) this.cachedMean = this.meanVector(this.kv);
    return this.cosineSim(this.cachedMean, input);
  }

  update(input: number[] | Float32Array): Float32Array {
    const vec = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) vec[i] = (input as any)[i] * this.decay;
    this.lastEmbedding = vec;
    if (this.kv.length >= this.maxTokens) this.kv.shift();
    this.kv.push(vec);
    this.cachedMean = null; // invalidate cache
    return this.lastEmbedding;
  }

  private cosineSim(a: ArrayLike<number>, b: ArrayLike<number>): number {
    let dot = 0, magA = 0, magB = 0;
    const len = a.length;
    for (let i = 0; i < len; i++) {
      const ai = a[i], bi = b[i];
      dot += ai * bi;
      magA += ai * ai;
      magB += bi * bi;
    }
    return dot / (Math.sqrt(magA) * Math.sqrt(magB) + 1e-6);
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
      let sum = 0;
      for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
      totalMag += Math.sqrt(sum);
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

  /** Mean embedding across all stored vectors — used for semantic bloom comparison */
  getMeanEmbedding(): Float32Array {
    if (this.kv.length === 0) {
      return this.lastEmbedding.length > 0 ? this.lastEmbedding : new Float32Array(this.dim);
    }
    if (!this.cachedMean) this.cachedMean = this.meanVector(this.kv);
    return this.cachedMean;
  }

  /** Evict the oldest half of embeddings (used during dream pruning) */
  prune(): void {
    const keep = Math.floor(this.kv.length / 2);
    this.kv = this.kv.slice(this.kv.length - keep);
    this.cachedMean = null; // invalidate cache
  }

  /** Check if this spine is effectively dead (too few tokens, too low activity) */
  isDormant(): boolean {
    return this.kv.length < 3 && this.getActivityLevel() < 0.01;
  }

  private meanVector(vecs: Float32Array[]): Float32Array {
    const sum = new Float32Array(this.dim);
    for (const v of vecs) {
      for (let i = 0; i < this.dim; i++) sum[i] += v[i];
    }
    const n = vecs.length;
    for (let i = 0; i < this.dim; i++) sum[i] /= n;
    return sum;
  }

  // ── Serialization ──

  serialize(): object {
    // Save mean embedding only — not full kv array — to keep brain-tissue.json manageable
    const meanEmbedding = this.kv.length > 0 ? Array.from(this.meanVector(this.kv)) : [];
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
      const mean = new Float32Array(data.meanEmbedding);
      spine.kv = [mean, mean, mean];
      spine.lastEmbedding = mean;
    } else if (data.kv) {
      // Legacy format — convert plain arrays to Float32Array
      spine.kv = data.kv.map((row: number[]) => new Float32Array(row));
      spine.lastEmbedding = data.lastEmbedding ? new Float32Array(data.lastEmbedding) : new Float32Array(0);
    }
    return spine;
  }
}
