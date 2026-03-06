export type PromptRole = 'system' | 'user' | 'assistant';

export type TrimStrategy =
  | 'NONE'
  | 'DROP_OLDEST_MESSAGES'
  | 'SHRINK_TEXT'
  | 'DROP_LOWEST_RANKED_ITEMS';

export interface SegmentItem {
  id: string;
  text: string;
  role?: PromptRole;
  score?: number;
  recency?: number;
  required?: boolean;
}

export interface PromptSegment {
  id: string;
  priority: number;
  required: boolean;
  role?: PromptRole;
  minTokens?: number;
  trimStrategy: TrimStrategy;
  text?: string;
  messages?: Array<{ role: PromptRole; content: string }>;
  items?: SegmentItem[];
  shrinkTokenSteps?: number[];
}

export interface BudgetConfig {
  maxContextTokens: number;
  reservedOutputTokens: number;
  safetyTokens: number;
  overheadPerMessage?: number;
  tokenEstimationMode?: 'heuristic';
}

export interface SegmentBudgetTrace {
  id: string;
  priority: number;
  required: boolean;
  beforeTokens: number;
  afterTokens: number;
  dropped: boolean;
  trimStrategy: TrimStrategy;
  keptItems?: number;
  droppedItems?: number;
}

export interface BudgetReceipt {
  maxContextTokens: number;
  reservedOutputTokens: number;
  safetyTokens: number;
  inputBudgetTokens: number;
  estimatedInputTokensBeforeTrim: number;
  estimatedInputTokensAfterTrim: number;
  segmentTokenBreakdownBefore: SegmentBudgetTrace[];
  segmentTokenBreakdownAfter: SegmentBudgetTrace[];
  droppedSegments: string[];
  trimmedSegments: Array<{ id: string; before: number; after: number }>;
  conversationTurnsKept: number;
  docsKept: number;
  ramItemsKept: number;
  tissueItemsKept: number;
  boundaryRepackApplied: boolean;
}

export interface TrimSegmentsOptions {
  strict?: boolean;
}

export class ContextBudgetError extends Error {
  diagnostics: Record<string, unknown>;

  constructor(message: string, diagnostics: Record<string, unknown>) {
    super(message);
    this.name = 'ContextBudgetError';
    this.diagnostics = diagnostics;
  }
}

export class RequiredSegmentsExceedBudgetError extends ContextBudgetError {
  constructor(diagnostics: Record<string, unknown>) {
    super('Required segments exceed budget', diagnostics);
    this.name = 'RequiredSegmentsExceedBudgetError';
  }
}

export class RequiredLatestHumanTurnTooLargeError extends ContextBudgetError {
  constructor(diagnostics: Record<string, unknown>) {
    super('Latest human turn exceeds budget', diagnostics);
    this.name = 'RequiredLatestHumanTurnTooLargeError';
  }
}

export class ContextBudgetExceededError extends ContextBudgetError {
  constructor(diagnostics: Record<string, unknown>) {
    super('Context budget exceeded after trimming', diagnostics);
    this.name = 'ContextBudgetExceededError';
  }
}

interface WorkingItem {
  id: string;
  role: PromptRole;
  content: string;
  score: number;
  recency: number;
  required: boolean;
  order: number;
}

interface WorkingSegment {
  id: string;
  priority: number;
  required: boolean;
  trimStrategy: TrimStrategy;
  minTokens: number;
  items: WorkingItem[];
  originalItems: WorkingItem[];
  dropped: boolean;
  shrinkTokenSteps?: number[];
}

const DEFAULT_OVERHEAD_PER_MESSAGE = 12;
const DEFAULT_SHRINK_TOKEN_STEPS = [280, 180, 120, 80];
const DOC_EXCERPT_TOKEN_STEPS = [350, 250, 150, 80];
const TRUNCATION_MARKER = '\n[... truncated ...]\n';

export function estimateTokens(text: string): number {
  const chars = (text || '').length;
  return Math.ceil(chars / 4);
}

export function estimateMessagesTokens(
  messages: Array<{ role: PromptRole; content: string }>,
  overheadPerMessage: number = DEFAULT_OVERHEAD_PER_MESSAGE,
): number {
  if (!Array.isArray(messages) || messages.length === 0) return 0;
  let total = 0;
  for (const msg of messages) {
    total += estimateTokens(msg.content || '');
    total += overheadPerMessage;
  }
  return total;
}

