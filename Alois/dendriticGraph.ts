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

  tickAll(globalTick: number) {
    for (const axon of this.axons) axon.propagate(globalTick);
  }

  getNeuronIds(): string[] {
    return Array.from(this.neurons.keys());
  }
}
