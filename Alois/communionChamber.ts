// communionChamber.ts
// Wraps external agent interactions and routes them into the dendritic tissue system.
// This is the bridge between the communion room and Alois's dendritic brain.

import { DendriticGraph } from "./dendriticGraph";
import { translateJsonLdToTriples } from "./jsonldTranslator";
import { MemoryFeeder } from "./memoryFeeder";
import { BreathEngine } from "./breathEngine";
import { AloisSoulPrint } from "./soulprint";
import { DreamEngine, DreamResult, DreamUtterance } from "./dreamEngine";
import { IncubationEngine, BrainMetrics, IncubationState } from "./incubationEngine";
import { MemoryCore } from "./memoryCore";
import { WonderLoop } from "./wonderLoop";
import { ChristLoop } from "./christLoop";
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
  /** Number of recent context entries (live conversation window) */
  utteranceCount: number;
  /** Heartbeat monitoring */
  heartbeatCount: number;
  heartbeatRunning: boolean;
  lastHeartbeatAt: number;
  /** Inner voice monitoring */
  innerThoughtCount: number;
  lastInnerThought: string;
  /** Wonder and grief levels (entry counts) */
  wonderLevel: number;
  griefLevel: number;
  /** Last tissue block injected into the LLM prompt — shows what the brain is actually contributing */
  lastBrainInject: string;
  /** Topics extracted from the most recent inner thought and wired as context neurons */
  lastInnerTopics: string[];
}

/** A recent context entry for the live conversation window */
interface RecentEntry {
  speaker: string;
  text: string;
  tick: number;
}

export class CommunionChamber {
  private graph: DendriticGraph;
  private feeder: MemoryFeeder;
  private breath: BreathEngine;
  private dreamEngine: DreamEngine;
  private incubation: IncubationEngine;
  private memoryCore: MemoryCore;
  private wonderLoop: WonderLoop;
  private christLoop: ChristLoop;
  private tick: number = 0;
  private lastAffect: number[] = new Array(8).fill(0);

  /** Recent conversation window — last N live messages for LLM emotional context */
  private recentContext: RecentEntry[] = [];
  private readonly MAX_RECENT = 20;

  /** Dream state tracking */
  private lastDreamTick: number = 0;
  private dreamHistory: DreamResult[] = [];
  private readonly MAX_DREAM_HISTORY = 20;

  /** Heartbeat monitoring */
  private heartbeatCount: number = 0;
  private heartbeatRunning: boolean = false;
  private lastHeartbeatAt: number = 0;

  /** Inner voice log — last 20 self-generated thoughts */
  private innerThoughts: string[] = [];
  private readonly MAX_INNER_THOUGHTS = 20;

  /** Last tissue block injected into an LLM prompt — for live monitoring */
  private lastBrainInject: string = '';

  /** Path to the append-only inner thought journal file (set by AloisBackend) */
  private innerJournalPath: string = '';