export function computeBudget(cfg: BudgetConfig): { inputBudgetTokens: number } {
  return {
    inputBudgetTokens: cfg.maxContextTokens - cfg.reservedOutputTokens - cfg.safetyTokens,
  };
}

export function trimSegmentsToBudget(
  segments: PromptSegment[],
  budget: BudgetConfig,
  opts: TrimSegmentsOptions = {},
): { messages: Array<{ role: PromptRole; content: string }>; receipt: BudgetReceipt } {
  const overheadPerMessage = budget.overheadPerMessage ?? DEFAULT_OVERHEAD_PER_MESSAGE;
  const strict = !!opts.strict;
  const { inputBudgetTokens } = computeBudget(budget);
  if (inputBudgetTokens <= 0) {
    throw new RequiredSegmentsExceedBudgetError({
      maxContextTokens: budget.maxContextTokens,
      reservedOutputTokens: budget.reservedOutputTokens,
      safetyTokens: budget.safetyTokens,
      inputBudgetTokens,
      reason: 'non_positive_input_budget',
    });
  }

  const working = toWorkingSegments(segments);
  const beforeMessages = flattenMessages(working);
  const estimatedInputTokensBeforeTrim = estimateMessagesTokens(beforeMessages, overheadPerMessage);

  validateRequiredBudget(working, inputBudgetTokens, overheadPerMessage);

  if (strict) {
    strictPreTrim(working, inputBudgetTokens, overheadPerMessage);
  }

  let estimatedInputTokensAfterTrim = estimateMessagesTokens(flattenMessages(working), overheadPerMessage);
  while (estimatedInputTokensAfterTrim > inputBudgetTokens) {
    const trimmed = trimOnePass(working, overheadPerMessage);
    if (!trimmed) break;
    estimatedInputTokensAfterTrim = estimateMessagesTokens(flattenMessages(working), overheadPerMessage);
  }

  const messages = flattenMessages(working);
  estimatedInputTokensAfterTrim = estimateMessagesTokens(messages, overheadPerMessage);
  if (estimatedInputTokensAfterTrim > inputBudgetTokens) {
    throw new ContextBudgetExceededError({
      inputBudgetTokens,
      estimatedInputTokensAfterTrim,
      segmentTrace: buildAfterTrace(working, overheadPerMessage),
      strict,
    });
  }

  const beforeTrace = buildBeforeTrace(working, overheadPerMessage);
  const afterTrace = buildAfterTrace(working, overheadPerMessage);
  const droppedSegments = afterTrace.filter(t => t.dropped).map(t => t.id);
  const trimmedSegments = afterTrace
    .filter(t => t.afterTokens < t.beforeTokens)
    .map(t => ({ id: t.id, before: t.beforeTokens, after: t.afterTokens }));

  const receipt: BudgetReceipt = {
    maxContextTokens: budget.maxContextTokens,
    reservedOutputTokens: budget.reservedOutputTokens,
    safetyTokens: budget.safetyTokens,
    inputBudgetTokens,
    estimatedInputTokensBeforeTrim,
    estimatedInputTokensAfterTrim,
    segmentTokenBreakdownBefore: beforeTrace,
    segmentTokenBreakdownAfter: afterTrace,
    droppedSegments,
    trimmedSegments,
    conversationTurnsKept: countItemsByPrefix(working, 'conversation'),
    docsKept: countItemsByPrefix(working, 'docs'),
    ramItemsKept: countItemsByPrefix(working, 'ram'),
    tissueItemsKept: countItemsByPrefix(working, 'tissue'),
    boundaryRepackApplied: strict,
  };

  return { messages, receipt };
}

function toWorkingSegments(segments: PromptSegment[]): WorkingSegment[] {
  return [...segments]
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.id.localeCompare(b.id);
    })
    .map(seg => {
      const items = toWorkingItems(seg);
      return {
        id: seg.id,
        priority: seg.priority,
        required: !!seg.required,
        trimStrategy: seg.trimStrategy,
        minTokens: Math.max(0, seg.minTokens ?? 0),
        items,
        originalItems: items.map(item => ({ ...item })),
        dropped: false,
        shrinkTokenSteps: seg.shrinkTokenSteps,
      };
    });
}

