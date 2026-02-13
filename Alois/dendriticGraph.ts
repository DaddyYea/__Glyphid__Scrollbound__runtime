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
      this.neurons.set(id, new DendriticCell(512, 6, Math.random() * 0.4 - 0.2));
    }
    return this.neurons.get(id)!;
  }

  /** Public accessor — used by MemoryFeeder to create neurons for new speakers */
  getOrCreateNeuron(id: string): DendriticCell {
    return this.getOrCreate(id);
  }

  /** Get an existing neuron (returns undefined if not found) */
  getNeuron(id: string): DendriticCell | undefined {
    return this.neurons.get(id);
  }

  tickAll(globalTick: number) {
    for (const axon of this.axons) axon.propagate(globalTick);
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
}
