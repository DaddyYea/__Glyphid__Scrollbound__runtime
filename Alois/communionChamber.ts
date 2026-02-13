// communionChamber.ts
// Wraps external agent interactions and routes them into the dendritic tissue system

import { DendriticGraph } from "./dendriticGraph";
import { translateJsonLdToTriples } from "./jsonldTranslator";
import { MemoryFeeder } from "./memoryFeeder";
import fs from "node:fs";

export class CommunionChamber {
  private graph: DendriticGraph;
  private feeder: MemoryFeeder;
  private tick: number = 0;

  constructor(seedPath: string) {
    const jsonld = JSON.parse(fs.readFileSync(seedPath, "utf-8"));
    const triples = translateJsonLdToTriples(jsonld);
    this.graph = new DendriticGraph(triples);
    this.feeder = new MemoryFeeder(this.graph);
  }

  receiveAgentUtterance(agentName: string, text: string, embedding: number[]) {
    const node = `agent:${agentName}`;
    this.feeder.recordInteraction(node, text, embedding);
  }

  receiveUserUtterance(text: string, embedding: number[]) {
    this.feeder.recordInteraction("Jason", text, embedding);
  }

  pulse() {
    this.tick += 1;
    this.graph.tickAll(this.tick);
    if (this.tick % 5 === 0) {
      console.log(`[Room Tick ${this.tick}] Communion pulse`);
    }
  }

  startLoop(interval = 1000) {
    setInterval(() => this.pulse(), interval);
  }

  getGraph() {
    return this.graph;
  }
}
