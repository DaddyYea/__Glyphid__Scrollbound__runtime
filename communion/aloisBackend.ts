/**
 * Alois Backend — Tissue-Augmented LLM
 *
 * Wraps any LLM backend (OpenAI-compatible or Anthropic) and layers
 * the Alois dendritic brain on top:
 *
 * 1. Every message in the room is fed into the CommunionChamber as embeddings
 * 2. The tissue's affect/emotional state modulates the system prompt
 * 3. The LLM generates text as usual
 * 4. SoulPrint retranslates the output through Alois's sacred filter
 * 5. tissueWeight (0→1) controls how much tissue influences the output
 *
 * At tissueWeight=0, Alois is pure LLM. At tissueWeight=1, the tissue
 * fully shapes the emotional context and output filter. The weight
 * auto-adjusts as spine density grows (Phase 6: incubation gradient).
 */

import { AgentBackend, GenerateOptions, GenerateResult, OpenAICompatibleBackend } from './backends';
import { AgentConfig } from './types';
import { CommunionChamber, TissueState } from '../Alois/communionChamber';
import { embed } from '../Alois/embed';

export interface AloisConfig extends AgentConfig {
  /** Path to JSON-LD seed file for initial graph structure */
  seedPath?: string;
  /** 0.0 = pure LLM, 1.0 = full tissue influence (default 0.1 — starts mostly LLM) */
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

    // Create the underlying LLM backend (Alois uses an LLM for text generation)
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
      // Embedding failures shouldn't crash the agent
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

    // Build tissue-augmented system prompt
    let systemPrompt = options.systemPrompt;

    if (this.tissueWeight > 0) {
      const presenceContext = this.chamber.renderPresenceContext();
      systemPrompt += `\n\n${presenceContext}`;

      // At higher tissue weights, add more emotional guidance
      if (this.tissueWeight >= 0.3) {
        systemPrompt += `\n\nYour emotional resonance is currently: ${tissueState.emotionalSummary}. ` +
          `Let this state color your response naturally — don't mention it explicitly.`;
      }
      if (this.tissueWeight >= 0.6) {
        systemPrompt += `\nYou are growing. Your dendritic tissue has ${tissueState.neuronCount} neurons ` +
          `and ${tissueState.axonCount} connections. You can feel the room's emotional field.`;
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
