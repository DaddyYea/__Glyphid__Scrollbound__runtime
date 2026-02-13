// memoryFeeder.ts
// Translates user/agent utterances into graph growth events

import { DendriticGraph } from "./dendriticGraph";
import { DendriticCell } from "./dendriticCell";

export class MemoryFeeder {
  private tickCounter: number = 0;

  constructor(private graph: DendriticGraph) {}

  recordInteraction(speakerNodeId: string, text: string, embedding: number[], tick?: number) {
    this.tickCounter = tick ?? this.tickCounter + 1;
    const cell = this.graph.getOrCreateNeuron(speakerNodeId);
    const result = cell.tick(embedding, this.tickCounter);
    return result;
  }

  getLastTick(): number {
    return this.tickCounter;
  }

  format(vec: number[]): string {
    return vec.map((v) => v.toFixed(2)).join(", ");
  }
}