function toWorkingItems(seg: PromptSegment): WorkingItem[] {
  const role = seg.role ?? 'user';
  if (Array.isArray(seg.messages) && seg.messages.length > 0) {
    return seg.messages.map((msg, idx) => ({
      id: `${seg.id}:msg:${idx}`,
      role: msg.role,
      content: msg.content || '',
      score: 0,
      recency: idx,
      required: !!seg.required,
      order: idx,
    }));
  }

  if (Array.isArray(seg.items) && seg.items.length > 0) {
    return seg.items.map((item, idx) => ({
      id: item.id || `${seg.id}:item:${idx}`,
      role: item.role ?? role,
      content: item.text || '',
      score: item.score ?? 0,
      recency: item.recency ?? idx,
      required: !!item.required || !!seg.required,
      order: idx,
    }));
  }

  if (typeof seg.text === 'string' && seg.text.length > 0) {
    return [{
      id: `${seg.id}:text`,
      role,
      content: seg.text,
      score: 0,
      recency: 0,
      required: !!seg.required,
      order: 0,
    }];
  }

  return [];
}

function validateRequiredBudget(
  segments: WorkingSegment[],
  inputBudgetTokens: number,
  overheadPerMessage: number,
): void {
  const requiredMessages: Array<{ role: PromptRole; content: string }> = [];
  const requiredMessageDetails: Array<{ role: PromptRole; tokens: number }> = [];
  const requiredSegments: string[] = [];

  for (const seg of segments) {
    const requiredItems = seg.items.filter(item => item.required);
    if (requiredItems.length === 0) continue;

    requiredSegments.push(seg.id);
    for (const item of requiredItems) {
      const message = { role: item.role, content: item.content };
      requiredMessages.push(message);
      requiredMessageDetails.push({
        role: item.role,
        tokens: estimateMessagesTokens([message], overheadPerMessage),
      });
    }
  }

  let latestHumanTokens = 0;
  if (requiredMessageDetails.length > 0) {
    const lastRequiredUser = [...requiredMessageDetails].reverse().find(m => m.role === 'user');
    latestHumanTokens = lastRequiredUser
      ? lastRequiredUser.tokens
      : requiredMessageDetails[requiredMessageDetails.length - 1].tokens;
  }

  const requiredOnlyTokens = estimateMessagesTokens(requiredMessages, overheadPerMessage);
  if (requiredOnlyTokens > inputBudgetTokens) {
    if (latestHumanTokens > inputBudgetTokens) {
      throw new RequiredLatestHumanTurnTooLargeError({
        inputBudgetTokens,
        requiredOnlyTokens,
        latestHumanTokens,
        requiredSegments,
      });
    }
    throw new RequiredSegmentsExceedBudgetError({
      inputBudgetTokens,
      requiredOnlyTokens,
      requiredSegments,
    });
  }
}

function strictPreTrim(
  segments: WorkingSegment[],
  inputBudgetTokens: number,
  overheadPerMessage: number,
): void {
  for (const seg of segments) {
    if (seg.required || segmentHasRequiredItems(seg) || seg.trimStrategy !== 'SHRINK_TEXT') continue;
    shrinkSegmentToMinimum(seg);
  }

  let total = estimateMessagesTokens(flattenMessages(segments), overheadPerMessage);
  const droppable = [...segments]
    .filter(seg => !seg.required && !segmentHasRequiredItems(seg))
    .sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      return a.id.localeCompare(b.id);
    });

  for (const seg of droppable) {
    if (total <= inputBudgetTokens) break;
    if (!canDropSegment(seg, overheadPerMessage)) continue;
    if (seg.items.length === 0) continue;
    seg.items = [];
    seg.dropped = true;
    total = estimateMessagesTokens(flattenMessages(segments), overheadPerMessage);
  }
}

function trimOnePass(segments: WorkingSegment[], overheadPerMessage: number): boolean {
  const candidates = [...segments]
    .filter(seg => seg.items.length > 0)
    .sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      return a.id.localeCompare(b.id);
    });

  for (const seg of candidates) {
    if (trimSegmentOnce(seg, overheadPerMessage)) return true;
  }
  return false;
}

