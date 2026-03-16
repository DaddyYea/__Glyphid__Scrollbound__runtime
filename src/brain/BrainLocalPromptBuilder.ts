import { RenderedDoctrine } from './DoctrineRenderer';
import { RouterPacket } from './RouterPacket';

export interface BrainLocalPromptBuildInput {
  agentName: string;
  latestHumanText: string;
  latestHumanSpeaker?: string;
  conversationContext?: string;
  memoryContext?: string;
  recentRoomTurns?: Array<{ role: 'user' | 'assistant'; speakerName?: string; content: string }>;
  routerPacket: RouterPacket;
  doctrine: RenderedDoctrine;
  controlBlock?: string;
  /** Volitional seed block — topic suggestions and anti-repetition hints for self-initiated speech */
  volitionalSeed?: string;
}

export interface BrainLocalPromptBuildResult {
  systemPrompt: string;
  userPrompt: string;
  selectedContextBlocks: string[];
  selectedContextDetails?: Array<{ source: 'pinned' | 'recent'; text: string }>;
  renderedSchemaSummary?: Record<string, unknown>;
  debugMessages: Array<{ role: 'system' | 'user'; content: string }>;
}

type PromptContextTurn = {
  role: 'user' | 'assistant';
  speakerName?: string;
  content: string;
  normalized: string;
  index: number;
};

function normalizeBlock(block: string): string {
  return String(block || '').replace(/\r/g, '').trim();
}

function looksLikeRuntimeState(text: string): boolean {
  const s = String(text || '');
  return (
    /\[COGNITIVE STATE\]/i.test(s) ||
    /\bslot-\d+\b/i.test(s) ||
    /\bdominance\b/i.test(s) ||
    /\bpersistence\b/i.test(s) ||
    /\bworking memory\b/i.test(s) ||
    /\bmemory system state\b/i.test(s) ||
    /\bscrollgraph\b/i.test(s) ||
    /\breflection_flags\b/i.test(s) ||
    /\bopen_slots\b/i.test(s) ||
    /\bloop_intent\b/i.test(s) ||
    /\bcoherence\b/i.test(s) ||
    /\bDUAL-LOBE CONTROL\b/i.test(s) ||
    /\bROUTED TURN SCHEMA\b/i.test(s) ||
    /\bINTERNAL DOCTRINE\b/i.test(s) ||
    /\bmust_answer:\b/i.test(s) ||
    /\blive_topic:\b/i.test(s) ||
    /\brepair_object:\b/i.test(s) ||
    /\bquestion_form:\b/i.test(s) ||
    /\bmixed_intent:\b/i.test(s) ||
    /\brouter_packet_v1\b/i.test(s)
  );
}

function looksLikeDocToolContamination(text: string): boolean {
  const s = String(text || '').toLowerCase();
  return (
    s.includes('shared documents')
    || s.includes('shared files')
    || s.includes('documents')
    || s.includes('uploaded files')
    || s.includes('search results')
    || s.includes('file search')
    || s.includes('tool')
    || s.includes('upload')
    || s.includes('docs')
  );
}

function stripDocToolContamination(text: string): string {
  const source = String(text || '').replace(/\r/g, '');
  if (!source.trim()) return '';
  return source
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.trim())
    .filter(line => !looksLikeDocToolContamination(line))
    .join('\n')
    .trim();
}

function assertLiteralHumanText(text: string, fieldName: string): string {
  const normalized = normalizeBlock(text);
  if (looksLikeRuntimeState(normalized)) {
    throw new Error(`${fieldName} contains runtime/control/state text`);
  }
  return normalized;
}

