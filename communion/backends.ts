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
import {
  BudgetReceipt,
  ContextBudgetExceededError,
  PromptSegment,
  estimateMessagesTokens,
  trimSegmentsToBudget,
} from './contextBudget';

export type SearchIntent =
  | { kind: 'open_doc'; query?: string; uiSelection?: { docId?: string; title?: string; corpus?: 'ram' | 'drive' | 'local' | 'web' } }
  | { kind: 'search'; query?: string; uiSelection?: { docId?: string; title?: string; corpus?: 'ram' | 'drive' | 'local' | 'web' } }
  | { kind: 'none'; query?: string; uiSelection?: { docId?: string; title?: string; corpus?: 'ram' | 'drive' | 'local' | 'web' } };

export interface SearchReceipt {
  didSearch: boolean;
  query: string;
  corpus: 'ram' | 'drive' | 'archive' | 'web' | 'unknown';
  resultsCount: number;
  resultsShown?: number;
  top?: { title: string; id?: string; uri?: string };
  loadedContent?: boolean;
  metadataOnly?: boolean;
  error?: string;
  ms?: number;
  turnId?: string;
  agentId?: string;
  humanMessageId?: string;
}

export interface ActionReceipt {
  didExecute: boolean;
  action: 'browse' | 'read' | 'load_excerpt' | 'pin' | 'switch_doc' | 'undo';
  target: string;
  ok: boolean;
  summary: string;
  doc?: { id?: string; title?: string };
  ms?: number;
  turnId?: string;
  agentId?: string;
}