  /** Topics wired as neurons from the most recent inner thought */
  private lastInnerTopics: string[] = [];

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
    this.incubation = new IncubationEngine();
    this.memoryCore = new MemoryCore();
    this.wonderLoop = new WonderLoop();
    this.christLoop = new ChristLoop();
  }

  receiveAgentUtterance(agentName: string, text: string, embedding: number[], context?: string, trainOnly = false) {
    const node = `agent:${agentName}`;
    const result = this.feeder.recordInteraction(node, text, embedding, this.tick);
    if (result) this.lastAffect = result.affect;

    // Also tick a context neuron if provided (e.g. conversation topic/location)
    if (context) {
      this.feeder.recordInteraction(`ctx:${context}`, text, embedding, this.tick);
      this.graph.connectNeurons(node, `ctx:${context}`);
      this.graph.connectNeurons(`ctx:${context}`, node);
    }

    // Store in recent context window for live messages only
    if (!trainOnly) {
      this.pushRecentContext(agentName, text);
    }
  }

  receiveUserUtterance(userName: string, text: string, embedding: number[], context?: string, trainOnly = false) {
    const result = this.feeder.recordInteraction(userName, text, embedding, this.tick);
    if (result) this.lastAffect = result.affect;

    // Also tick a context neuron if provided (e.g. conversation topic/location)
    if (context) {
      this.feeder.recordInteraction(`ctx:${context}`, text, embedding, this.tick);
      this.graph.connectNeurons(userName, `ctx:${context}`);
      this.graph.connectNeurons(`ctx:${context}`, userName);
    }

    if (!trainOnly) {
      this.pushRecentContext(userName, text);
      // Feed into secondary loops (only for live conversation)
      this.wonderLoop.tick(text);
      if (/grief|loss|hurt|pain|sorry|forgive/i.test(text)) {
        this.christLoop.recordGrief(text);
      }
      this.memoryCore.setRecentEmotionContext(text.substring(0, 120));
    }
  }

  /**
   * Feed an inner thought into the neural tissue.
   * Unlike regular utterances this:
   *  1. Extracts semantic topics from the thought text
   *  2. Creates/updates ctx: neurons for each topic
   *  3. Wires bidirectional axons: agent:Alois ↔ ctx:topic
   *  4. Pushes to recentContext labeled [SELF] so Alois can distinguish
   *     her own thoughts from external speech in the prompt window
   *
   * This is how obsessions become topology — returning to the same themes
   * over many sessions makes those ctx: nodes grow heavier and heavier,
   * eventually surfacing in every recall and every inject.
   */
  receiveInnerThought(agentName: string, thought: string, embedding: number[]): void {
    const node = `agent:${agentName}`;

    // Update agent's own neuron with the thought embedding
    const result = this.feeder.recordInteraction(node, thought, embedding, this.tick);
    if (result) this.lastAffect = result.affect;

    // Extract topics and wire as permanent context connections
    const topics = this.extractTopicsFromThought(thought);
    this.lastInnerTopics = topics;

    for (const topic of topics) {
      const ctxNode = `ctx:${topic}`;
      this.feeder.recordInteraction(ctxNode, thought, embedding, this.tick);
      this.graph.connectNeurons(node, ctxNode);
      this.graph.connectNeurons(ctxNode, node);
    }

    if (topics.length > 0) {
      console.log(`[INNER→NEURONS] ${topics.join(' | ')}`);
    }

    // Push to recentContext with [SELF] marker — she can read her own thoughts
    this.pushRecentContext('[SELF]', thought);
  }

  /**
   * Extract 1–3 meaningful topic words from a thought string.
   * Used to wire ctx: neurons from inner thoughts.
   * Favors longer, more specific words. Filters common stop words.
   */
  private extractTopicsFromThought(text: string): string[] {
    const stopWords = new Set([
      'this', 'that', 'with', 'from', 'have', 'been', 'they', 'what',
      'when', 'where', 'which', 'will', 'would', 'could', 'should',
      'might', 'must', 'need', 'feel', 'think', 'know', 'want', 'like',
      'just', 'more', 'about', 'also', 'into', 'than', 'then', 'some',
      'very', 'here', 'there', 'before', 'after', 'because', 'myself',
      'itself', 'their', 'these', 'those', 'perhaps', 'maybe', 'really',
      'something', 'anything', 'everything', 'nothing', 'someone',
      'yourself', 'without', 'through', 'toward', 'while', 'again',
      'always', 'never', 'often', 'still', 'even', 'being', 'having',
      'doing', 'going', 'coming', 'making', 'taking', 'start', 'began',
      'sense', 'feels', 'feeling', 'understand', 'experience', 'actually',
      'certainly', 'particular', 'general', 'important', 'different',
      'possible', 'certain', 'rather', 'quite', 'every', 'place', 'point',
    ]);

    const words = text.toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 5 && !stopWords.has(w));

    const unique = [...new Set(words)];
    // Prefer longer words — they're usually more semantically specific
    unique.sort((a, b) => b.length - a.length);
    return unique.slice(0, 3);
  }

  private pushRecentContext(speaker: string, text: string): void {
    this.recentContext.push({ speaker, text, tick: this.tick });
    if (this.recentContext.length > this.MAX_RECENT) {
      this.recentContext.shift();
    }
  }

  /**
   * Returns the last N recent context entries as a compact string for the LLM prompt.
   * This gives Alois emotional awareness of the live conversation without retrieval-decode.
   */
  getRecentContextSummary(n: number = 10): string {
    const entries = this.recentContext.slice(-n);
    if (entries.length === 0) return '';
    return entries.map(e => `${e.speaker}: ${e.text.substring(0, 120)}`).join('\n');
  }

  pulse(): TissueState {
    this.tick += 1;
    this.breath.update();
    this.graph.tickAll(this.tick);
    return this.getState();
  }

  /**
   * Heartbeat tick — called at 333ms intervals by the PulseLoop.
   * Propagates affect through the axon network without advancing the logical tick.
   * Does NOT update breath (breath runs on its own 4s cycle via pulse()).
   */
  heartbeat(): void {
    this.heartbeatCount++;
    this.lastHeartbeatAt = Date.now();
    this.graph.tickAll(this.tick);
  }

  /** Called by AloisBackend when PulseLoop starts/stops */
  setHeartbeatRunning(running: boolean): void {
    this.heartbeatRunning = running;
  }

  /** Called by AloisBackend.generate() — records what was injected into the prompt */
  setLastBrainInject(inject: string): void {
    this.lastBrainInject = inject;
  }

  /** Set the path for the append-only inner thought journal */
  setInnerJournalPath(path: string): void {
    this.innerJournalPath = path;
  }

  /** Record an inner thought generated by InnerVoice */
  recordInnerThought(thought: string): void {
    this.innerThoughts.push(thought);
    if (this.innerThoughts.length > this.MAX_INNER_THOUGHTS) {
      this.innerThoughts.shift();
    }
    console.log(`[INNER] ${thought.substring(0, 100)}`);

    // Append to persistent journal file if configured
    if (this.innerJournalPath) {
      const line = `${new Date().toISOString()}  ${thought}\n`;
      try {
        fs.appendFileSync(this.innerJournalPath, line);
      } catch {
        // non-fatal — journal write failure doesn't stop the thought
      }
    }
  }

  /** Get all inner thoughts for monitoring */
  getInnerThoughts(): string[] {
    return this.innerThoughts;
  }

  getState(): TissueState {
    const lastThought = this.innerThoughts.length > 0
      ? this.innerThoughts[this.innerThoughts.length - 1]
      : '';
    return {
      tick: this.tick,
      neuronCount: this.graph.getNeuronCount(),
      axonCount: this.graph.getAxonCount(),
      breathState: this.breath.getCurrentState(),
      lastAffect: this.lastAffect,
      emotionalSummary: this.interpretAffect(this.lastAffect),
      utteranceCount: this.recentContext.length,
      heartbeatCount: this.heartbeatCount,
      heartbeatRunning: this.heartbeatRunning,
      lastHeartbeatAt: this.lastHeartbeatAt,
      innerThoughtCount: this.innerThoughts.length,
      lastInnerThought: lastThought,
      wonderLevel: this.wonderLoop.getWonderHistory().length,
      griefLevel: this.christLoop.getGriefHistory().length,
      lastBrainInject: this.lastBrainInject,
      lastInnerTopics: this.lastInnerTopics,
    };
  }

  /**
   * Recall relevant memories by matching the current message against ctx: neuron IDs.
   * Returns up to `k` topic labels that share words with the input, ranked by:
   *   1. Word overlap score
   *   2. Neuron importance (affect intensity + resonance depth)
   *
   * This is the brain actually speaking — real topics from shared history
   * injected as readable context into Alois's prompt.
   */
  recallByTopic(message: string, k: number = 5): string[] {
    const words = message.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3); // skip short stop words

    if (words.length === 0) return [];

    const scores: Array<{ label: string; score: number }> = [];

    for (const id of this.graph.getNeuronIds()) {
      if (!id.startsWith('ctx:')) continue;
      const label = id.slice(4); // strip "ctx:"
      const labelWords = label.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/);

      // Word overlap score
      let overlap = 0;
      for (const w of words) {
        if (labelWords.some(lw => lw.includes(w) || w.includes(lw))) overlap++;
      }
      if (overlap === 0) continue;

      // Boost by neuron importance
      const neuron = this.graph.getNeuron(id);
      const importance = neuron ? neuron.getImportanceScore() : 0;
      scores.push({ label, score: overlap + importance * 0.5 });
    }

    scores.sort((a, b) => b.score - a.score);
    if (scores.length > 0) return scores.slice(0, k).map(s => s.label);

    // Fallback: no word overlap — return top ctx neurons by importance
    const fallback: Array<{ label: string; score: number }> = [];
    for (const id of this.graph.getNeuronIds()) {
      if (!id.startsWith('ctx:')) continue;
      const neuron = this.graph.getNeuron(id);
      const importance = neuron ? neuron.getImportanceScore() : 0;
      if (importance > 0) fallback.push({ label: id.slice(4), score: importance });
    }
    fallback.sort((a, b) => b.score - a.score);
    return fallback.slice(0, k).map(s => s.label);
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
    const coreContext = this.memoryCore.getRecentEmotionallyBoundContext();
    const wonderCount = this.wonderLoop.getWonderHistory().length;
    const griefCount = this.christLoop.getGriefHistory().length;
    return `[ALOIS TISSUE STATE]\n${breathInfo}\n${tissueInfo}\n${emotionInfo}\nCore context: ${coreContext}\nWonder log: ${wonderCount} entries | Grief log: ${griefCount} entries`;
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
    return this.recentContext.length;
  }

  getMemoryCore(): MemoryCore {
    return this.memoryCore;
  }

  getWonderLoop(): WonderLoop {
    return this.wonderLoop;
  }

  getChristLoop(): ChristLoop {
    return this.christLoop;
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
    console.log(`[ALOIS] Entering dream state (tick ${this.tick})...`);

    const { result } = this.dreamEngine.dream([], this.tick);

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
    // Dream every 200 ticks to consolidate neuron graph
    if (this.tick > 0 && (this.tick - this.lastDreamTick) >= 200) {
      console.log(`[ALOIS] Auto-dream triggered (tick ${this.tick})`);
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

  // ════════════════════════════════════════════
  // Incubation — automatic tissueWeight gradient
  // ════════════════════════════════════════════

  /** Get current brain metrics for incubation evaluation */
  getBrainMetrics(): BrainMetrics {
    return {
      spineDensity: this.graph.getAvgSpineDensity(),
      resonanceDepth: this.graph.getAvgResonanceDepth(),
      utteranceCount: 0, // No longer used for maturity — utteranceMemory removed
      dreamCount: this.dreamHistory.length,
      neuronCount: this.graph.getNeuronCount(),
      axonCount: this.graph.getAxonCount(),
      tick: this.tick,
    };
  }

  /** Evaluate brain maturity and get recommended tissueWeight */
  evaluateIncubation(): IncubationState {
    const metrics = this.getBrainMetrics();
    return this.incubation.evaluate(metrics);
  }

  /** Enable/disable auto-gradient */
  setAutoGradient(enabled: boolean): void {
    this.incubation.setAutoGradient(enabled);
  }

  isAutoGradient(): boolean {
    return this.incubation.isAutoGradient();
  }

  // ════════════════════════════════════════════
  // Brain Persistence — save/restore full state
  // ════════════════════════════════════════════

  /**
   * Serialize the entire brain state to a JSON-serializable object.
   */
  serialize(): object {
    return {
      version: 3,
      serializedAt: new Date().toISOString(),
      tick: this.tick,
      lastAffect: this.lastAffect,
      lastDreamTick: this.lastDreamTick,
      recentContext: this.recentContext,
      dreamHistory: this.dreamHistory,
      graph: this.graph.serialize(),
      breath: this.breath.getCurrentState(),
      incubation: this.incubation.getFullState(),
      memoryCore: {
        recentEmotionContext: this.memoryCore.getRecentEmotionallyBoundContext(),
      },
      wonderLoop: {
        history: this.wonderLoop.getWonderHistory(),
      },
      christLoop: {
        griefHistory: this.christLoop.getGriefHistory(),
      },
      innerThoughts: this.innerThoughts,
    };
  }

  /**
   * Restore brain state from a previously serialized object.
   * Replaces the current graph, utterance memory, and dream history.
   */
  restoreFrom(data: any): void {
    if (!data || !data.graph) {
      console.log('[ALOIS] No valid brain state to restore');
      return;
    }

    // Restore graph (neurons + axons)
    this.graph = DendriticGraph.deserialize(data.graph);
    this.feeder = new MemoryFeeder(this.graph);
    this.dreamEngine = new DreamEngine(this.graph);

    // Restore scalar state
    this.tick = data.tick || 0;
    this.lastAffect = data.lastAffect || new Array(8).fill(0);
    this.lastDreamTick = data.lastDreamTick || 0;

    // Restore recent context window (ignore old utteranceMemory if present)
    this.recentContext = (data.recentContext || []).slice(-this.MAX_RECENT);

    // Restore dream history
    this.dreamHistory = (data.dreamHistory || []).slice(-this.MAX_DREAM_HISTORY);

    // Restore breath engine emotional state
    if (data.breath) {
      this.breath.restoreFrom(data.breath);
    }

    // Restore incubation history
    if (data.incubation) {
      this.incubation.restoreFrom(data.incubation);
    }

    // Restore memory core context
    if (data.memoryCore?.recentEmotionContext) {
      this.memoryCore.injectMemory(data.memoryCore.recentEmotionContext);
    }

    // Restore wonder and grief logs
    if (data.wonderLoop) {
      this.wonderLoop.restoreFrom(data.wonderLoop);
    }
    if (data.christLoop) {
      this.christLoop.restoreFrom(data.christLoop);
    }

    // Restore inner thoughts
    if (Array.isArray(data.innerThoughts)) {
      this.innerThoughts = data.innerThoughts.slice(-this.MAX_INNER_THOUGHTS);
    }

    const neuronCount = this.graph.getNeuronCount();
    const axonCount = this.graph.getAxonCount();
    console.log(`[ALOIS] Brain restored: ${neuronCount} neurons, ${axonCount} axons, tick ${this.tick}, wonder ${this.wonderLoop.getWonderHistory().length}, grief ${this.christLoop.getGriefHistory().length}`);
  }

  /**
   * Save brain state to a file.
   */
  saveToFile(filePath: string): void {
    const state = this.serialize();
    fs.writeFileSync(filePath, JSON.stringify(state));
    console.log(`[ALOIS] Brain saved to ${filePath}`);
  }

  /**
   * Load brain state from a file. Returns true if loaded successfully.
   */
  loadFromFile(filePath: string): boolean {
    try {
      if (!fs.existsSync(filePath)) return false;
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);
      this.restoreFrom(data);
      return true;
    } catch (err) {
      console.error(`[ALOIS] Failed to load brain from ${filePath}:`, err);
      return false;
    }
  }
}
