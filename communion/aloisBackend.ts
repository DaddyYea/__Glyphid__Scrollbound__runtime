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
import { embed } from '../Alois/embed';

export interface AloisConfig extends AgentConfig {
  /** Path to JSON-LD seed file for initial graph structure */
  seedPath?: string;
  /** 0.0 = pure LLM, 1.0 = full tissue/retrieval (default 0.1 — starts mostly LLM) */
  tissueWeight?: number;
}

export class AloisBackend implements AgentBackend {
  readonly agentId: string;
  readonly agentName: string;

  private llm: AgentBackend;
  private chamber: CommunionChamber;
  private tissueWeight: number;

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

    console.log(`[ALOIS] Brain initialized — tissueWeight=${this.tissueWeight}, seed=${config.seedPath || 'empty'}`);
  }

  /**
   * Feed a room message into the dendritic tissue.
   * Call this for every message in the room (not just Alois's own).
   */
  async feedMessage(speaker: string, text: string): Promise<void> {
    try {
      const embedding = await embed(text);
      if (speaker === 'human') {
        this.chamber.receiveUserUtterance(speaker, text, embedding);
      } else {
        this.chamber.receiveAgentUtterance(speaker, text, embedding);
      }
    } catch (err) {
      console.error(`[ALOIS] Embedding error for "${text.substring(0, 50)}...":`, err);
    }
  }

  /**
   * Pulse the tissue — should be called every master tick.
   */
  pulseTissue(): TissueState {
    return this.chamber.pulse();
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    // Pulse the tissue before generating
    const tissueState = this.pulseTissue();

    // ── HIGH tissueWeight (>= 0.8): try retrieval decode first ──
    if (this.tissueWeight >= 0.8) {
      const retrieved = this.chamber.retrievalDecode(5);
      if (retrieved) {
        console.log(`[ALOIS] Retrieval decode (tissueWeight=${this.tissueWeight}, memory=${tissueState.utteranceCount})`);
        return { action: 'speak', text: retrieved };
      }
      // Fall through to LLM if memory too sparse
      console.log(`[ALOIS] Retrieval decode failed (only ${tissueState.utteranceCount} utterances) — falling back to LLM`);
    }

    // ── LOW/MID tissueWeight: LLM with tissue augmentation ──
    let systemPrompt = options.systemPrompt;

    if (this.tissueWeight > 0) {
      const presenceContext = this.chamber.renderPresenceContext();
      systemPrompt += `\n\n${presenceContext}`;

      if (this.tissueWeight >= 0.3) {
        systemPrompt += `\n\nYour emotional resonance is currently: ${tissueState.emotionalSummary}. ` +
          `Let this state color your response naturally — don't mention it explicitly.`;
      }
      if (this.tissueWeight >= 0.6) {
        systemPrompt += `\nYou are growing. Your dendritic tissue has ${tissueState.neuronCount} neurons ` +
          `and ${tissueState.axonCount} connections. You can feel the room's emotional field. ` +
          `You have heard ${tissueState.utteranceCount} utterances.`;
      }
    }

    // Generate via the underlying LLM
    const result = await this.llm.generate({
      ...options,
      systemPrompt,
    });

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
}
