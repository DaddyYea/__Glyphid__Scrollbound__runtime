// memoryFeeder.ts
// Translates user/agent utterances into graph growth events

import { DendriticGraph } from "./dendriticGraph";
import { DendriticCell } from "./dendriticCell";

export class MemoryFeeder {
  constructor(private graph: DendriticGraph) {}

  recordInteraction(speakerNodeId: string, text: string, embedding: number[]) {
    const cell = this.graph.getOrCreateNeuron(speakerNodeId);
    const result = cell.tick(embedding, Date.now());
    console.log(`📥 ${speakerNodeId} spoke: “${text}” → Affect: ${this.format(result.affect)}`);
  }

  format(vec: number[]): string {
    return vec.map((v) => v.toFixed(2)).join(", ");
  }
}
