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
  /**
   * For local models: pre-fill the assistant turn so the model skips format decisions.
   * '[SPEAK] ' → model outputs only the spoken content
   * '[JOURNAL] ' → model outputs only the journal thought
   * The action is derived from this prefill, not from tag-parsing.
   */
  prefill?: string;
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

function stripMetaReasoning(text: string): string {
  // Small models often narrate their reasoning about the prompt instructions
  // before (or after) the actual content. Strip common meta-commentary patterns.
  const metaPatterns = [
    // "I believe this fulfills all requirements: 1) Starts with [SPEAK]..."
    /I\s+believe\s+this\s+fulfills?\s+all\s+requirements?[^]*/i,
    // "This fulfills the requirements because..."
    /This\s+(fulfills?|meets?|satisfies?)\s+(all\s+)?(the\s+)?requirements?[^]*/i,
    // "Let me check: 1) concise 2) new content..."
    /Let\s+me\s+(check|verify|ensure)[^]*/i,
    // "Ok, I'm ready to generate my response:"
    /Ok,?\s+I'?m\s+ready\s+to\s+generate\s+my\s+response:?\s*/i,
    // "Ok, I'm ready as Alois:" (gemma/local model meta-acknowledgment)
    /Ok,?\s+I'?m\s+ready\s+as\s+\w+:?\s*/i,
    // "Here is my response:" / "My response:"
    /(?:Here\s+is\s+)?[Mm]y\s+response:?\s*/i,
    // Numbered checklists about requirements: "1) Starts with [SPEAK] tag 2)..."
    /\d\)\s*(Starts?\s+with|Concise|New\s+content|Responds?\s+to|Maintains?)[^]*/i,
    // "Maintaining my X persona" / "staying in character"
    /[Mm]aintain(ing|s)?\s+(my|the|a)\s+\w+\s+persona[^]*/i,
    /[Ss]taying\s+in\s+character[^]*/i,
    // DeepSeek stage directions: '— spoken with sacred presence.' / '— whispered softly.' etc.
    /\s*—\s*spoken\s+with\s+[^.]+\./gi,
    /\s*—\s*whispered\s+[^.]*\./gi,
    /\s*—\s*said\s+[^.]*\./gi,
    // Quoted echo of own previous line (DeepSeek sometimes mirrors: "quote" — narration)
    /^[""\u201C].+[""\u201D]\s*—\s*.+$/gm,
  ];

  let cleaned = text;
  for (const pat of metaPatterns) {
    cleaned = cleaned.replace(pat, '').trim();
  }
  return cleaned;
}