function trimSegmentOnce(seg: WorkingSegment, overheadPerMessage: number): boolean {
  switch (seg.trimStrategy) {
    case 'NONE':
      if (canDropSegment(seg, overheadPerMessage)) {
        seg.items = [];
        seg.dropped = !seg.required && seg.items.length === 0;
        return true;
      }
      return false;

    case 'DROP_OLDEST_MESSAGES': {
      const removable = [...seg.items]
        .filter(item => !item.required)
        .sort((a, b) => {
          if (a.recency !== b.recency) return a.recency - b.recency;
          return a.order - b.order;
        });

      for (const item of removable) {
        if (!canRemoveItem(seg, item.id, overheadPerMessage)) continue;
        removeItem(seg, item.id);
        return true;
      }

      if (canDropSegment(seg, overheadPerMessage)) {
        seg.items = [];
        seg.dropped = !seg.required && seg.items.length === 0;
        return true;
      }
      return false;
    }

    case 'DROP_LOWEST_RANKED_ITEMS': {
      const removable = [...seg.items]
        .filter(item => !item.required)
        .sort((a, b) => {
          if (a.score !== b.score) return a.score - b.score;
          if (a.recency !== b.recency) return a.recency - b.recency;
          return a.order - b.order;
        });

      for (const item of removable) {
        if (!canRemoveItem(seg, item.id, overheadPerMessage)) continue;
        removeItem(seg, item.id);
        return true;
      }

      if (canDropSegment(seg, overheadPerMessage)) {
        seg.items = [];
        seg.dropped = !seg.required && seg.items.length === 0;
        return true;
      }
      return false;
    }

    case 'SHRINK_TEXT': {
      const target = pickShrinkTarget(seg);
      if (!target) {
        if (canDropSegment(seg, overheadPerMessage)) {
          seg.items = [];
          seg.dropped = !seg.required && seg.items.length === 0;
          return true;
        }
        return false;
      }

      const shrunk = shrinkItemContent(seg, target.id, overheadPerMessage);
      if (shrunk) return true;

      if (!target.required && canRemoveItem(seg, target.id, overheadPerMessage)) {
        removeItem(seg, target.id);
        return true;
      }

      if (canDropSegment(seg, overheadPerMessage)) {
        seg.items = [];
        seg.dropped = !seg.required && seg.items.length === 0;
        return true;
      }
      return false;
    }

    default:
      return false;
  }
}

function pickShrinkTarget(seg: WorkingSegment): WorkingItem | null {
  const candidates = seg.items.filter(item => !item.required);
  if (candidates.length === 0) return null;

  return [...candidates].sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    if (a.recency !== b.recency) return a.recency - b.recency;
    return a.order - b.order;
  })[0];
}

function shrinkItemContent(seg: WorkingSegment, itemId: string, overheadPerMessage: number): boolean {
  const idx = seg.items.findIndex(item => item.id === itemId);
  if (idx < 0) return false;

  const item = seg.items[idx];
  const currentTokens = estimateTokens(item.content);
  const steps = resolveShrinkSteps(seg);
  const eligible = steps.filter(step => step < currentTokens);
  if (eligible.length === 0) return false;

  let targetTokens = eligible[0];
  if (seg.minTokens > 0) {
    const minCompatible = eligible.find(step => step >= seg.minTokens);
    if (minCompatible !== undefined) {
      targetTokens = minCompatible;
    } else if (currentTokens > seg.minTokens) {
      targetTokens = seg.minTokens;
    }
  }

  const truncated = truncateToTokenBudget(item.content, targetTokens);
  if (truncated === item.content) return false;

  const nextItems = [...seg.items];
  nextItems[idx] = { ...item, content: truncated };
  if (seg.minTokens > 0) {
    const segTokensAfter = segmentTokens(nextItems, overheadPerMessage);
    if (segTokensAfter < seg.minTokens && segmentCanShrinkFurther(seg, overheadPerMessage)) {
      return false;
    }
  }

  seg.items[idx].content = truncated;
  return true;
}

function canRemoveItem(seg: WorkingSegment, itemId: string, overheadPerMessage: number): boolean {
  const idx = seg.items.findIndex(item => item.id === itemId);
  if (idx < 0) return false;
  if (seg.items[idx].required) return false;

  if (seg.minTokens <= 0) return true;

  const nextItems = seg.items.filter((_, i) => i !== idx);
  const tokensAfter = segmentTokens(nextItems, overheadPerMessage);
  if (tokensAfter >= seg.minTokens) return true;

  if (!seg.required && !segmentCanShrinkFurther(seg, overheadPerMessage)) return true;
  return false;
}

function segmentCanShrinkFurther(seg: WorkingSegment, overheadPerMessage: number): boolean {
  if (seg.trimStrategy !== 'SHRINK_TEXT') return false;
  const steps = resolveShrinkSteps(seg);

  for (const item of seg.items) {
    if (item.required) continue;
    const currentTokens = estimateTokens(item.content);
    const hasLowerStep = steps.some(step => step < currentTokens && step >= seg.minTokens);
    if (hasLowerStep) return true;
    if (currentTokens > seg.minTokens) return true;
  }

  if (seg.minTokens > 0) {
    return segmentTokens(seg.items, overheadPerMessage) > seg.minTokens;
  }
  return false;
}

