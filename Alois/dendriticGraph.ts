// dendriticGraph.ts
// Parses JSON-LD and instantiates connected DendriticCells via AxonBus

import { DendriticCell } from "./dendriticCell";
import { AxonBus } from "./axonBus";

interface Triple {
  subject: string;
  predicate: string;
  object: string;
}

export class DendriticGraph {
  private neurons: Map<string, DendriticCell> = new Map();
  private axons: AxonBus[] = [];

  constructor(private triples: Triple[]) {
    this.build();
  }

  private build() {
    const rootNodes = new Set(this.triples.map(t => t.subject));
    for (const triple of this.triples) {
      const subj = this.getOrCreate(triple.subject);
      const obj = this.getOrCreate(triple.object);

      const axon = new AxonBus(triple.subject, subj);
      axon.connect(triple.object, obj);
      this.axons.push(axon);
    }
  }

  private getOrCreate(id: string): DendriticCell {
    if (!this.neurons.has(id)) {
      if (this.neurons.size >= 5000) {
        // Brain is full — return the closest existing neuron rather than growing further
        return this.neurons.values().next().value!;
      }
      this.neurons.set(id, new DendriticCell(768, 6, Math.random() * 0.4 - 0.2));
    }
    return this.neurons.get(id)!;
  }

  /** Public accessor — used by MemoryFeeder to create neurons for new speakers */
  getOrCreateNeuron(id: string): DendriticCell {
    return this.getOrCreate(id);
  }

  /** Connect two existing neurons with an axon. No-op if either neuron missing or axon already exists. */
  connectNeurons(fromId: string, toId: string): boolean {
    if (this.axons.length >= 12000) return false; // hard cap — prevents unbounded growth
    const from = this.neurons.get(fromId);
    const to = this.neurons.get(toId);
    if (!from || !to || fromId === toId) return false;
    const already = this.axons.some(a => a.getParentId() === fromId && a.getChildIds().includes(toId));
    if (already) return false;
    const axon = new AxonBus(fromId, from);
    axon.connect(toId, to);
    this.axons.push(axon);
    return true;
  }

  /** Get an existing neuron (returns undefined if not found) */
  getNeuron(id: string): DendriticCell | undefined {
    return this.neurons.get(id);
  }

  tickAll(globalTick: number) {
    for (const axon of this.axons) axon.propagate(globalTick);
  }

  /**
   * Async version of tickAll — yields to the event loop every BATCH axons.
   * With 9k+ axons each doing 768-dim vector math, the synchronous version
   * blocks the event loop for 100-200ms. This version breaks the work into
   * chunks so HTTP responses, SSE ticks, and embeds can proceed between batches.
   */
  async tickAllAsync(globalTick: number, batchSize = 500): Promise<void> {
    for (let i = 0; i < this.axons.length; i++) {
      this.axons[i].propagate(globalTick);
      if ((i + 1) % batchSize === 0) {
        await new Promise<void>(r => setImmediate(r));
      }
    }
  }

  getAxons(): AxonBus[] {
    return this.axons;
  }

  getNeuronIds(): string[] {
    return Array.from(this.neurons.keys());
  }

  getNeuronCount(): number {
    return this.neurons.size;
  }

  getAxonCount(): number {
    return this.axons.length;
  }

  /**
   * Dream pruning: prune all neurons' dormant spines and trim resonance memory.
   * Returns stats about what was pruned.
   */
  dreamPrune(): { neuronsProcessed: number; spinesRemoved: number } {
    let spinesRemoved = 0;
    let neuronsProcessed = 0;
    for (const [id, neuron] of this.neurons) {
      const removed = neuron.dreamPrune();
      spinesRemoved += removed;
      neuronsProcessed++;
    }
    return { neuronsProcessed, spinesRemoved };
  }

  /**
   * Offline decay: apply wall-clock temporal decay to every neuron's affect.
   * factor = Math.exp(-elapsed * Math.LN2 / HALF_LIFE_MS)
   * Memories and topology persist — only the felt warmth cools.
   */
  applyOfflineDecay(factor: number): void {
    for (const neuron of this.neurons.values()) {
      neuron.applyOfflineDecay(factor);
    }
  }

