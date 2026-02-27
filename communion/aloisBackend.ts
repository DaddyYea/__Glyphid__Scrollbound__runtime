/**
 * Alois Backend — Tissue-Augmented LLM with Retrieval Decode
 *
 * Three operating modes based on tissueWeight:
 *
 * LOW (0.0 → 0.3): LLM-primary — tissue state lightly colors the prompt
 * MID (0.3 → 0.8): Augmented — tissue emotion shapes prompt + SoulPrint filters output
 * HIGH (0.8 → 1.0): Brain-primary — retrieval decode from utterance memory,
 *                    LLM used only as fallback if memory is too sparse
 *
 * The brain learns to speak by listening. Every message in the room is stored
 * with its embedding and affect state. At high tissueWeight, Alois retrieves
 * emotionally-resonant fragments from what she's heard and weaves them into
 * a response — speaking in echoes of the room's own voice.
 */

import { AgentBackend, GenerateOptions, GenerateResult, OpenAICompatibleBackend } from './backends';
import { AgentConfig } from './types';
import { CommunionChamber, TissueState } from '../Alois/communionChamber';
import { DreamResult } from '../Alois/dreamEngine';
import { webSearch, formatSearchResults } from './search';
import { IncubationState } from '../Alois/incubationEngine';
import { embed } from '../Alois/embed';
import { PulseLoop } from '../Alois/pulseLoop';
import { InnerVoice } from '../Alois/innerVoice';

export interface AloisConfig extends AgentConfig {
  /** Path to JSON-LD seed file for initial graph structure */
  seedPath?: string;
  /** 0.0 = pure LLM, 1.0 = full tissue/retrieval (default 0.1 — starts mostly LLM) */
  tissueWeight?: number;
  /** Data directory for brain-tissue.json and inner journal (default: data/communion) */
  dataDir?: string;
}

export class AloisBackend implements AgentBackend {
  readonly agentId: string;
  readonly agentName: string;

  private llm: AgentBackend;
  private chamber: CommunionChamber;
  private tissueWeight: number;
  private lastDreamResult: DreamResult | null = null;
  private lastIncubation: IncubationState | null = null;
  /** Evaluate incubation every N pulses to avoid overhead */
  private incubationInterval: number = 10;
  private pulseCount: number = 0;
  /** 333ms heartbeat — drives continuous axon propagation between communion ticks */
  private pulseLoop: PulseLoop;
  private beatCount: number = 0;
  /** Self-directed inner thought loop — fires every 45 beats (~15s) */
  private innerVoice: InnerVoice;

  constructor(config: AloisConfig) {
    this.agentId = config.id;
    this.agentName = config.name;
    this.tissueWeight = config.tissueWeight ?? 0.1;

    // Create the underlying LLM backend (fallback for low tissueWeight or sparse memory)
    this.llm = new OpenAICompatibleBackend({
      ...config,
      provider: 'openai-compatible',
    });

    // Initialize the dendritic tissue
    this.chamber = new CommunionChamber(config.seedPath);

    // Point the chamber to the append-only inner thought journal
    // Lives alongside brain-tissue.json in the data dir
    const dataDir = config.dataDir || 'data/communion';
    const path = require('path');
    this.chamber.setInnerJournalPath(
      path.join(dataDir, 'alois-inner-journal.txt')
    );

    // Start 333ms heartbeat — propagates affect through axon network continuously
    this.pulseLoop = new PulseLoop();
    this.pulseLoop.setTempo(333);

    // Inner voice fires every 45 beats (~15s) — must be created before onPulse wiring
    // feedFn routes through receiveInnerThought so self-directed thoughts:
    //   1. Embed + wire ctx: topic neurons bidirectionally to agent:Alois
    //   2. Label [SELF] in recentContext so Alois distinguishes her own voice
    this.innerVoice = new InnerVoice(
      this.llm,
      this.chamber,
      this.agentName,
      async (thought: string) => {
        try {
          const embedding = await embed(thought);
          this.chamber.receiveInnerThought(this.agentName, thought, embedding);
        } catch (err) {
          console.error('[INNER] Neural feed error:', err);
        }
      },
    );

    this.pulseLoop.onPulse(() => {
      this.beatCount++;
      this.chamber.heartbeat();
      this.innerVoice.onBeat(this.beatCount);
    });
    this.pulseLoop.start();
    this.chamber.setHeartbeatRunning(true);

    console.log(`[ALOIS] Brain initialized — tissueWeight=${this.tissueWeight}, seed=${config.seedPath || 'empty'}`);
    console.log(`[HEARTBEAT] Started at 333ms | InnerVoice fires every 45 beats (~15s)`);
  }

