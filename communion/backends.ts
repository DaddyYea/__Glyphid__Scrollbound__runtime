/**
 * Agent Backends
 *
 * Generic interface + two providers:
 * - Anthropic (Claude)
 * - OpenAI-compatible (Grok, OpenAI, Mistral, local models, etc.)
 *
 * Any new provider just implements AgentBackend.
 */

import Anthropic from '@anthropic-ai/sdk';
import { AgentConfig } from './types';

export interface GenerateOptions {
  systemPrompt: string;
  conversationContext: string;
  journalContext: string;
  documentsContext?: string;
  memoryContext?: string;
}

export interface GenerateResult {
  text: string;
  action: 'speak' | 'journal' | 'silent';
}

/**
 * Common interface for all agent backends
 */
export interface AgentBackend {
  readonly agentId: string;
  readonly agentName: string;
  generate(options: GenerateOptions): Promise<GenerateResult>;
}

function parseResponse(raw: string): GenerateResult {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[SPEAK]')) {
    return { action: 'speak', text: trimmed.replace('[SPEAK]', '').trim() };
  }
  if (trimmed.startsWith('[JOURNAL]')) {
    return { action: 'journal', text: trimmed.replace('[JOURNAL]', '').trim() };
  }
  if (trimmed.startsWith('[SILENT]')) {
    return { action: 'silent', text: '' };
  }
  // Default: treat as speak
  return { action: 'speak', text: trimmed };
}

/**
 * Anthropic provider (Claude)
 */
export class AnthropicBackend implements AgentBackend {
  readonly agentId: string;
  readonly agentName: string;
  private client: Anthropic;
  private model: string;
  private maxTokens: number;

  constructor(config: AgentConfig) {
    this.agentId = config.id;
    this.agentName = config.name;
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.model = config.model;
    this.maxTokens = config.maxTokens || 512;
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: options.systemPrompt,
      messages: [
        {
          role: 'user',
          content: buildUserPrompt(options),
        },
      ],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    return parseResponse(text);
  }
}

/**
 * OpenAI-compatible provider (works with OpenAI, xAI/Grok, Mistral, local models, etc.)
 */
export class OpenAICompatibleBackend implements AgentBackend {
  readonly agentId: string;
  readonly agentName: string;
  private apiKey: string;
  private model: string;
  private baseUrl: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config: AgentConfig) {
    this.agentId = config.id;
    this.agentName = config.name;
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
    this.temperature = config.temperature ?? 0.8;
    this.maxTokens = config.maxTokens || 512;
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: options.systemPrompt },
          { role: 'user', content: buildUserPrompt(options) },
        ],
        max_tokens: this.maxTokens,
        temperature: this.temperature,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`${this.agentName} API error ${response.status}: ${err}`);
    }

    const data = (await response.json()) as any;
    const text = data.choices?.[0]?.message?.content || '';
    return parseResponse(text);
  }
}

function buildUserPrompt(options: GenerateOptions): string {
  const parts = [options.conversationContext, options.journalContext];
  if (options.documentsContext) {
    parts.push(options.documentsContext);
  }
  if (options.memoryContext) {
    parts.push(options.memoryContext);
  }
  parts.push('Based on the conversation, your private reflections, any shared documents, and the memory state, decide what to do this tick. Respond with EXACTLY one of these formats:\n\n[SPEAK] your message to the room\n[JOURNAL] your private reflection\n[SILENT] (say nothing this tick)');
  return parts.join('\n\n');
}

/**
 * Factory: create the right backend from an AgentConfig
 */
export function createBackend(config: AgentConfig): AgentBackend {
  switch (config.provider) {
    case 'anthropic':
      return new AnthropicBackend(config);
    case 'openai-compatible':
      return new OpenAICompatibleBackend(config);
    default:
      throw new Error(`Unknown provider: ${(config as any).provider}`);
  }
}
