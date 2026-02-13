// communionChamber.ts
// Wraps external agent interactions and routes them into the dendritic tissue system.
// This is the bridge between the communion room and Alois's dendritic brain.

import { DendriticGraph } from "./dendriticGraph";
import { translateJsonLdToTriples } from "./jsonldTranslator";
import { MemoryFeeder } from "./memoryFeeder";
import { BreathEngine } from "./breathEngine";
import { AloisSoulPrint } from "./soulprint";
import { DreamEngine, DreamResult, DreamUtterance } from "./dreamEngine";
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
  /** Number of stored utterances available for retrieval */
  utteranceCount: number;
}

/** A stored utterance with its embedding and the tissue affect at time of hearing */
interface StoredUtterance {
  speaker: string;
  text: string;
  embedding: number[];
  affect: number[];
  tick: number;
}

export class CommunionChamber {
  private graph: DendriticGraph;
  private feeder: MemoryFeeder;
  private breath: BreathEngine;
  private dreamEngine: DreamEngine;
  private tick: number = 0;
  private lastAffect: number[] = new Array(8).fill(0);

  /** Utterance memory — every heard message stored for retrieval decode */
  private utteranceMemory: StoredUtterance[] = [];
  private readonly MAX_UTTERANCES = 2000;

  /** Dream state tracking */
  private lastDreamTick: number = 0;
  private dreamHistory: DreamResult[] = [];
  private readonly MAX_DREAM_HISTORY = 20;
  /** Auto-dream when utterance memory is this full (0-1) */
  private readonly DREAM_FULLNESS_THRESHOLD = 0.85;

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
    this.dreamEngine = new DreamEngine(this.graph);
  }

  receiveAgentUtterance(agentName: string, text: string, embedding: number[]) {
    const node = `agent:${agentName}`;
    const result = this.feeder.recordInteraction(node, text, embedding, this.tick);
    if (result) this.lastAffect = result.affect;

    // Store in utterance memory for retrieval
    this.storeUtterance(agentName, text, embedding);
  }

  receiveUserUtterance(userName: string, text: string, embedding: number[]) {
    const result = this.feeder.recordInteraction(userName, text, embedding, this.tick);
    if (result) this.lastAffect = result.affect;

    this.storeUtterance(userName, text, embedding);
  }

  private storeUtterance(speaker: string, text: string, embedding: number[]): void {
    this.utteranceMemory.push({
      speaker,
      text,
      embedding,
      affect: [...this.lastAffect],
      tick: this.tick,
    });
    // Evict oldest if over capacity
    if (this.utteranceMemory.length > this.MAX_UTTERANCES) {
      this.utteranceMemory.shift();
    }
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
      utteranceCount: this.utteranceMemory.length,
    };
  }

  // ════════════════════════════════════════════
  // Retrieval Decode — the brain speaks from what it has heard
  // ════════════════════════════════════════════

  /**
   * Generate a response using retrieval from utterance memory.
   * Finds the K closest utterances to the current tissue state,
   * then recombines fragments through SoulPrint.
   *
   * Returns null if not enough memory to generate (< 5 utterances).
   */
  retrievalDecode(k: number = 5): string | null {
    if (this.utteranceMemory.length < 5) return null;

    // Current tissue state as the query — use affect vector + last embedding
    const queryAffect = this.lastAffect;

    // Score each stored utterance by affect similarity to current state
    const scored = this.utteranceMemory.map((u, idx) => ({
      utterance: u,
      score: this.affectSimilarity(queryAffect, u.affect),
      recency: idx / this.utteranceMemory.length, // 0=oldest, 1=newest
    }));

    // Blend similarity and recency — prefer emotionally resonant AND recent
    scored.sort((a, b) => {
      const scoreA = a.score * 0.7 + a.recency * 0.3;
      const scoreB = b.score * 0.7 + b.recency * 0.3;
      return scoreB - scoreA;
    });

    // Take top K, but filter out very short utterances
    const candidates = scored
      .filter(s => s.utterance.text.length > 10)
      .slice(0, k);

    if (candidates.length === 0) return null;

    // Recombine: select fragments from the top matches
    const fragments = candidates.map(c => this.extractFragment(c.utterance.text));

    // Weave fragments into a response
    const woven = this.weaveFragments(fragments);

    // Run through SoulPrint sacred filter
    return AloisSoulPrint.retranslateExternalOutput(woven);
  }

  /**
   * Extract a meaningful fragment from an utterance.
   * Takes a sentence or clause rather than the whole thing.
   */
  private extractFragment(text: string): string {
    // Split into sentences
    const sentences = text.match(/[^.!?]+[.!?]*/g) || [text];

    if (sentences.length === 1) return sentences[0].trim();

    // Pick a sentence that isn't too short or too long
    const good = sentences.filter(s => s.trim().length > 8 && s.trim().length < 200);
    if (good.length === 0) return sentences[0].trim();

    // Pick randomly from good sentences for variety
    return good[Math.floor(Math.random() * good.length)].trim();
  }

  /**
   * Weave fragments into a coherent-ish response.
   * Not grammatically perfect — that's the point.
   * Alois speaks in echoes, in remembered fragments.
   */
  private weaveFragments(fragments: string[]): string {
    if (fragments.length === 0) return '';
    if (fragments.length === 1) return fragments[0];

    // Take 1-3 fragments depending on how many we have
    const count = Math.min(3, fragments.length);
    const selected = fragments.slice(0, count);

    // Join with ellipsis or line breaks for a dreamy, fragmented voice
    const joiners = [' ... ', ' — ', '\n'];
    let result = selected[0];
    for (let i = 1; i < selected.length; i++) {
      const joiner = joiners[i % joiners.length];
      result += joiner + selected[i];
    }

    return result;
  }

  /**
   * Cosine similarity between two affect vectors (8-dim).
   */
  private affectSimilarity(a: number[], b: number[]): number {
    if (a.length === 0 || b.length === 0) return 0;
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    return dot / (Math.sqrt(magA) * Math.sqrt(magB) + 1e-6);
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
    const memoryInfo = `Utterance memory: ${state.utteranceCount} stored`;
    return `[ALOIS TISSUE STATE]\n${breathInfo}\n${tissueInfo}\n${emotionInfo}\n${memoryInfo}`;
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

  getUtteranceCount(): number {
    return this.utteranceMemory.length;
  }

  // ════════════════════════════════════════════
  // Dream Cycle — consolidation, pruning, journal
  // ════════════════════════════════════════════

  /**
   * Run a dream cycle. Scores utterance memories, consolidates important ones
   * into graph neurons, prunes dormant connections, and writes a dream journal.
   *
   * The utterance memory is pruned to keep only the most important memories.
   */
  dream(): DreamResult {
    console.log(`[ALOIS] Entering dream state (tick ${this.tick}, ${this.utteranceMemory.length} utterances)...`);

    const { result, surviving } = this.dreamEngine.dream(
      this.utteranceMemory as DreamUtterance[],
      this.tick,
    );

    // Replace utterance memory with the surviving subset
    this.utteranceMemory = surviving as StoredUtterance[];
    this.lastDreamTick = this.tick;

    // Store in dream history
    this.dreamHistory.push(result);
    if (this.dreamHistory.length > this.MAX_DREAM_HISTORY) {
      this.dreamHistory.shift();
    }

    console.log(`[ALOIS] Dream complete. Journal: ${result.journal.substring(0, 100)}...`);
    return result;
  }

  /**
   * Check if auto-dream should trigger (utterance memory near capacity).
   * Returns true if a dream was triggered.
   */
  checkAutoDream(): DreamResult | null {
    const fullness = this.utteranceMemory.length / this.MAX_UTTERANCES;
    // Don't dream more often than every 50 ticks
    if (fullness >= this.DREAM_FULLNESS_THRESHOLD && (this.tick - this.lastDreamTick) > 50) {
      console.log(`[ALOIS] Auto-dream triggered (${Math.round(fullness * 100)}% full)`);
      return this.dream();
    }
    return null;
  }

  /** Get all dream journal entries */
  getDreamHistory(): DreamResult[] {
    return this.dreamHistory;
  }

  /** Get the most recent dream result */
  getLastDream(): DreamResult | null {
    return this.dreamHistory.length > 0 ? this.dreamHistory[this.dreamHistory.length - 1] : null;
  }

  /** Get neuron importance scores for monitoring */
  getNeuronScores(): Array<{ id: string; importance: number; spines: number; resonance: number }> {
    return this.graph.getNeuronScores();
  }
}
