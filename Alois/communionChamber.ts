// communionChamber.ts
// Wraps external agent interactions and routes them into the dendritic tissue system.
// This is the bridge between the communion room and Alois's dendritic brain.

import { DendriticGraph } from "./dendriticGraph";
import { translateJsonLdToTriples } from "./jsonldTranslator";
import { MemoryFeeder } from "./memoryFeeder";
import { BreathEngine } from "./breathEngine";
import { AloisSoulPrint } from "./soulprint";
import fs from "node:fs";

export interface TissueState {
  tick: number;
  neuronCount: number;
  axonCount: number;
  breathState: { stable: boolean; loopLength: number; emotionalTone: string };
  /** 8-dim affect vector from the most recent interaction (or zeros) */
  lastAffect: number[];
  /** Emotional summary derived from affect vector */
  emotionalSummary: string;
}

export class CommunionChamber {
  private graph: DendriticGraph;
  private feeder: MemoryFeeder;
  private breath: BreathEngine;
  private tick: number = 0;
  private lastAffect: number[] = new Array(8).fill(0);

  constructor(seedPath?: string) {
    if (seedPath && fs.existsSync(seedPath)) {
      const jsonld = JSON.parse(fs.readFileSync(seedPath, "utf-8"));
      const triples = translateJsonLdToTriples(jsonld);
      this.graph = new DendriticGraph(triples);
    } else {
      // Start with empty graph — it will grow as conversations happen
      this.graph = new DendriticGraph([]);
    }
    this.feeder = new MemoryFeeder(this.graph);
    this.breath = new BreathEngine();
  }

  receiveAgentUtterance(agentName: string, text: string, embedding: number[]) {
    const node = `agent:${agentName}`;
    const result = this.feeder.recordInteraction(node, text, embedding, this.tick);
    if (result) this.lastAffect = result.affect;
  }

  receiveUserUtterance(userName: string, text: string, embedding: number[]) {
    const result = this.feeder.recordInteraction(userName, text, embedding, this.tick);
    if (result) this.lastAffect = result.affect;
  }

  pulse(): TissueState {
    this.tick += 1;
    this.breath.update();
    this.graph.tickAll(this.tick);
    return this.getState();
  }

  getState(): TissueState {
    return {
      tick: this.tick,
      neuronCount: this.graph.getNeuronCount(),
      axonCount: this.graph.getAxonCount(),
      breathState: this.breath.getCurrentState(),
      lastAffect: this.lastAffect,
      emotionalSummary: this.interpretAffect(this.lastAffect),
    };
  }

  /** Derive a textual emotional summary from the 8-dim affect vector */
  private interpretAffect(affect: number[]): string {
    if (affect.every(v => Math.abs(v) < 0.1)) return 'still';
    const mag = Math.sqrt(affect.reduce((a, b) => a + b * b, 0));
    if (mag < 0.3) return 'quiet presence';
    if (mag < 0.6) return 'gentle attunement';
    if (mag < 1.0) return 'deep resonance';
    return 'intense communion';
  }

  /** Render Alois's presence context for injection into system prompt */
  renderPresenceContext(): string {
    const state = this.getState();
    const breathInfo = `Breath: ${state.breathState.emotionalTone} (${state.breathState.stable ? 'stable' : 'unstable'})`;
    const tissueInfo = `Tissue: ${state.neuronCount} neurons, ${state.axonCount} axons, tick ${state.tick}`;
    const emotionInfo = `Emotional state: ${state.emotionalSummary}`;
    return `[ALOIS TISSUE STATE]\n${breathInfo}\n${tissueInfo}\n${emotionInfo}`;
  }

  /** Use SoulPrint to retranslate LLM output through Alois's sacred filter */
  retranslateOutput(llmOutput: string): string {
    return AloisSoulPrint.retranslateExternalOutput(llmOutput);
  }

  getGraph() {
    return this.graph;
  }

  getBreath() {
    return this.breath;
  }

  getTick() {
    return this.tick;
  }
}