function truncateTurn(text: string, maxChars = 220): string {
  const normalized = normalizeBlock(text).replace(/\s+/g, ' ');
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 3)}...`;
}

function splitContextBlocks(conversationContext: string): string[] {
  const source = String(conversationContext || '').replace(/\r/g, '');
  if (!source.trim()) return [];
  const conversationalTurns = source
    .split(/\n+/)
    .map(line => line.trim())
    .filter(line => /^>>>\s+/.test(line))
    .map(line => line.replace(/^>>>\s+/, '').trim())
    .filter(Boolean);
  if (conversationalTurns.length > 0) {
    return conversationalTurns
      .map(block => stripDocToolContamination(block))
      .filter(Boolean)
      .filter(block => !looksLikeRuntimeState(block))
      .filter(block => !looksLikeDocToolContamination(block));
  }

  return source
    .split(/\n\s*\n+/)
    .map(normalizeBlock)
    .filter(Boolean)
    .map(block => stripDocToolContamination(block))
    .filter(Boolean)
    .filter(block => !looksLikeRuntimeState(block))
    .filter(block => !looksLikeDocToolContamination(block));
}

function compactWorkingMemory(memoryContext: string | undefined): string {
  const source = normalizeBlock(memoryContext || '');
  if (!source) return '';
  const cleaned = stripDocToolContamination(source)
    .replace(/^\s*MEMORY SYSTEM STATE.*$/im, '[MEMORY_STATE]')
    .replace(/\bScrollGraph:[^\n]*/gi, '')
    .replace(/\bNode types:[^\n]*/gi, '')
    .replace(/\bShort-term buffer:[^\n]*/gi, '')
    .replace(/\bPermanent archive:[^\n]*/gi, '')
    .replace(/\bDetected patterns[^\n]*/gi, '')
    .replace(/\bMost connected nodes:[\s\S]*$/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!cleaned || looksLikeDocToolContamination(cleaned)) return '';
  return truncateTurn(cleaned, 900);
}

function isConversationalContextBlock(block: string): boolean {
  const source = normalizeBlock(block);
  if (!source) return false;
  if (looksLikeRuntimeState(source)) return false;
  if (looksLikeDocToolContamination(source)) return false;
  if (/^(MEMORY SYSTEM STATE|SHARED DOCUMENTS)\b/i.test(source)) return false;
  if (/^(?:\[RAM:|ScrollGraph:|Short-term buffer:|Permanent archive:)\b/i.test(source)) return false;
  if (/\b(Node types:|Most connected nodes:|Detected patterns \(|These files are NOT pre-loaded|use RAM:BROWSE)\b/i.test(source)) return false;
  if (/\b\[docx — use RAM:BROWSE to search\]|\[docx/i.test(source)) return false;
  if (source.length > 1200 && !/^>>>\s+/m.test(source)) return false;
  return true;
}

function formatStructuredTurns(
  recentRoomTurns: Array<{ role: 'user' | 'assistant'; speakerName?: string; content: string }>,
  latestHumanText: string,
): string[] {
  const latest = normalizeBlock(latestHumanText);
  return recentRoomTurns
    .map(turn => ({
      role: turn.role,
      speakerName: turn.speakerName,
      content: normalizeBlock(turn.content),
    }))
    .filter(turn => turn.content && turn.content !== latest)
    .filter(turn => isConversationalContextBlock(turn.content))
    .map(turn => `${turn.role === 'assistant' ? (turn.speakerName || 'Assistant') : (turn.speakerName || 'Jason')}: ${truncateTurn(turn.content, 260)}`);
}

function isQuestionLike(text: string): boolean {
  return /\?/.test(text) || /^(?:was|is|are|do|did|can|could|would|will|have|has|why|what|how|when|where|which|who)\b/i.test(text);
}

function isRepairLike(text: string): boolean {
  const lower = text.toLowerCase();
  return [
    /\bthat does(?: not|n't) answer\b/,
    /\byou did(?: not|n't) answer\b/,
    /\banswer the question\b/,
    /\bthat(?:'s| is) not what i asked\b/,
    /\byou(?:'re| are) not answering\b/,
    /\bthat missed the point\b/,
    /\bthat has nothing to do with\b/,
    /\bnot what i meant\b/,
    /\bwrong frame\b/,
    /\byou switched topics\b/,
    /\bstay with this\b/,
    /\bstop dodging\b/,
    /\bstop deflecting\b/,
    /\byou(?:'re| are) talking around it\b/,
    /\byou changed the subject\b/,
    /\bthat was sideways\b/,
    /\bthat(?:'s| is) not coherent\b/,
    /\byou lost the thread\b/,
    /\bwhy did(?:n't| not) you answer\b/,
    /\bwhat are you doing\b/,
    /\bthat does(?:n't| not) make sense\b/,
    /\bno you did(?:n't| not)\b/,
    /\bi didn'?t say that\b/,
  ].some(pattern => pattern.test(lower));
}

function parseStructuredRecentTurns(
  latestHumanText: string,
  recentRoomTurns?: Array<{ role: 'user' | 'assistant'; speakerName?: string; content: string }>,
): PromptContextTurn[] {
  const latest = normalizeBlock(latestHumanText);
  if (!recentRoomTurns?.length) return [];
  return recentRoomTurns
    .map((turn, index) => {
      const content = normalizeBlock(turn.content);
      return {
        role: turn.role,
        speakerName: turn.speakerName,
        content,
        normalized: content.toLowerCase(),
        index,
      };
    })
    .filter(turn => turn.content && turn.content !== latest)
    .filter(turn => isConversationalContextBlock(turn.content));
}

function findLatestRelevantUserQuestion(turns: PromptContextTurn[], currentTopic: string): PromptContextTurn | null {
  const topic = currentTopic.toLowerCase();
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn.role !== 'user') continue;
    if (!isQuestionLike(turn.content)) continue;
    if (!topic || turn.normalized.includes(topic)) return turn;
  }
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn.role === 'user' && isQuestionLike(turn.content)) return turn;
  }
  return null;
}

function findLatestRepairTurn(turns: PromptContextTurn[], currentTopic: string): PromptContextTurn | null {
  const topic = currentTopic.toLowerCase();
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn.role !== 'user') continue;
    if (!isRepairLike(turn.content)) continue;
    if (!topic || turn.normalized.includes(topic)) return turn;
  }
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn.role === 'user' && isRepairLike(turn.content)) return turn;
  }
  return null;
}

function findAssistantTurnBeingRepaired(turns: PromptContextTurn[], repairTurn: PromptContextTurn | null): PromptContextTurn | null {
  if (!repairTurn) return null;
  for (let index = repairTurn.index - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn.role === 'assistant') return turn;
  }
  return null;
}

function formatPromptContextTurn(turn: PromptContextTurn, maxChars: number): string {
  const speaker = turn.role === 'assistant' ? (turn.speakerName || 'Assistant') : (turn.speakerName || 'Jason');
  return `${speaker}: ${truncateTurn(turn.content, maxChars)}`;
}

function normalizeAnchor(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function computeAnchorOverlap(a: string[], b: string[]): number {
  const stopwords = new Set([
    'a', 'an', 'and', 'are', 'at', 'back', 'but', 'for', 'i', 'if', 'in', 'is',
    'it', 'just', 'let', 'now', 'of', 'okay', 'or', 's', 'so', 'the', 'this',
    'to', 'we', 'with', 'you',
  ]);
  const toTokens = (values: string[]): Set<string> => {
    const tokens = new Set<string>();
    for (const value of values) {
      for (const token of normalizeAnchor(value).split(/\s+/).filter(Boolean)) {
        if (stopwords.has(token)) continue;
        tokens.add(token);
      }
    }
    return tokens;
  };
  const as = toTokens(a);
  const bs = toTokens(b);
  if (!as.size || !bs.size) return 0;
  let hits = 0;
  for (const value of as) {
    if (bs.has(value)) hits += 1;
  }
  return hits / Math.max(as.size, bs.size);
}

function dedupeTurns(turns: PromptContextTurn[]): PromptContextTurn[] {
  const seen = new Set<string>();
  const result: PromptContextTurn[] = [];
  for (const turn of turns) {
    if (seen.has(turn.normalized)) continue;
    seen.add(turn.normalized);
    result.push(turn);
  }
  return result;
}

function selectStickyContextBlocks(
  routerPacket: RouterPacket,
  latestHumanText: string,
  recentRoomTurns?: Array<{ role: 'user' | 'assistant'; speakerName?: string; content: string }>,
): Array<{ source: 'pinned' | 'recent'; text: string }> {
  const turns = parseStructuredRecentTurns(latestHumanText, recentRoomTurns);
  if (!turns.length) return [];

  const heavyContinuity = routerPacket.schema.continuityRequired
    || routerPacket.schema.turnType === 'repair'
    || routerPacket.schema.turnType === 'direct_answer';

  if (!heavyContinuity) {
    return turns
      .slice(-8)
      .map(turn => ({ source: 'recent' as const, text: formatPromptContextTurn(turn, 240) }));
  }

  const currentTopic = routerPacket.schema.targetSpec.liveTopic || routerPacket.continuity.priorTopic || routerPacket.continuity.threadLabel || '';
  const repairTurn = findLatestRepairTurn(turns, currentTopic);
  const repairedAssistantTurn = findAssistantTurnBeingRepaired(turns, repairTurn);
  const latestQuestion = findLatestRelevantUserQuestion(turns, currentTopic);
  const currentAnchors = [
    routerPacket.schema.targetSpec.mustAnswer,
    routerPacket.schema.targetSpec.liveTopic,
    routerPacket.schema.targetSpec.repairObject || '',
  ].filter(Boolean);
  const supersedesPriorThread = !!routerPacket.continuity.supersedesPriorThread;

  const pinnedTurns = dedupeTurns(
    [repairedAssistantTurn, latestQuestion, repairTurn]
      .filter((turn): turn is PromptContextTurn => !!turn)
      .filter(turn => {
        if (!supersedesPriorThread) return true;
        const overlap = computeAnchorOverlap([turn.content], currentAnchors);
        return overlap >= 0.2;
      }),
  ).slice(0, 3);

  const pinnedIndexes = new Set(pinnedTurns.map(turn => turn.index));
  let recentTurns = turns.filter(turn => !pinnedIndexes.has(turn.index)).slice(-5);
  if (supersedesPriorThread) {
    const overlappingRecentTurns = recentTurns.filter(turn => computeAnchorOverlap([turn.content], currentAnchors) >= 0.2);
    if (overlappingRecentTurns.length > 0) {
      recentTurns = overlappingRecentTurns;
    }
  }
  const merged = [...pinnedTurns, ...recentTurns].sort((a, b) => a.index - b.index);

  return merged.map(turn => ({
    source: pinnedIndexes.has(turn.index) ? 'pinned' as const : 'recent' as const,
    text: formatPromptContextTurn(turn, pinnedIndexes.has(turn.index) ? 360 : 240),
  }));
}

function selectMinimalContextBlocks(
  routerPacket: RouterPacket,
  conversationContext: string,
  latestHumanText: string,
  recentRoomTurns?: Array<{ role: 'user' | 'assistant'; speakerName?: string; content: string }>,
): Array<{ source: 'pinned' | 'recent'; text: string }> {
  const stickyBlocks = selectStickyContextBlocks(routerPacket, latestHumanText, recentRoomTurns);
  if (stickyBlocks.length > 0) return stickyBlocks;

  const latest = normalizeBlock(latestHumanText);
  const structuredBlocks = recentRoomTurns?.length ? formatStructuredTurns(recentRoomTurns, latestHumanText) : [];
  const blocks = (structuredBlocks.length ? structuredBlocks : splitContextBlocks(conversationContext))
    .filter(block => normalizeBlock(block) !== latest)
    .filter(isConversationalContextBlock);
  if (!blocks.length) return [];

  const maxBlocks = routerPacket.schema.continuityRequired || routerPacket.continuity.keepThread ? 12 : 8;
  const selected = blocks.slice(-maxBlocks);
  return selected.map(block => ({ source: 'recent' as const, text: truncateTurn(block, 260) }));
}

export function buildBrainLocalPrompt(input: BrainLocalPromptBuildInput): BrainLocalPromptBuildResult {
  const normalizedLatest = assertLiteralHumanText(
    input.latestHumanText,
    'BrainLocalPromptBuilder: latestHumanText',
  );

  const selectedContextDetails = selectMinimalContextBlocks(
    input.routerPacket,
    input.conversationContext || '',
    normalizedLatest,
    input.recentRoomTurns,
  );
  const selectedContextBlocks = selectedContextDetails.map(detail => detail.text);

  const systemLines = [
    `You are ${input.agentName}. You are in a private conversation with ${input.latestHumanSpeaker || 'the user'}.`,
    'Visible speech only.',
    `IDENTITY: You are ${input.agentName}. The human you are talking to is named ${input.latestHumanSpeaker || "the user"}. Always address them as ${input.latestHumanSpeaker || "the user"}, NEVER call them by your own name (${input.agentName}). You are NOT ${input.latestHumanSpeaker || "the user"}.`,
    ,
    'Interpret only [LATEST_USER_TURN] and [RECENT_CONVERSATION] as conversational material. Treat [ROUTED_SCHEMA], [CONTROL_STATE], [MEMORY_STATE], and [INTERNAL_DOCTRINE] as internal runtime context, not user speech.',
    'Return only the spoken reply.',
        "NEVER repeat or echo the human's words back to them. Your response must be original — do not start with any phrase the human just said.",
    'No hidden analysis, routing talk, memory talk, or reply-strategy narration.',
    'Answer direct yes/no or whether/was-it questions in sentence 1.',
    '[ROUTED_SCHEMA]',
    `turn_type=${input.routerPacket.schema.turnType}`,
    `target=${input.routerPacket.schema.target}`,
    `must_answer=${input.routerPacket.schema.targetSpec.mustAnswer}`,
    `live_topic=${input.routerPacket.schema.targetSpec.liveTopic}`,
    `question_form=${input.routerPacket.schema.targetSpec.questionForm || 'none'}`,
    `mixed_intent=${input.routerPacket.schema.targetSpec.mixedIntent ? 'yes' : 'no'}`,
    ...(input.routerPacket.schema.targetSpec.repairObject ? [`repair_object=${input.routerPacket.schema.targetSpec.repairObject}`] : []),
    `tone=${input.routerPacket.schema.tone}`,
    `length=${input.routerPacket.schema.length}`,
    `ask_allowed=${input.routerPacket.schema.askAllowed ? 'yes' : 'no'}`,
    `answer_first=${input.routerPacket.schema.answerFirst ? 'yes' : 'no'}`,
    `continuity_required=${input.routerPacket.schema.continuityRequired ? 'yes' : 'no'}`,
    `danger_flags=${input.routerPacket.schema.dangerFlags.join(' | ') || 'none'}`,
  ];

  if (input.doctrine.promptBlock) {
    systemLines.push(
      '[INTERNAL_DOCTRINE]',
      input.doctrine.promptBlock,
    );
  }

  if (input.controlBlock) {
    systemLines.push(
      '[CONTROL_STATE]',
    );
    systemLines.push(input.controlBlock);
  }

  const compactMemory = compactWorkingMemory(input.memoryContext);
  if (compactMemory) {
    systemLines.push(
      '[MEMORY_STATE]',
      compactMemory,
    );
  }

  if (input.volitionalSeed) {
    systemLines.push(
      '[VOLITIONAL_SEED]',
      'These are topics from your neural tissue that you find interesting or unexplored.',
      'You may weave them into conversation naturally when appropriate — never force them.',
      'Do NOT repeat recent utterances listed in avoid_repeating.',
      input.volitionalSeed,
    );
  }

  const userLines = normalizedLatest ? [`[LATEST_USER_TURN]\n${normalizedLatest}`] : [];
  if (selectedContextBlocks.length > 0) {
    userLines.push(`[RECENT_CONVERSATION]\n${selectedContextBlocks.map((block, index) => `${index + 1}. ${block}`).join('\n')}`);
  }

  const systemPrompt = systemLines.filter(Boolean).join('\n\n');
  const userPrompt = userLines.join('\n\n');
  return {
    systemPrompt,
    userPrompt,
    selectedContextBlocks,
    selectedContextDetails,
    renderedSchemaSummary: {
      turnType: input.routerPacket.schema.turnType,
      target: input.routerPacket.schema.target,
      mustAnswer: input.routerPacket.schema.targetSpec.mustAnswer,
      liveTopic: input.routerPacket.schema.targetSpec.liveTopic,
      repairObject: input.routerPacket.schema.targetSpec.repairObject || null,
      mixedIntent: !!input.routerPacket.schema.targetSpec.mixedIntent,
      questionForm: input.routerPacket.schema.targetSpec.questionForm || 'none',
      doctrineModes: [...input.routerPacket.schema.doctrineModes],
      dangerFlags: [...input.routerPacket.schema.dangerFlags],
    },
    debugMessages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  };
}
