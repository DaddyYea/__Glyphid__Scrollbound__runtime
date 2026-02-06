/**
 * Model Backends
 *
 * Claude via Anthropic API, Grok via xAI API (OpenAI-compatible).
 */

import Anthropic from '@anthropic-ai/sdk';
import { BackendConfig, CommunionMessage } from './types';

export interface GenerateOptions {
  systemPrompt: string;
  conversationContext: string;
  journalContext: string;
}

export interface GenerateResult {
  text: string;
  action: 'speak' | 'journal' | 'silent';
}

/**
 * Claude backend via Anthropic SDK
 */
export class ClaudeBackend {
  private client: Anthropic;
  private model: string;

  constructor(config: BackendConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.model = config.model;
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 512,
      system: options.systemPrompt,
      messages: [
        {
          role: 'user',
          content: `${options.conversationContext}\n\n${options.journalContext}\n\nBased on the conversation and your private reflections, decide what to do this tick. Respond with EXACTLY one of these formats:\n\n[SPEAK] your message to the room\n[JOURNAL] your private reflection\n[SILENT] (say nothing this tick)`,
        },
      ],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    return this.parseResponse(text);
  }

  private parseResponse(raw: string): GenerateResult {
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

    // If they didn't follow format, treat as speak
    return { action: 'speak', text: trimmed };
  }
}

/**
 * Grok backend via xAI API (OpenAI-compatible endpoint)
 */
export class GrokBackend {
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(config: BackendConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.baseUrl = config.baseUrl || 'https://api.x.ai/v1';
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
          {
            role: 'user',
            content: `${options.conversationContext}\n\n${options.journalContext}\n\nBased on the conversation and your private reflections, decide what to do this tick. Respond with EXACTLY one of these formats:\n\n[SPEAK] your message to the room\n[JOURNAL] your private reflection\n[SILENT] (say nothing this tick)`,
          },
        ],
        max_tokens: 512,
        temperature: 0.8,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Grok API error ${response.status}: ${err}`);
    }

    const data = await response.json() as any;
    const text = data.choices?.[0]?.message?.content || '';
    return this.parseResponse(text);
  }

  private parseResponse(raw: string): GenerateResult {
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

    return { action: 'speak', text: trimmed };
  }
}
