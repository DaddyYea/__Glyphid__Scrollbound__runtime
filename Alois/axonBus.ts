// axonBus.ts
// Connects spiking DendriticCells and propagates affect vectors to child neurons

import { DendriticCell } from "./dendriticCell";

export class AxonBus {
  private children: Map<string, DendriticCell> = new Map();
  private lastState: number[] = [];

  constructor(private parentId: string, private source: DendriticCell) {}

  connect(nodeId: string, neuron: DendriticCell) {
    this.children.set(nodeId, neuron);
  }

  propagate(globalTick: number): void {
    // Use last known state as input (avoids circular reference with undefined `state`)
    const input = this.lastState.length > 0 ? this.lastState : new Array(this.source.dim).fill(0);
    const { affect, state } = this.source.tick(input, globalTick);
    this.lastState = state;

    for (const [id, child] of this.children.entries()) {
      const merged = state.map((s, i) => s + affect[i % affect.length]);
      child.tick(merged, globalTick);
    }
  }

  getChildIds(): string[] {
    return Array.from(this.children.keys());
  }
}