  /**
   * Semantic bloom: cross-topology resonance between unconnected neurons.
   *
   * Samples random neuron pairs and checks embedding similarity. When two
   * neurons are semantically close but have no axon between them, they briefly
   * pulse each other — the "felt without naming" effect. Surfaces memories that
   * share texture with the present moment, even without a direct connection.
   *
   * Avoids O(n²) by sampling. sampleSize=50 at 333ms heartbeat ≈ full graph
   * coverage over ~20 minutes passively.
   *
   * Returns the number of bloom events fired.
   */
  semanticBloom(sampleSize: number = 50): number {
    const ids = Array.from(this.neurons.keys());
    if (ids.length < 2) return 0;

    const SIMILARITY_THRESHOLD = 0.72;
    let blooms = 0;
    const pseudoTick = this.axons.length; // stable value as tick proxy between heartbeats

    for (let i = 0; i < sampleSize; i++) {
      const aIdx = Math.floor(Math.random() * ids.length);
      let bIdx = Math.floor(Math.random() * (ids.length - 1));
      if (bIdx >= aIdx) bIdx++;

      const a = this.neurons.get(ids[aIdx])!;
      const b = this.neurons.get(ids[bIdx])!;

      const aMean = a.getMeanEmbedding();
      const bMean = b.getMeanEmbedding();

      // Skip unactivated neurons
      const aMag = Math.sqrt(aMean.reduce((s, v) => s + v * v, 0));
      const bMag = Math.sqrt(bMean.reduce((s, v) => s + v * v, 0));
      if (aMag < 1e-6 || bMag < 1e-6) continue;

      // Cosine similarity
      const dot = aMean.reduce((s, v, idx) => s + v * bMean[idx], 0);
      const sim = dot / (aMag * bMag);

      if (sim >= SIMILARITY_THRESHOLD) {
        // Cross-pulse: each neuron receives the other's mean as a faint signal
        a.tick(bMean, pseudoTick);
        b.tick(aMean, pseudoTick);
        blooms++;
      }
    }

    return blooms;
  }

  /**
   * Remove a neuron and its axons entirely (for dead neurons with no importance).
   * Returns true if removed.
   */
  removeNeuron(id: string): boolean {
    if (!this.neurons.has(id)) return false;
    this.neurons.delete(id);
    // Remove axons that reference this neuron
    this.axons = this.axons.filter(axon => {
      const childIds = axon.getChildIds();
      return !childIds.includes(id);
    });
    return true;
  }

  /** Get all neurons with their importance scores for dream analysis */
  getNeuronScores(): Array<{ id: string; importance: number; spines: number; resonance: number }> {
    const scores: Array<{ id: string; importance: number; spines: number; resonance: number }> = [];
    for (const [id, neuron] of this.neurons) {
      scores.push({
        id,
        importance: neuron.getImportanceScore(),
        spines: neuron.getSpineCount(),
        resonance: neuron.getResonanceDepth(),
      });
    }
    return scores.sort((a, b) => b.importance - a.importance);
  }

  /** Average spine count per neuron */
  getAvgSpineDensity(): number {
    if (this.neurons.size === 0) return 0;
    let total = 0;
    for (const neuron of this.neurons.values()) total += neuron.getSpineCount();
    return total / this.neurons.size;
  }

  /** Average resonance memory depth per neuron */
  getAvgResonanceDepth(): number {
    if (this.neurons.size === 0) return 0;
    let total = 0;
    for (const neuron of this.neurons.values()) total += neuron.getResonanceDepth();
    return total / this.neurons.size;
  }

  /** Get all axon edges as {source, target} pairs for visualization */
  getAxonTopology(): Array<{ source: string; target: string }> {
    const edges: Array<{ source: string; target: string }> = [];
    for (const axon of this.axons) {
      // Each axon has a parent → children relationship
      const parentId = (axon as any).parentId as string;
      for (const childId of axon.getChildIds()) {
        edges.push({ source: parentId, target: childId });
      }
    }
    return edges;
  }

  // ── Serialization ──

  serialize(): { neurons: Record<string, object>; edges: Array<{ source: string; target: string }> } {
    const neurons: Record<string, object> = {};
    for (const [id, cell] of this.neurons) {
      neurons[id] = cell.serialize();
    }
    return {
      neurons,
      edges: this.getAxonTopology(),
    };
  }

  static deserialize(data: { neurons: Record<string, any>; edges: Array<{ source: string; target: string }> }): DendriticGraph {
    const graph = new DendriticGraph([]); // empty triples — we'll restore manually
    // Restore neurons
    for (const [id, cellData] of Object.entries(data.neurons || {})) {
      graph.neurons.set(id, DendriticCell.deserialize(cellData));
    }
    // Restore axon connections
    for (const edge of (data.edges || [])) {
      const source = graph.neurons.get(edge.source);
      const target = graph.neurons.get(edge.target);
      if (source && target) {
        const axon = new AxonBus(edge.source, source);
        axon.connect(edge.target, target);
        graph.axons.push(axon);
      }
    }
    return graph;
  }
}