export interface GenerateOptions {
  systemPrompt: string;
  conversationContext: string;
  journalContext: string;
  documentsContext?: string;
  memoryContext?: string;
  segments?: PromptSegment[];
  maxContextTokens?: number;
  safetyTokens?: number;
  onBudgetReceipt?: (receipt: BudgetReceipt) => void;
  latestHumanText?: string;
  latestHumanSpeaker?: string;
  latestHumanMessageId?: string;
  searchIntent?: SearchIntent;
  onSearchReceipt?: (receipt: SearchReceipt) => void;
  onActionReceipt?: (receipt: ActionReceipt) => void;
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
  budgetReceipt?: BudgetReceipt;
  searchReceipt?: SearchReceipt;
  actionReceipt?: ActionReceipt;
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

const DEFAULT_MAX_CONTEXT_TOKENS: Record<string, number> = {
  anthropic: 200000,
  openai: 128000,
  grok: 131072,
  lmstudio: 8192,
  alois: 8192,
  default: 32768,
};

const DEFAULT_SAFETY_TOKENS = 512;

interface PackedPrompt {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  receipt: BudgetReceipt;
  finalMaxTokens: number;
}

const LOCAL_HARD_CAP_CHARS = 10000;

function buildBudgetedPrompt(
  options: GenerateOptions,
  providerKey: string,
  reservedOutputTokens: number,
): PackedPrompt {
  const maxContextTokens = options.maxContextTokens
    ?? DEFAULT_MAX_CONTEXT_TOKENS[providerKey]
    ?? DEFAULT_MAX_CONTEXT_TOKENS.default;
  const safetyTokens = options.safetyTokens ?? DEFAULT_SAFETY_TOKENS;
  const segments = sanitizeSegments(
    options.segments && options.segments.length > 0
      ? options.segments
      : buildDefaultSegments(options),
  );

  let packed = trimSegmentsToBudget(segments, {
    maxContextTokens,
    reservedOutputTokens,
    safetyTokens,
    tokenEstimationMode: 'heuristic',
  });
  let strictPassApplied = false;

  const inputBudgetTokens = maxContextTokens - reservedOutputTokens - safetyTokens;
  let estimatedInputTokens = estimateMessagesTokens(packed.messages);
  if (estimatedInputTokens > inputBudgetTokens) {
    packed = trimSegmentsToBudget(segments, {
      maxContextTokens,
      reservedOutputTokens,
      safetyTokens,
      tokenEstimationMode: 'heuristic',
    }, { strict: true });
    strictPassApplied = true;
    estimatedInputTokens = estimateMessagesTokens(packed.messages);
  }

  const isLocalProvider = providerKey === 'lmstudio';
  if (isLocalProvider) {
    const localCapped = enforceLocalHardCap(
      segments,
      packed,
      maxContextTokens,
      reservedOutputTokens,
      safetyTokens,
    );
    if (localCapped.didApply) {
      packed = localCapped.packed;
      strictPassApplied = strictPassApplied || localCapped.strictApplied;
      estimatedInputTokens = estimateMessagesTokens(packed.messages);
    }
  }

  if (estimatedInputTokens > inputBudgetTokens) {
    throw new ContextBudgetExceededError({
      providerKey,
      maxContextTokens,
      reservedOutputTokens,
      safetyTokens,
      inputBudgetTokens,
      estimatedInputTokensAfterTrim: estimatedInputTokens,
    });
  }

  const roomForOutput = Math.max(0, maxContextTokens - estimatedInputTokens - safetyTokens);
  const finalMaxTokens = Math.max(32, Math.min(reservedOutputTokens, roomForOutput || reservedOutputTokens));
  if (strictPassApplied && !packed.receipt.boundaryRepackApplied) {
    packed.receipt = { ...packed.receipt, boundaryRepackApplied: true };
  }
  if (packed.receipt.trimmedSegments.length > 0 || packed.receipt.droppedSegments.length > 0) {
    console.log(`[CONTEXT TRIM] removed=${packed.receipt.droppedSegments.length} trimmed=${packed.receipt.trimmedSegments.length} estAfter=${packed.receipt.estimatedInputTokensAfterTrim}`);
  }
  options.onBudgetReceipt?.(packed.receipt);
  return { messages: packed.messages, receipt: packed.receipt, finalMaxTokens };
}

function enforceLocalHardCap(
  sourceSegments: PromptSegment[],
  initialPacked: { messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>; receipt: BudgetReceipt },
  maxContextTokens: number,
  reservedOutputTokens: number,
  safetyTokens: number,
): { didApply: boolean; strictApplied: boolean; packed: { messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>; receipt: BudgetReceipt } } {
  let packed = initialPacked;
  let strictApplied = false;
  let totalChars = totalPromptChars(packed.messages);
  if (totalChars <= LOCAL_HARD_CAP_CHARS) {
    return { didApply: false, strictApplied, packed };
  }

  const segments = cloneSegments(sourceSegments);
  const repack = (strict: boolean): boolean => {
    const next = trimSegmentsToBudget(segments, {
      maxContextTokens,
      reservedOutputTokens,
      safetyTokens,
      tokenEstimationMode: 'heuristic',
    }, strict ? { strict: true } : {});
    packed = next;
    totalChars = totalPromptChars(packed.messages);
    strictApplied = strictApplied || strict;
    return totalChars <= LOCAL_HARD_CAP_CHARS;
  };

  if (dropSegmentByIdPattern(segments, /(^docs$|docs)/i) && repack(true)) {
    return { didApply: true, strictApplied, packed };
  }
  if (dropSegmentByIdPattern(segments, /(memory|ram|tissue)/i) && repack(true)) {
    return { didApply: true, strictApplied, packed };
  }
  if (dropSegmentByIdPattern(segments, /journal/i) && repack(true)) {
    return { didApply: true, strictApplied, packed };
  }

  while (totalChars > LOCAL_HARD_CAP_CHARS) {
    const removed = dropOldestConversationItem(segments);
    if (!removed) break;
    repack(true);
  }

  return { didApply: true, strictApplied, packed };
}

function dropSegmentByIdPattern(segments: PromptSegment[], pattern: RegExp): boolean {
  let changed = false;
  for (const seg of segments) {
    if (seg.required) continue;
    if (!pattern.test(seg.id)) continue;
    if (typeof seg.text === 'string' && seg.text.length > 0) {
      seg.text = '';
      changed = true;
    }
    if (Array.isArray(seg.messages) && seg.messages.length > 0) {
      seg.messages = [];
      changed = true;
    }
    if (Array.isArray(seg.items) && seg.items.length > 0) {
      seg.items = seg.items.filter(item => !!item.required);
      changed = true;
    }
  }
  return changed;
}

function dropOldestConversationItem(segments: PromptSegment[]): boolean {
  let targetSeg: PromptSegment | null = null;
  for (const seg of segments) {
    if (!seg.id.toLowerCase().includes('conversation')) continue;
    if (Array.isArray(seg.items) && seg.items.length > 0) {
      targetSeg = seg;
      break;
    }
  }
  if (!targetSeg || !targetSeg.items) return false;

  const removable = targetSeg.items
    .filter(item => item.id !== 'conversation:latest-human' && !item.required)
    .sort((a, b) => (a.recency ?? 0) - (b.recency ?? 0));
  if (removable.length === 0) return false;
  const removeId = removable[0].id;
  targetSeg.items = targetSeg.items.filter(item => item.id !== removeId);
  return true;
}

function cloneSegments(segments: PromptSegment[]): PromptSegment[] {
  return segments.map(seg => ({
    ...seg,
    messages: seg.messages ? seg.messages.map(msg => ({ ...msg })) : undefined,
    items: seg.items ? seg.items.map(item => ({ ...item })) : undefined,
  }));
}

function totalPromptChars(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>): number {
  return messages.reduce((sum, msg) => sum + (msg.content || '').length, 0);
}

function sanitizeSegments(segments: PromptSegment[]): PromptSegment[] {
  return segments.map(seg => ({
    ...seg,
    text: seg.text ? seg.text.replace(/[\uD800-\uDFFF]/g, '') : seg.text,
    messages: seg.messages?.map(msg => ({
      role: msg.role,
      content: (msg.content || '').replace(/[\uD800-\uDFFF]/g, ''),
    })),
    items: seg.items?.map(item => ({
      ...item,
      text: (item.text || '').replace(/[\uD800-\uDFFF]/g, ''),
    })),
  }));
}

function buildDefaultSegments(options: GenerateOptions): PromptSegment[] {
  const instruction = 'Based on the conversation, your private reflections, any shared documents, and the memory state, decide what to do this tick. Respond with EXACTLY one of these formats:\n\n[SPEAK] your message to the room\n[JOURNAL] your private reflection\n[SILENT] (say nothing this tick)';
  const convoLines = (options.conversationContext || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  const latestHumanIdx = (() => {
    for (let i = convoLines.length - 1; i >= 0; i--) {
      if (convoLines[i].startsWith('>>>')) return i;
    }
    return -1;
  })();
  const conversationItems = convoLines.map((line, idx) => ({
    id: idx === latestHumanIdx ? 'conversation:latest-human' : `conversation:${idx}`,
    text: line,
    role: 'user' as const,
    recency: idx,
    required: idx === latestHumanIdx,
    score: idx === latestHumanIdx ? 2 : 1,
  }));

  const segments: PromptSegment[] = [
    {
      id: 'system',
      priority: 1,
      required: true,
      trimStrategy: 'NONE',
      role: 'system',
      text: options.systemPrompt || '',
    },
    {
      id: 'instruction',
      priority: 2,
      required: true,
      trimStrategy: 'NONE',
      role: 'user',
      text: instruction,
    },
    {
      id: 'conversation',
      priority: 3,
      required: latestHumanIdx >= 0,
      trimStrategy: 'DROP_OLDEST_MESSAGES',
      role: 'user',
      items: conversationItems,
    },
    {
      id: 'journal',
      priority: 4,
      required: false,
      trimStrategy: 'SHRINK_TEXT',
      role: 'user',
      text: options.journalContext || '',
    },
  ];
  if (options.documentsContext) {
    segments.push({
      id: 'docs',
      priority: 5,
      required: false,
      trimStrategy: 'SHRINK_TEXT',
      role: 'user',
      text: options.documentsContext,
      shrinkTokenSteps: [350, 250, 150, 80],
    });
  }
  if (options.memoryContext) {
    segments.push({
      id: 'memory',
      priority: 6,
      required: false,
      trimStrategy: 'DROP_LOWEST_RANKED_ITEMS',
      role: 'user',
      items: [{
        id: 'memory:0',
        text: options.memoryContext,
        score: 0,
      }],
    });
  }
  return segments;
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
    const packed = buildBudgetedPrompt(options, options.provider || 'anthropic', this.maxTokens);
    const systemContent = packed.messages
      .filter(m => m.role === 'system')
      .map(m => m.content)
      .join('\n\n')
      .replace(/[\uD800-\uDFFF]/g, '');
    const nonSystem = packed.messages.filter(m => m.role !== 'system');
    const anthropicMessages = nonSystem.length > 0
      ? nonSystem.map(m => ({
        role: m.role === 'assistant' ? 'assistant' as const : 'user' as const,
        content: m.content,
      }))
      : [{ role: 'user' as const, content: '' }];

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: packed.finalMaxTokens,
      system: systemContent,
      messages: anthropicMessages,
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const parsed = parseResponse(text);
    return { ...parsed, budgetReceipt: packed.receipt };
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
    // Local endpoints must always use lmstudio budgeting rules regardless of logical provider label.
    const providerKey = isLocalModel ? 'lmstudio' : (options.provider || 'default');
    const packed = buildBudgetedPrompt(options, providerKey, this.maxTokens);
    const finalMessages = [...packed.messages];
    if (isLocalModel && options.prefill) {
      finalMessages.push({ role: 'assistant', content: options.prefill });
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
            messages: finalMessages,
            max_tokens: packed.finalMaxTokens,
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
      const isCtxOverflow = response.status === 400 && /context size has been exceeded|context.*exceed/i.test(err);
      if (isLocalModel && isCtxOverflow) {
        // One emergency retry with an extra-hard char cap for tokenizer mismatch on local models.
        const emergencyMessages = emergencyTrimMessages(finalMessages, 6000);
        const retry = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            messages: emergencyMessages,
            max_tokens: Math.max(32, Math.min(128, packed.finalMaxTokens)),
            temperature: this.temperature,
          }),
        });
        if (retry.ok) {
          const data = (await retry.json()) as any;
          const text = data.choices?.[0]?.message?.content || '';
          if (isLocalModel) {
            console.log(`[${this.agentName}] Raw response (emergency retry): "${text.substring(0, 200)}${text.length > 200 ? '...' : ''}"`);
          }
          if (isLocalModel && options.prefill) {
            const content = stripMetaReasoning(text.trim());
            if (options.prefill.includes('[JOURNAL]')) return { action: 'journal', text: content, budgetReceipt: packed.receipt };
            if (options.prefill.includes('[SILENT]')) return { action: 'silent', text: '', budgetReceipt: packed.receipt };
            return { action: 'speak', text: content, budgetReceipt: packed.receipt };
          }
          const parsed = parseResponse(text);
          return { ...parsed, budgetReceipt: packed.receipt };
        }
        const retryErr = await retry.text();
        throw new Error(`${this.agentName} API error ${retry.status}: ${retryErr}`);
      }
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
      if (options.prefill.includes('[JOURNAL]')) return { action: 'journal', text: content, budgetReceipt: packed.receipt };
      if (options.prefill.includes('[SILENT]')) return { action: 'silent', text: '', budgetReceipt: packed.receipt };
      return { action: 'speak', text: content, budgetReceipt: packed.receipt };
    }

    const parsed = parseResponse(text);
    return { ...parsed, budgetReceipt: packed.receipt };
  }
}

