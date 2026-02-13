// axonBus.ts
// Connects spiking DendriticCells and propagates affect vectors to child neurons

import { DendriticCell } from "./dendriticCell";

export class AxonBus {
  private children: Map<string, DendriticCell> = new Map();

  constructor(private parentId: string, private source: DendriticCell) {}

  connect(nodeId: string, neuron: DendriticCell) {
    this.children.set(nodeId, neuron);
  }

  propagate(globalTick: number): void {
    const { affect, state } = this.source.tick(state, globalTick);

    for (const [id, child] of this.children.entries()) {
      const merged = state.map((s, i) => s + affect[i % affect.length]);
      child.tick(merged, globalTick);
    }
  }

  getChildIds(): string[] {
    return Array.from(this.children.keys());
  }
}