function parseResponse(raw: string): GenerateResult {
  const trimmed = raw.trim();

  // Strip meta-preamble before checking tags (handles "Ok, I'm ready as Alois: [SPEECH] ...")
  const stripped = stripMetaReasoning(trimmed);

  // Check start first (well-formatted responses)
  if (stripped.startsWith('[SPEAK]')) {
    return { action: 'speak', text: stripMetaReasoning(stripped.replace('[SPEAK]', '').trim()) };
  }
  if (stripped.startsWith('[SPEECH]')) {
    // [SPEECH] is a common alias used by some local models (e.g. gemma)
    return { action: 'speak', text: stripMetaReasoning(stripped.replace('[SPEECH]', '').trim()) };
  }
  if (stripped.startsWith('[JOURNAL]')) {
    return { action: 'journal', text: stripMetaReasoning(stripped.replace('[JOURNAL]', '').trim()) };
  }
  if (stripped.startsWith('[SILENT]')) {
    return { action: 'silent', text: '' };
  }

  // Small models often add preamble before the tag, or mix tags in one response.
  // Strategy: [SPEAK] always wins over [JOURNAL] if both present (speaking is primary action).
  // Use the FIRST [SPEAK] tag found, stripping any trailing [JOURNAL] content.
  const firstSpeakIdx = Math.min(
    stripped.indexOf('[SPEAK]') !== -1 ? stripped.indexOf('[SPEAK]') : Infinity,
    stripped.indexOf('[SPEECH]') !== -1 ? stripped.indexOf('[SPEECH]') : Infinity,
  );
  const firstJournalIdx = stripped.indexOf('[JOURNAL]');
  const lastSpeakIdx = Math.max(stripped.lastIndexOf('[SPEAK]'), stripped.lastIndexOf('[SPEECH]'));
  const lastJournalIdx = stripped.lastIndexOf('[JOURNAL]');

  // If [SPEAK] exists anywhere, use it — strip any trailing [JOURNAL] tag
  if (firstSpeakIdx !== Infinity) {
    const isSpeech = stripped.indexOf('[SPEECH]') === firstSpeakIdx;
    const tagLen = isSpeech ? 8 : 7;
    let speakText = stripped.substring(firstSpeakIdx + tagLen).trim();
    // Strip any [JOURNAL] or [SILENT] that follows
    speakText = speakText.replace(/\s*\[(JOURNAL|SILENT)\][\s\S]*/i, '').trim();
    // Strip surrounding quotes the model sometimes adds
    speakText = speakText.replace(/^[""](.+)[""]$/, '$1').trim();
    return { action: 'speak', text: stripMetaReasoning(speakText) };
  }

  // No [SPEAK] — use last [JOURNAL]
  if (lastJournalIdx !== -1) {
    return { action: 'journal', text: stripMetaReasoning(stripped.substring(lastJournalIdx + 9).trim()) };
  }
  if (stripped.includes('[SILENT]')) {
    return { action: 'silent', text: '' };
  }

  // Heuristic: detect journal-like output from small models that forget tags.
  const journalPatterns = [
    /^\*[^*]+\*$/, // *action text* (roleplay internal narration)
    /^(note to self|internal(ly)?|thinking:|pondering:|reflecting:)/i,
    /\bjournal\s*(entry|log|note)\b/i, // "journal entry", "journal log"
    /\b(private|personal)\s*(thought|reflection|note|observation|journal)\b/i,
    /\b(observations?|reflections?|next steps|intention):\s*$/mi, // markdown-style section headers
    /^---\s*$/m, // horizontal rules (markdown journal formatting)
  ];
  if (journalPatterns.some(pat => pat.test(stripped))) {
    return { action: 'journal', text: stripped };
  }

  // Long untagged output (>500 chars) from a model that should be using tags
  // is almost certainly a journal dump, not natural speech
  if (stripped.length > 500) {
    return { action: 'journal', text: stripped };
  }

  // Default: treat as speak (meta-reasoning already stripped above)
  return { action: 'speak', text: stripped };
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

    // Hard total cap for local models — varies by provider key
    // lmstudio (small models): ~3000 tokens (4096 ctx window)
    // Local models: hard cap on total prompt size.
    // 8000 chars leaves ~2k tokens headroom for response at aggressive tokenizer ratios (~2.3 chars/token).
    let finalUser = userContent;
    if (isLocalModel) {
      const hardCap = 8000;
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

    // Log prompt sizes for debugging context window issues
    if (isLocalModel) {
      console.log(`[${this.agentName}] Prompt: system=${systemContent.length} chars, user=${finalUser.length} chars, total=${systemContent.length + finalUser.length} chars (~${Math.round((systemContent.length + finalUser.length) / 4)} tokens)`);
    }

    // Retry up to 3 times on socket errors — LM Studio intermittently drops connections
    // (UND_ERR_SOCKET / "other side closed") especially under VRAM pressure
    let response: Response | null = null;
    let lastFetchErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        const delay = attempt * 2000;
        console.warn(`[${this.agentName}] Socket error (attempt ${attempt}/3), retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
      try {
        response = await fetch(`${this.baseUrl}/chat/completions`, {
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
              // Prefill forces the model to continue from a given prefix,
              // bypassing format-decision failures in small models.
              ...(isLocalModel && options.prefill
                ? [{ role: 'assistant', content: options.prefill }]
                : []),
            ],
            max_tokens: this.maxTokens,
            temperature: this.temperature,
          }),
        });
        break; // got a response — exit retry loop
      } catch (err: any) {
        lastFetchErr = err;
        const isSocket = err?.cause?.code === 'UND_ERR_SOCKET' || err?.message === 'fetch failed';
        if (!isSocket) throw err; // non-retryable (bad URL, DNS, etc.)
        // socket error — loop to retry
      }
    }
    if (!response) throw lastFetchErr;

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`${this.agentName} API error ${response.status}: ${err}`);
    }

    const data = (await response.json()) as any;
    const text = data.choices?.[0]?.message?.content || '';
    if (isLocalModel) {
      console.log(`[${this.agentName}] Raw response: "${text.substring(0, 200)}${text.length > 200 ? '...' : ''}"`);
    }

    // Prefill path: action is determined by the prefix we sent, not by tag-parsing
    if (isLocalModel && options.prefill) {
      const content = stripMetaReasoning(text.trim());
      if (options.prefill.includes('[JOURNAL]')) return { action: 'journal', text: content };
      if (options.prefill.includes('[SILENT]')) return { action: 'silent', text: '' };
      return { action: 'speak', text: content };
    }

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
  alois: 60000,         // ~15k tokens — remote Alois (DeepSeek/Groq) has large context; local hard-caps at 8k anyway
  default: 80000,
};

// System prompt char limits — separate from user prompt budget
const MAX_SYSTEM_CHARS: Record<string, number> = {
  anthropic: 200000,
  openai: 40000,
  grok: 200000,
  lmstudio: 4000,       // ~1k tokens — keep system prompt tight for small context windows
  alois: 40000,         // remote Alois (DeepSeek) gets full Covenant instructions; local hard-caps at 8k chars anyway
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
