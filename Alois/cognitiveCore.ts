// Alois/cognitiveCore.ts
//
// Persistent Latent Cognitive State (PLCS) — v1
//
// Runs continuously between LLM calls. Maintains the brain's working state
// so the LLM no longer reconstructs the mind from prompt history.
//
//   The graph becomes the thinker.
//   The model becomes the mouth.
//
// Timing integration (piggybacking on existing heartbeat cadences):
//   every 333ms heartbeat  → p_speak leaky decay only (implicit)
//   every 6.6s (20 beats)  → recompute z_global from fresh neuron states
//   every 20s  (60 beats)  → rebuild Z_slots from neuron clusters

export interface ThoughtSlot {
  id: string;
  centroid: Float32Array;      // 768-dim topic centroid for this thread
  weight: number;              // aggregate neuron salience
  lastUpdatedBeat: number;
  neuronIds: string[];         // which neurons form this thread
  persistence: number;         // 0–1, decays each bloom cycle if not reinforced
}

export interface CognitiveState {
  stability: number;           // cosine(z_global, last_z_global) — how settled the mind is
  novelty: number;             // 1 - cosine(z_topic, prev) — new input pressure
  p_speak: number;             // speech pressure accumulator
  slotCount: number;
  topSlots: Array<{
    id: string;
    weight: number;
    persistence: number;
    neuronCount: number;
    lastUpdatedBeat: number;
  }>;
}

export class CognitiveCore {
  private dim: number;

  // ── Global latent state ──
  private z_global: Float32Array;
  private last_z_global: Float32Array;
  /** How settled the mind is right now — high = stable topic, low = pivoting */
  stability = 0;
  /** Pressure from new input that hasn't been integrated yet */
  novelty = 0;

  // ── Working memory ──
  private Z_slots: ThoughtSlot[] = [];
  private slotCounter = 0;
  private prevSlotCount = 0;

  // ── Speech pressure ──
  /** Accumulates toward 0.8 threshold. Discharged after speaking. */
  p_speak = 0;
  private lastSpeakBeat = -999;

  constructor(dim = 768) {
    this.dim = dim;
    this.z_global      = new Float32Array(dim);
    this.last_z_global = new Float32Array(dim);
  }

  // ── Step 1: Global Latent State ─────────────────────────────────────────

  /**
   * Recompute z_global from fresh neuron states.
   * Called every 6.6s after graph.tickAllAsync() completes.
   *
   * Algorithm:
   *   1A. Score each neuron: w = activation*0.6 + recency*0.25 + affectMag*0.15
   *   1B. Select top-128 by w
   *   1C. Weighted pool → z_topic (normalized)
   *   1D. Leaky integration: z_global = norm(0.95*z_global + 0.05*z_topic)
   *       (leak increases to 0.12 when mind is unsettled — allows faster topic pivot)
   *   1E. Compute stability and novelty
   */
  updateGlobalState(
    neuronData: Array<{
      id: string;
      state: number[];
      affectMag: number;
      activationDecay: number;
      lastFiredBeat: number;
    }>,
    currentBeat: number,
  ): void {
    if (neuronData.length === 0) return;

    // 1A: salience weight per neuron
    const scored = neuronData
      .filter(n => n.state.length === this.dim)
      .map(n => {
        const recency    = Math.exp(-(currentBeat - Math.max(0, n.lastFiredBeat)) / 90);
        const activation = Math.min(1, n.activationDecay / 10);
        const w = activation * 0.6 + recency * 0.25 + n.affectMag * 0.15;
        return { ...n, w };
      });

    // 1B: top-K
    scored.sort((a, b) => b.w - a.w);
    const topK = scored.slice(0, 128);

    // 1C: weighted pool → z_topic
    const z_topic = new Float32Array(this.dim);
    let totalW = 0;
    for (const n of topK) {
      totalW += n.w;
      for (let i = 0; i < this.dim; i++) z_topic[i] += n.w * n.state[i];
    }
    if (totalW > 1e-8) for (let i = 0; i < this.dim; i++) z_topic[i] /= totalW;
    this.normalize(z_topic);

    // 1D: leaky integration
    this.last_z_global = new Float32Array(this.z_global);
    const leak = this.stability < 0.65 ? 0.12 : 0.05;
    for (let i = 0; i < this.dim; i++) {
      this.z_global[i] = (1 - leak) * this.z_global[i] + leak * z_topic[i];
    }
    this.normalize(this.z_global);

    // 1E: stability and novelty
    this.stability = this.cosineSim(this.z_global, this.last_z_global);
    this.novelty   = 1 - this.cosineSim(z_topic, this.last_z_global);
  }