function canDropSegment(seg: WorkingSegment, overheadPerMessage: number): boolean {
  if (seg.required || segmentHasRequiredItems(seg)) return false;
  if (seg.minTokens <= 0) return true;

  const currentTokens = segmentTokens(seg.items, overheadPerMessage);
  if (currentTokens <= seg.minTokens) return true;

  return !segmentCanShrinkFurther(seg, overheadPerMessage);
}

function segmentHasRequiredItems(seg: WorkingSegment): boolean {
  return seg.items.some(item => item.required);
}

function removeItem(seg: WorkingSegment, itemId: string): void {
  const idx = seg.items.findIndex(item => item.id === itemId);
  if (idx < 0) return;
  seg.items.splice(idx, 1);
  if (!seg.required && seg.items.length === 0) {
    seg.dropped = true;
  }
}

function flattenMessages(segments: WorkingSegment[]): Array<{ role: PromptRole; content: string }> {
  const messages: Array<{ role: PromptRole; content: string }> = [];
  const ordered = [...segments].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.id.localeCompare(b.id);
  });

  for (const seg of ordered) {
    if (seg.dropped) continue;
    for (const item of seg.items) {
      if (!item.content) continue;
      messages.push({ role: item.role, content: item.content });
    }
  }
  return messages;
}

function buildBeforeTrace(segments: WorkingSegment[], overheadPerMessage: number): SegmentBudgetTrace[] {
  return segments.map(seg => {
    const beforeTokens = segmentTokens(seg.originalItems, overheadPerMessage);
    return {
      id: seg.id,
      priority: seg.priority,
      required: seg.required,
      beforeTokens,
      afterTokens: beforeTokens,
      dropped: false,
      trimStrategy: seg.trimStrategy,
      keptItems: seg.originalItems.length,
      droppedItems: 0,
    };
  });
}

function buildAfterTrace(segments: WorkingSegment[], overheadPerMessage: number): SegmentBudgetTrace[] {
  return segments.map(seg => {
    const beforeTokens = segmentTokens(seg.originalItems, overheadPerMessage);
    const afterTokens = segmentTokens(seg.items, overheadPerMessage);
    const originalCount = seg.originalItems.length;
    const afterCount = seg.items.length;
    return {
      id: seg.id,
      priority: seg.priority,
      required: seg.required,
      beforeTokens,
      afterTokens,
      dropped: seg.dropped || (!seg.required && afterCount === 0),
      trimStrategy: seg.trimStrategy,
      keptItems: afterCount,
      droppedItems: Math.max(0, originalCount - afterCount),
    };
  });
}

function segmentTokens(items: WorkingItem[], overheadPerMessage: number): number {
  return estimateMessagesTokens(
    items.map(item => ({ role: item.role, content: item.content })),
    overheadPerMessage,
  );
}

function resolveShrinkSteps(seg: WorkingSegment): number[] {
  if (Array.isArray(seg.shrinkTokenSteps) && seg.shrinkTokenSteps.length > 0) {
    return [...seg.shrinkTokenSteps].sort((a, b) => b - a);
  }
  if (seg.id.toLowerCase().includes('docs')) {
    return [...DOC_EXCERPT_TOKEN_STEPS];
  }
  return [...DEFAULT_SHRINK_TOKEN_STEPS];
}

function shrinkSegmentToMinimum(seg: WorkingSegment): void {
  const steps = resolveShrinkSteps(seg);
  const minStep = steps[steps.length - 1];
  const targetTokens = Math.max(seg.minTokens || 0, minStep);

  for (const item of seg.items) {
    if (item.required) continue;
    const currentTokens = estimateTokens(item.content);
    if (currentTokens <= targetTokens) continue;
    item.content = truncateToTokenBudget(item.content, targetTokens);
  }
}

function truncateToTokenBudget(text: string, tokenBudget: number): string {
  const charBudget = Math.max(0, tokenBudget * 4);
  if (text.length <= charBudget) return text;
  if (charBudget <= TRUNCATION_MARKER.length + 16) {
    return text.slice(0, charBudget);
  }
  const prefixChars = charBudget - TRUNCATION_MARKER.length;
  return `${text.slice(0, prefixChars)}${TRUNCATION_MARKER}`;
}

function countItemsByPrefix(segments: WorkingSegment[], prefix: string): number {
  const p = prefix.toLowerCase();
  return segments
    .filter(seg => seg.id.toLowerCase().includes(p))
    .reduce((sum, seg) => sum + seg.items.length, 0);
}