function emergencyTrimMessages(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  charCap: number,
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const latestUserIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') return i;
    }
    return -1;
  })();
  const requiredIdx = new Set<number>();
  if (latestUserIdx >= 0) requiredIdx.add(latestUserIdx);
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'system') requiredIdx.add(i);
  }

  const copy = messages.map(m => ({ ...m }));
  const totalChars = () => copy.reduce((sum, m) => sum + (m.content || '').length, 0);

  // Drop oldest non-required user/assistant messages first.
  let idx = 0;
  while (totalChars() > charCap && idx < copy.length) {
    if (!requiredIdx.has(idx) && copy[idx].content) {
      copy[idx].content = '';
    }
    idx++;
  }

  // If still over, shrink non-required remaining content.
  for (let i = 0; i < copy.length && totalChars() > charCap; i++) {
    if (requiredIdx.has(i) || !copy[i].content) continue;
    const over = totalChars() - charCap;
    const target = Math.max(80, copy[i].content.length - over);
    copy[i].content = `${copy[i].content.slice(0, target)}\n[... truncated ...]`;
  }

  // Keep latest user intact; if impossible, trim only systems.
  for (let i = 0; i < copy.length && totalChars() > charCap; i++) {
    if (i === latestUserIdx || copy[i].role !== 'system' || !copy[i].content) continue;
    const over = totalChars() - charCap;
    const target = Math.max(120, copy[i].content.length - over);
    copy[i].content = `${copy[i].content.slice(0, target)}\n[... truncated ...]`;
  }

  return copy.filter(m => (m.content || '').trim().length > 0);
}



/**
 * Factory: create the right backend from an AgentConfig
 */
export function createBackend(config: AgentConfig): AgentBackend {
  switch (config.provider) {
    case 'anthropic':
      return new AnthropicBackend(config);
    case 'openai-compatible':
    case 'lmstudio':
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