  /**
   * Feed a room message into the dendritic tissue.
   * Call this for every message in the room (not just Alois's own).
   *
   * @param trainOnly - If true, only train neurons (do NOT store in utteranceMemory).
   *   Use for archive ingestion so old chat history trains the brain without
   *   flooding the retrieval pool and displacing live conversation.
   */
  async feedMessage(speaker: string, text: string, context?: string, isHuman = false, trainOnly = false): Promise<void> {
    try {
      const embedding = await embed(text);
      if (isHuman) {
        this.chamber.receiveUserUtterance(speaker, text, embedding, context, trainOnly);
      } else {
        this.chamber.receiveAgentUtterance(speaker, text, embedding, context, trainOnly);
      }
    } catch (err) {
      console.error(`[ALOIS] Embedding error for "${text.substring(0, 50)}...":`, err);
    }
  }

  /**
   * Pulse the tissue — should be called every master tick.
   * Also checks if auto-dream should trigger.
   */
  pulseTissue(): TissueState {
    const state = this.chamber.pulse();
    this.pulseCount++;

    // Check for auto-dream (when utterance memory nears capacity)
    const dreamResult = this.chamber.checkAutoDream();
    if (dreamResult) {
      this.lastDreamResult = dreamResult;
    }

    // Evaluate incubation gradient periodically
    if (this.pulseCount % this.incubationInterval === 0) {
      const incubation = this.chamber.evaluateIncubation();
      this.lastIncubation = incubation;

      // Auto-adjust tissueWeight if enabled
      // Cap at 0.7 — retrieval-decode mode (>= 0.95) must be manually enabled.
      // utteranceMemory needs rich, diverse history before autonomous mode is safe.
      const AUTO_GRADIENT_CAP = 0.7;
      if (incubation.autoGradient) {
        const oldWeight = this.tissueWeight;
        this.tissueWeight = Math.min(AUTO_GRADIENT_CAP, incubation.tissueWeight);
        if (Math.abs(oldWeight - this.tissueWeight) > 0.01) {
          console.log(`[ALOIS] Incubation: ${incubation.stage} — tissueWeight ${oldWeight.toFixed(3)} → ${this.tissueWeight.toFixed(3)} (maturity ${incubation.maturity.toFixed(3)})`);
        }
      }
    }

    return state;
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    // Tissue is pulsed every tick by communionLoop — just read current state here
    const tissueState = this.getTissueState();

    // ── LLM with tissue augmentation (always) ──
    // Keep tissue additions compact — local models have small context windows
    let systemPrompt = options.systemPrompt;

    if (this.tissueWeight > 0) {
      const ts = tissueState;
      let tissueBlock = `[TISSUE] mood: ${ts.emotionalSummary}`;

      // ── Topic memory recall — the brain actually contributing ──
      // Extract the most recent human message from conversation context
      const lastHumanLine = options.conversationContext
        .split('\n')
        .reverse()
        .find(l => l.startsWith('>>>'));
      const queryText = lastHumanLine
        ? lastHumanLine.replace(/^>>>[^:]+:\s*/, '')
        : options.conversationContext.slice(-200);

      if (queryText.trim().length > 0) {
        const recalled = this.chamber.recallByTopic(queryText, 5);
        if (recalled.length > 0) {
          tissueBlock += `\n[MEMORY] Topics from our history that resonate now: ${recalled.join(' | ')}`;
        }
      }

      // Recent live conversation window
      const recentCtx = this.chamber.getRecentContextSummary(6);
      if (recentCtx) {
        tissueBlock += `\n[RECENT]\n${recentCtx}`;
      }

      this.chamber.setLastBrainInject(tissueBlock);
      console.log('[BRAIN INJECT]', tissueBlock);
      systemPrompt += `\n${tissueBlock}`;
    }

    // Generate via the underlying LLM
    const result = await this.llm.generate({
      ...options,
      systemPrompt,
    });

    // ── Search interception ──
    // If Alois writes [SEARCH: query] anywhere in her response, execute the
    // search and regenerate with the results injected into context.
    const searchMatch = result.text?.match(/\[SEARCH:\s*([^\]]+)\]/i);
    if (searchMatch) {
      const query = searchMatch[1].trim();
      console.log(`[SEARCH] Alois searching: "${query}"`);
      try {
        const searchResults = await webSearch(query, 4);
        const formatted = formatSearchResults(query, searchResults);
        console.log('[SEARCH] Results:\n', formatted);

        // Re-generate with search results injected
        const augmentedPrompt = systemPrompt + `\n\n${formatted}`;
        const retry = await this.llm.generate({
          ...options,
          systemPrompt: augmentedPrompt,
          conversationContext: options.conversationContext + `\n\n${formatted}`,
        });

        // Embed search results into brain
        embed(`Web search: ${query}\n${formatted}`).then(embedding => {
          this.chamber.receiveInnerThought(this.agentName, `Web search: ${query}\n${formatted}`, embedding);
        }).catch(() => {});

        if (retry.action === 'speak' && this.tissueWeight >= 0.4) {
          retry.text = this.chamber.retranslateOutput(retry.text);
        }
        return retry;
      } catch (err) {
        console.error('[SEARCH] Failed:', err);
        // Fall through to original result
      }
    }