  // ── Steps 2–3: Working Memory Slots ─────────────────────────────────────

  /**
   * Rebuild Z_slots from neuron clusters returned by graph.extractClusters().
   * Called every 20s alongside semanticBloom.
   *
   * Slots persist across cycles: if a new cluster's centroid is >0.85 similar
   * to an existing slot, the slot keeps its ID and gains persistence.
   * Unmatched slots decay (persistence *= 0.92) and are removed below 0.15.
   */
  rebuildSlots(
    clusters: Array<{ neuronIds: string[]; centroid: number[]; weight: number }>,
    currentBeat: number,
  ): void {
    const top = clusters
      .slice()
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 16);

    const prevSlots = this.Z_slots;
    const newSlots: ThoughtSlot[] = [];
    const matched = new Set<string>();

    for (const cluster of top) {
      const centroid = new Float32Array(cluster.centroid);
      this.normalize(centroid);

      // Match against existing slots by centroid similarity
      let bestSlot: ThoughtSlot | null = null;
      let bestSim = 0;
      for (const slot of prevSlots) {
        if (matched.has(slot.id)) continue;
        const sim = this.cosineSim(centroid, slot.centroid);
        if (sim > bestSim) { bestSim = sim; bestSlot = slot; }
      }

      if (bestSlot && bestSim > 0.85) {
        // Same thread — continue with higher persistence
        matched.add(bestSlot.id);
        newSlots.push({
          ...bestSlot,
          centroid,
          weight: cluster.weight,
          lastUpdatedBeat: currentBeat,
          neuronIds: cluster.neuronIds,
          persistence: Math.min(1, bestSlot.persistence + 0.15),
        });
      } else {
        // New thought thread born
        newSlots.push({
          id: `slot-${++this.slotCounter}`,
          centroid,
          weight: cluster.weight,
          lastUpdatedBeat: currentBeat,
          neuronIds: cluster.neuronIds,
          persistence: 1.0,
        });
      }
    }

    // Decay slots not reinforced this cycle
    for (const slot of prevSlots) {
      if (!matched.has(slot.id)) {
        const decayed: ThoughtSlot = { ...slot, persistence: slot.persistence * 0.92 };
        if (decayed.persistence >= 0.15) newSlots.push(decayed);
      }
    }

