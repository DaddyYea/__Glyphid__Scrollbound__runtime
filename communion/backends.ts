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
  /** Provider hint for prompt size limiting */
  provider?: string;
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
      system: options.systemPrompt.replace(/[\uD800-\uDFFF]/g, ''),
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
    // Detect if this is a local/small model (LM Studio, Ollama, etc.)
    const isLocalModel = this.baseUrl.includes('localhost') || this.baseUrl.includes('127.0.0.1');
    const providerKey = options.provider || (isLocalModel ? 'lmstudio' : 'default');

    // Truncate system prompt if it exceeds provider limit
    let systemContent = options.systemPrompt.replace(/[\uD800-\uDFFF]/g, '');
    const maxSysChars = MAX_SYSTEM_CHARS[providerKey] || MAX_SYSTEM_CHARS.default;
    if (systemContent.length > maxSysChars) {
      const truncated = systemContent.length - maxSysChars;
      systemContent = systemContent.substring(0, maxSysChars) +
        `\n[... ${truncated} chars truncated ...]`;
    }

    // Build user prompt with provider-aware truncation
    const userContent = buildUserPrompt({ ...options, provider: providerKey });

    // Hard total cap: system + user must fit in ~3000 tokens (~12000 chars) for local models
    let finalUser = userContent;
    if (isLocalModel) {
      const hardCap = 12000; // ~3000 tokens, leaves ~1000 tokens for response in 4096 ctx
      const totalChars = systemContent.length + userContent.length;
      if (totalChars > hardCap) {
        const availableForUser = Math.max(2000, hardCap - systemContent.length);
        if (userContent.length > availableForUser) {
          const keepStart = Math.floor(availableForUser * 0.3);
          const keepEnd = Math.floor(availableForUser * 0.6);
          finalUser = userContent.substring(0, keepStart) +
            `\n[... truncated to fit ${this.model} context window ...]\n` +
            userContent.substring(userContent.length - keepEnd);
        }
      }
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: finalUser },
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

// Approximate char limits per provider (rough: 1 token ≈ 4 chars)
// Leave headroom for the response
const MAX_PROMPT_CHARS: Record<string, number> = {
  anthropic: 600000,    // ~150k tokens (200k max - headroom)
  openai: 80000,        // ~20k tokens (GPT-4o 128k but TPM limits)
  grok: 400000,         // ~100k tokens (131k max - headroom)
  lmstudio: 10000,      // ~2.5k tokens — local models often have 4-8k ctx, leave room for system prompt + response
  alois: 10000,         // ~2.5k tokens — uses underlying LLM (often local)
  default: 80000,
};

// System prompt char limits — separate from user prompt budget
const MAX_SYSTEM_CHARS: Record<string, number> = {
  anthropic: 200000,
  openai: 40000,
  grok: 200000,
  lmstudio: 4000,       // ~1k tokens — keep system prompt tight for small context windows
  alois: 4000,          // ~1k tokens
  default: 40000,
};

function buildUserPrompt(options: GenerateOptions): string {
  // Priority order: conversation first (most important), then journal, then instruction footer
  // Documents and memory go LAST so they get truncated first when space is tight
  const instruction = 'Based on the conversation, your private reflections, any shared documents, and the memory state, decide what to do this tick. Respond with EXACTLY one of these formats:\n\n[SPEAK] your message to the room\n[JOURNAL] your private reflection\n[SILENT] (say nothing this tick)';

  const maxChars = MAX_PROMPT_CHARS[options.provider || 'default'] || MAX_PROMPT_CHARS.default;

  // Start with highest priority content
  let prompt = [options.conversationContext, options.journalContext].filter(Boolean).join('\n\n');
  let remaining = maxChars - prompt.length - instruction.length - 20; // 20 for separators

  // Add documents only if there's room
  if (options.documentsContext && remaining > 200) {
    const docBudget = Math.min(options.documentsContext.length, Math.floor(remaining * 0.5));
    prompt += '\n\n' + options.documentsContext.substring(0, docBudget);
    remaining -= docBudget;
  }

  // Add memory only if there's room
  if (options.memoryContext && remaining > 200) {
    const memBudget = Math.min(options.memoryContext.length, remaining);
    prompt += '\n\n' + options.memoryContext.substring(0, memBudget);
  }

  prompt += '\n\n' + instruction;

  // Final safety cap (shouldn't be needed but just in case)
  if (prompt.length > maxChars) {
    // Keep start (conversation) and end (instruction footer)
    const keepStart = Math.floor(maxChars * 0.7);
    const keepEnd = Math.floor(maxChars * 0.2);
    const truncated = prompt.length - maxChars;
    prompt = prompt.substring(0, keepStart) +
      `\n\n[... ${truncated} characters truncated to fit context window ...]\n\n` +
      prompt.substring(prompt.length - keepEnd);
  }

  // Strip unpaired surrogates and other chars that break JSON serialization
  prompt = prompt.replace(/[\uD800-\uDFFF]/g, '');

  return prompt;
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
    case 'alois': {
      // Lazy import to avoid loading Alois modules when not needed
      const { AloisBackend } = require('./aloisBackend');
      return new AloisBackend(config);
    }
    default:
      throw new Error(`Unknown provider: ${(config as any).provider}`);
  }
}