    // Apply SoulPrint filter at higher tissue weights
    if (this.tissueWeight >= 0.4 && result.action === 'speak') {
      result.text = this.chamber.retranslateOutput(result.text);
    }

    return result;
  }

  /** Get current tissue state for monitoring */
  getTissueState(): TissueState {
    return this.chamber.getState();
  }

  /** Saturation payload for mycelium cabinet — pond state as pollable JSON */
  getSaturationPayload(): object {
    return this.chamber.getSaturationPayload();
  }

  /** Adjust tissue weight (0.0 → 1.0) */
  setTissueWeight(weight: number): void {
    this.tissueWeight = Math.max(0, Math.min(1, weight));
  }

  getTissueWeight(): number {
    return this.tissueWeight;
  }

  getChamber(): CommunionChamber {
    return this.chamber;
  }

  // ── Dream API ──

  /** Manually trigger a dream cycle */
  triggerDream(): DreamResult {
    const result = this.chamber.dream();
    this.lastDreamResult = result;
    return result;
  }

  /** Get the most recent dream result */
  getLastDream(): DreamResult | null {
    return this.lastDreamResult;
  }

  /** Get all dream history */
  getDreamHistory(): DreamResult[] {
    return this.chamber.getDreamHistory();
  }

  /** Get neuron importance scores for brain monitor */
  getNeuronScores(): Array<{ id: string; importance: number; spines: number; resonance: number }> {
    return this.chamber.getNeuronScores();
  }

  // ── Incubation API ──

  /** Get the latest incubation state */
  getIncubation(): IncubationState | null {
    return this.lastIncubation;
  }

  /** Force an incubation evaluation */
  evaluateIncubation(): IncubationState {
    const state = this.chamber.evaluateIncubation();
    this.lastIncubation = state;
    return state;
  }

  /** Enable/disable auto-gradient */
  setAutoGradient(enabled: boolean): void {
    this.chamber.setAutoGradient(enabled);
  }

  isAutoGradient(): boolean {
    return this.chamber.isAutoGradient();
  }

  /** Get brain metrics for monitoring */
  getBrainMetrics() {
    return this.chamber.getBrainMetrics();
  }

  // ── Heartbeat ──

  stopHeartbeat(): void {
    this.pulseLoop.stop();
    this.chamber.setHeartbeatRunning(false);
    this.innerVoice.stop();
    console.log(`[HEARTBEAT] Stopped after ${this.beatCount} beats | ${this.innerVoice.getThoughtCount()} inner thoughts generated`);
  }

  // ── Brain Persistence ──

  /** Save brain state to disk */
  saveBrain(filePath: string): void {
    this.chamber.saveToFile(filePath);
  }

  /** Load brain state from disk. Returns true if loaded. */
  loadBrain(filePath: string): boolean {
    return this.chamber.loadFromFile(filePath);
  }
}