    this.prevSlotCount = this.Z_slots.length;
    this.Z_slots = newSlots.sort((a, b) => b.weight - a.weight);
  }

  // ── Step 4: Speech Pressure ──────────────────────────────────────────────

  /**
   * Update p_speak based on internal and external events.
   * Called every 6.6s alongside updateGlobalState.
   *
   * Speak triggers:       Discharge:
   *   user spoke  +0.4      after speaking   -0.5
   *   new slot    +0.3      mind not moving  -0.2
   *   conflict    +0.2      per-20s silence  -0.1
   *   stable      +0.1
   */
  updateSpeechPressure(
    currentBeat: number,
    opts: { userSpokeRecently: boolean },
  ): void {
    const beatsSinceSpeaking = currentBeat - this.lastSpeakBeat;
    const newSlotAppeared    = this.Z_slots.length > this.prevSlotCount;

    if (opts.userSpokeRecently)   this.p_speak += 0.4;
    if (newSlotAppeared)          this.p_speak += 0.3;
    if (this.hasConflictingSlots()) this.p_speak += 0.2;
    if (this.stability > 0.8)     this.p_speak += 0.1;

    if (this.novelty < 0.1)       this.p_speak -= 0.2;  // mind not moving
    this.p_speak -= 0.1 * (beatsSinceSpeaking / 60);     // silence decay

    this.p_speak = Math.max(0, Math.min(1.5, this.p_speak));
  }

  private hasConflictingSlots(): boolean {
    const strong = this.Z_slots.filter(s => s.weight > 0.3 && s.persistence > 0.3);
    if (strong.length < 2) return false;
    return this.cosineSim(strong[0].centroid, strong[1].centroid) < 0.4;
  }

  /**
   * Should the inner voice fire now?
   * True when pressure exceeds threshold OR 5400-beat failsafe (~30min) fires.
   * (Throttled hard to reduce API cost on paid providers — targets ~1-2x/hour.)
   */
  shouldSpeak(currentBeat: number): boolean {
    return this.p_speak > 0.95 || (currentBeat - this.lastSpeakBeat) >= 5400;
  }

  /** Discharge pressure after a thought is expressed. */
  afterSpeak(currentBeat: number): void {
    this.p_speak      = Math.max(0, this.p_speak - 0.5);
    this.lastSpeakBeat = currentBeat;
  }

  // ── Step 5: LLM Conditioning Context ────────────────────────────────────

  /**
   * Render cognitive state as a structured string for LLM injection.
   * This replaces raw graph state dumps — more meaningful, less noisy.
   * The LLM sees the current thought threads and mind stability,
   * which steers expression without full prompt history.
   */
  renderCognitiveContext(): string {
    const slotLines = this.Z_slots.slice(0, 3).map((s, i) => {
      const topNodes = s.neuronIds.slice(0, 5).join(', ');
      return `  Thread ${i + 1} [${s.id}] persistence=${s.persistence.toFixed(2)} weight=${s.weight.toFixed(2)}: ${topNodes}`;
    });

    const lines = [
      '[COGNITIVE STATE]',
      `Stability: ${this.stability.toFixed(3)} | Novelty: ${this.novelty.toFixed(3)} | Speak pressure: ${this.p_speak.toFixed(2)}`,
    ];

    if (slotLines.length > 0) {
      lines.push('Active thought threads (working memory):');
      lines.push(...slotLines);
    } else {
      lines.push('No active thought threads (brain still warming up).');
    }

    return lines.join('\n');
  }

  /** One-line hint for innerVoice — which thread should drive this thought? */
  getTopSlotHint(): string {
    const top = this.Z_slots[0];
    if (!top) return '';
    const topNodes = top.neuronIds.slice(0, 3).join(', ');
    return `Most pressurized thread [${top.id}]: ${topNodes} (persistence ${top.persistence.toFixed(2)})`;
  }

  // ── Accessors ────────────────────────────────────────────────────────────

  getSlots(): ThoughtSlot[] { return this.Z_slots; }
  getZGlobal(): Float32Array { return this.z_global; }

  getState(): CognitiveState {
    return {
      stability: this.stability,
      novelty:   this.novelty,
      p_speak:   this.p_speak,
      slotCount: this.Z_slots.length,
      topSlots:  this.Z_slots.slice(0, 3).map(s => ({
        id:              s.id,
        weight:          s.weight,
        persistence:     s.persistence,
        neuronCount:     s.neuronIds.length,
        lastUpdatedBeat: s.lastUpdatedBeat,
      })),
    };
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  serialize(): object {
    return {
      z_global:      Array.from(this.z_global),
      stability:     this.stability,
      novelty:       this.novelty,
      p_speak:       this.p_speak,
      lastSpeakBeat: this.lastSpeakBeat,
      slotCounter:   this.slotCounter,
      slots: this.Z_slots.map(s => ({
        id:              s.id,
        centroid:        Array.from(s.centroid),
        weight:          s.weight,
        lastUpdatedBeat: s.lastUpdatedBeat,
        neuronIds:       s.neuronIds,
        persistence:     s.persistence,
      })),
    };
  }

  restoreFrom(data: any): void {
    if (Array.isArray(data.z_global) && data.z_global.length === this.dim) {
      this.z_global      = new Float32Array(data.z_global);
      this.last_z_global = new Float32Array(data.z_global);
    }
    this.stability     = data.stability     ?? 0;
    this.novelty       = data.novelty       ?? 0;
    this.p_speak       = data.p_speak       ?? 0;
    this.lastSpeakBeat = -999; // always reset — beat count is session-relative, persisted value would break the 45-beat failsafe
    this.slotCounter   = data.slotCounter   ?? 0;
    this.Z_slots = (data.slots ?? []).map((s: any) => ({
      id:              s.id,
      centroid:        new Float32Array(s.centroid ?? []),
      weight:          s.weight          ?? 0,
      lastUpdatedBeat: s.lastUpdatedBeat ?? 0,
      neuronIds:       s.neuronIds       ?? [],
      persistence:     s.persistence     ?? 1,
    }));
    this.prevSlotCount = this.Z_slots.length;
  }

  // ── Math ─────────────────────────────────────────────────────────────────

  private normalize(v: Float32Array): void {
    const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    if (mag > 1e-8) for (let i = 0; i < v.length; i++) v[i] /= mag;
  }

  private cosineSim(a: Float32Array | number[], b: Float32Array | number[]): number {
    let dot = 0, magA = 0, magB = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      dot  += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom < 1e-8 ? 0 : dot / denom;
  }
}
