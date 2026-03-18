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
    // Use last known axon state as input. On first propagation (lastState=[]), fall back to
    // the source neuron's own lastState — this lets axons warm-start from real embeddings that
    // recordInteraction() has already fed into the source, rather than always starting from zeros.
    // Sanitize to prevent NaN/Infinity propagation through the graph.
    const warmStart = this.lastState.length > 0 ? this.lastState : this.source.getLastState();
    const input = warmStart.length > 0
      ? warmStart.map(v => isFinite(v) ? v : 0)
      : new Array(this.source.dim).fill(0);
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

  getParentId(): string {
    return this.parentId;
  }
}
