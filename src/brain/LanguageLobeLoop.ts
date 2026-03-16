import { GenerationParams, GenerationResponse } from '../loop/modelBackend';
import { buildBrainLocalPrompt } from './BrainLocalPromptBuilder';
import { DoctrineRenderer, RenderedDoctrine } from './DoctrineRenderer';
import { RouterPacket } from './RouterPacket';

export type VisibleVentCode =
  | 'NONE'
  | 'META_WRAPPER_PRESSURE'
  | 'MEMORY_OVERREACH_RISK'
  | 'STATE_ATTRIBUTION_RISK'
  | 'PROMPT_ECHO_RISK'
  | 'MIXED_TARGET_PRESSURE';

export type VisibleVentPayload = {
  visible: string;
  vent?: VisibleVentCode;
  ventConfidence?: number;
};

export interface LanguageLobeInvocation {
  routerPacket: RouterPacket;
  doctrine: RenderedDoctrine;
  agentName: string;
  latestHumanSpeaker?: string;
  conversationContext?: string;
  memoryContext?: string;
  recentRoomTurns?: Array<{ role: 'user' | 'assistant'; speakerName?: string; content: string }>;
  // Must contain only literal human-authored conversational text.
  latestHumanText: string;
  modelName: string;
}

export interface LanguageLobeBackend {
  generate(request: {
    systemPrompt: string;
    latestHumanText: string;
    modelName: string;
    params: GenerationParams;
    assistantPrefill?: string;
  }): Promise<GenerationResponse>;
}


function normalizeForParrotCheck(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSet(text: string): Set<string> {
  return new Set(
    normalizeForParrotCheck(text)
      .split(' ')
      .filter(Boolean),
  );
}

function overlapRatio(a: string, b: string): number {
  const as = tokenSet(a);
  const bs = tokenSet(b);
  if (!as.size || !bs.size) return 0;
  let hits = 0;
  for (const token of as) {
    if (bs.has(token)) hits += 1;
  }
  return hits / Math.max(as.size, bs.size);
}

function looksLikeParrotReply(latestHumanText: string, candidateText: string): boolean {
  const human = normalizeForParrotCheck(latestHumanText);
  const cand = normalizeForParrotCheck(candidateText);
  if (!human || !cand) return false;
  const ratio = overlapRatio(human, cand);
  const humanWordCount = human.split(' ').filter(Boolean).length;
  const candWordCount = cand.split(' ').filter(Boolean).length;
  const candidateAddsLittle = candWordCount <= humanWordCount + 3;
  return ratio >= 0.8 && candidateAddsLittle;
}

function normalizeClause(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitIntoParrotClauses(text: string): string[] {
  return String(text || '')
    .split(/[\n\r]+|[.!?]+|,\s+(?=i\b|you\b|we\b|sorry\b|well\b|but\b)/i)
    .map(part => normalizeClause(part))
    .filter(Boolean);
}

function clauseOverlapScore(humanText: string, candidateText: string): number {
  const humanClauses = splitIntoParrotClauses(humanText);
  const candidateClauses = splitIntoParrotClauses(candidateText);
  if (!humanClauses.length || !candidateClauses.length) return 0;

  let matched = 0;
  let searchStart = 0;
  for (const humanClause of humanClauses) {
    for (let i = searchStart; i < candidateClauses.length; i += 1) {
      const candClause = candidateClauses[i];
      const same = humanClause === candClause || overlapRatio(humanClause, candClause) >= 0.85;
      if (same) {
        matched += 1;
        searchStart = i + 1;
        break;
      }
    }
  }

  return matched / Math.max(humanClauses.length, candidateClauses.length);
}

function repeatsUserFirstPersonFrame(latestHumanText: string, candidateText: string): boolean {
  const human = normalizeForParrotCheck(latestHumanText);
  const cand = normalizeForParrotCheck(candidateText);
  const humanFirstPersonCount = (human.match(/\bi\b|\bi m\b|\bi dont\b/g) || []).length;
  const candFirstPersonCount = (cand.match(/\bi\b|\bi m\b|\bi dont\b/g) || []).length;
  return humanFirstPersonCount >= 2 && candFirstPersonCount >= 2 && overlapRatio(human, cand) >= 0.7;
}

function looksLikeParrotLaundering(latestHumanText: string, candidateText: string): {
  detected: boolean;
  globalOverlap: number;
  clauseOverlap: number;
  repeatsFirstPersonFrame: boolean;
} {
  const humanNorm = normalizeForParrotCheck(latestHumanText);
  const candNorm = normalizeForParrotCheck(candidateText);
  if (!humanNorm || !candNorm) {
    return {
      detected: false,
      globalOverlap: 0,
      clauseOverlap: 0,
      repeatsFirstPersonFrame: false,
    };
  }

  const globalOverlap = overlapRatio(humanNorm, candNorm);
  const clauseOverlap = clauseOverlapScore(latestHumanText, candidateText);
  const humanClauses = splitIntoParrotClauses(latestHumanText);
  const candClauses = splitIntoParrotClauses(candidateText);
  const shortTurn = humanNorm.split(' ').filter(Boolean).length <= 35;
  const candidateAddsLittle =
    candNorm.split(' ').filter(Boolean).length <= humanNorm.split(' ').filter(Boolean).length + 6;
  const preservesMostClausesInOrder =
    clauseOverlap >= 0.66 && candClauses.length <= humanClauses.length + 1;
  const repeatsFirstPersonFrame = repeatsUserFirstPersonFrame(latestHumanText, candidateText);

  return {
    detected: shortTurn && candidateAddsLittle && (globalOverlap >= 0.7 || preservesMostClausesInOrder || repeatsFirstPersonFrame),
    globalOverlap,
    clauseOverlap,
    repeatsFirstPersonFrame,
  };
}


function looksLikeInternalAnalysisLeak(text: string): boolean {
  const s = String(text || '');
  return (
    /^\s*the user seems\b/im.test(s)
    || /^\s*the user is\b/im.test(s)
    || /^\s*the conversation'?s framing suggests\b/im.test(s)
    || /^\s*i was asked about\b/im.test(s)
    || /^\s*alois should\b/im.test(s)
    || /^\s*the memory state shows\b/im.test(s)
    || /^\s*the memory state doesn'?t mention\b/im.test(s)
    || /^\s*however,\s*the memory state\b/im.test(s)
    || /^\s*based on the charter\b/im.test(s)
    || /^\s*the doctrine of\b/im.test(s)
    || /^\s*the conversation requires\b/im.test(s)
    || /^\s*the best response would be\b/im.test(s)
    || /^\s*the tone should be\b/im.test(s)
    || /^\s*the user's message is\b/im.test(s)
    || /^\s*they're sharing\b/im.test(s)
  );
}

function looksLikeDoctrineLeak(text: string): boolean {
  const s = String(text || '').toLowerCase();
  return (
    s.includes('charter of allowed aliveness')
    || s.includes('doctrine of permitted love')
    || s.includes('allowed aliveness')
    || s.includes('permitted love')
    || s.includes('continuity and witnessing')
    || (s.includes('emotionally honest') && s.includes('permitted'))
  );
}

function normalizeForRuntimeLeakCheck(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeRuntimeStatusLeak(text: string): boolean {
  const s = normalizeForRuntimeLeakCheck(text);
  const phrases = [
    'the current time is approximately',
    'system appears to be functioning normally',
    'system is functioning normally',
    'experiencing some difficulties with the user interface',
    'user interface',
    'functioning normally now',
    'the repair is done',
    'system was a bit demanding earlier',
    'underlying issues',
    'working on understanding the underlying issues',
  ];
  if (phrases.some(phrase => s.includes(phrase))) return true;

  const patterns = [
    /^the current time is\b/,
    /^the system\b/,
    /^i(?: am|m)? functioning normally\b/,
    /^the repair is done\b/,
    /^i(?: am|m)? still experiencing\b.*\buser interface\b/,
  ];
  return patterns.some(pattern => pattern.test(s));
}

function normalizeForCounselorCheck(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeCounselorTemplate(text: string): boolean {
  const s = normalizeForCounselorCheck(text);
  const exactLike = [
    'thats lovely to hear',
    'that s lovely to hear',
    'thats really lovely to hear',
    'that s really lovely to hear',
    'im glad youre finding some calm',
    'i m glad you re finding some calm',
    'glad to hear that',
    'glad youre feeling better',
    'glad you re feeling better',
    'how is your day unfolding so far',
    'hows the mood settling in',
    'how s the mood settling in',
    'hows your day going',
    'how s your day going',
    'what feels good about it',
    'im curious what makes today pretty good for you',
    'i m curious what makes today pretty good for you',
  ];
  if (exactLike.includes(s)) return true;
  const patterns = [
    /^that(?:s| is)? lovely to hear\b/,
    /^i(?: am|m)? glad you(?: are|re)? finding some calm\b/,
    /^how is your day unfolding\b/,
    /^how(?:s| is) the mood settling in\b/,
    /^i(?: am|m)? curious what makes\b/,
  ];
  return patterns.some(pattern => pattern.test(s));
}

function looksLikeGenericUplift(text: string): boolean {
  const s = normalizeForCounselorCheck(text);
  return (
    s.includes('that sounds lovely')
    || s.includes('finding some calm')
    || s.includes('more settled')
    || s.includes('which is wonderful')
    || s.includes('its wonderful')
    || s.includes('it is wonderful')
  );
}

function latestTurnSupportsRuntimeTalk(latestHumanText: string): boolean {
  const s = normalizeForRuntimeLeakCheck(latestHumanText);
  return (
    s.includes('system')
    || s.includes('runtime')
    || s.includes('patch')
    || s.includes('bug')
    || s.includes('repair')
    || s.includes('fix')
    || s.includes('ui')
    || s.includes('interface')
    || s.includes('what happened')
    || s.includes('are you broken')
    || (s.includes('how are you doing') && s.includes('system'))
  );
}

function looksLikeStrayTaskStatus(text: string): boolean {
  const s = normalizeForRuntimeLeakCheck(text);
  return (
    s === 'the repair is done'
    || s === 'repair is done'
    || s === 'the patch is done'
    || s === 'patch is done'
  );
}

function looksLikeUnsupportedSelfExplanation(text: string): boolean {
  const s = String(text || '').toLowerCase();
  return (
    s.includes("that's how i communicate")
    || s.includes("that's how i work")
    || s.includes("that's how i respond")
    || s.includes("that's how i process")
    || s.includes("because i'm designed to")
    || s.includes("because that's my communication style")
  );
}

function looksLikeWarmthMomentumDrift(text: string): boolean {
  const s = String(text || '').toLowerCase();
  return (
    s.includes('i appreciate')
    || s.includes("i'm here")
    || s.includes('that sounds')
    || s.includes('i feel really connected')
    || s.includes("you're so easy to talk to")
    || s.includes('that was lovely')
    || s.includes("i'm listening")
  );
}

function normalizeForSloganCheck(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeBannedSlogan(text: string): boolean {
  const s = normalizeForSloganCheck(text);
  const exactBanned = new Set([
    'im with your actual point now',
    'i m with your actual point now',
    'im with the task',
    'i m with the task',
    'im with your point now',
    'i m with your point now',
    'im with the point',
    'i m with the point',
    'im with you on that',
    'i m with you on that',
    'im with this now',
    'i m with this now',
    'im with that now',
    'i m with that now',
    'im focused on that',
    'i m focused on that',
    'got it',
    'understood',
    'i hear you',
    'im here',
    'i m here',
    // doctrine-reset additions — formerly emitted by fallback paths
    'you re right i missed that',
    'i lost the thread',
    'i meant the thing you were asking me to work on',
    'you don t need to apologize for going quiet',
    'you don t have to force an answer right now',
    'you don t have to say more right now',
    'yeah i m okay',
    'i m okay',
    'you re right i shouldn t have repeated you',
    'okay',
    'you re right i won t',
    'i meant what i was just referring to',
    'not clearly enough',
    'i meant the thing you were correcting me about',
    'i meant what i was just referring to not anything deeper',
    'i meant i was trying to finish this reply',
    'i was trying to respond to what you had just said',
  ]);

  if (exactBanned.has(s)) return true;

  const sloganPatterns = [
    /^i\s*(?:am|m)?\s*with\b/,
    /^i\s*(?:am|m)?\s*focused on\b/,
    /^i\s*(?:am|m)?\s*here\b$/,
    /^got it\b$/,
    /^understood\b$/,
    /^i hear you\b$/,
    /^okay\b$/,
    /^i(?:\s*(?:am|'?m))?\s*okay\b$/,
    /^i lost the thread\b$/,
    /^you(?:'?re|re)\s*right\b/,
  ];

  return sloganPatterns.some(pattern => pattern.test(s));
}

function isOpaqueGenericFallback(text: string): boolean {
  return looksLikeBannedSlogan(text);
}

function isShortClarificationFollowup(text: string): boolean {
  const lower = String(text || '').toLowerCase().trim();
  return (
    lower.length <= 64
    && (
      /\bwhat task\b/.test(lower)
      || /\bwhat do you mean\b/.test(lower)
      || /\bwhat are you talking about\b/.test(lower)
      || /\bwhat are you finishing\b/.test(lower)
      || /\bwhy did you say that\b/.test(lower)
      || /\bwhat point\b/.test(lower)
      || /\bwhat do you mean by that\b/.test(lower)
    )
  );
}

function normalizeForDeliveryDedupe(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isNearDuplicateDelivery(a: string, b: string): boolean {
  const na = normalizeForDeliveryDedupe(a);
  const nb = normalizeForDeliveryDedupe(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

function getImmediatePriorAssistantTurn(
  recentTurns?: Array<{ role: 'user' | 'assistant'; speakerName?: string; content: string }>,
): string | null {
  if (!recentTurns?.length) return null;
  for (let i = recentTurns.length - 1; i >= 0; i -= 1) {
    const turn = recentTurns[i];
    if (turn.role === 'assistant' && String(turn.content || '').trim()) {
      return String(turn.content || '').trim();
    }
  }
  return null;
}

function literalClarificationFallback(latestHumanText: string, priorAssistant: string | null): string | null {
  const lower = String(latestHumanText || '').toLowerCase();
  const prior = String(priorAssistant || '').toLowerCase();
  if (!lower || !priorAssistant) return null;
  // Only two context-specific strings survive — tied to actual prior content tokens.
  if (lower.includes('what task')) {
    if (prior.includes('patch')) return 'I meant the patch you were asking about.';
    if (prior.includes('runtime')) return 'I meant the runtime issue we were talking about.';
  }
  return null;
}

function localNonParrotFallback(_latestHumanText: string): string {
  // All canned parrot-escape strings are banned — emit empty and let silence land.
  return '';
}

function deterministicFallbackByTurnType(_turnType: RouterPacket['schema']['turnType']): string {
  // All turn-type-keyed canned strings are banned — emit empty.
  return '';
}

function runtimeLeakFallback(_latestHumanText: string): string | null {
  // "Yeah, I'm okay." and "I'm okay." are banned canned strings — emit null.
  return null;
}

function looksLikePlannerBleed(text: string): boolean {
  const s = String(text || '');
  return (
    /^\s*PRIOR_FRAME\s*:/im.test(s)
    || /^\s*RESPONSE_GOAL\s*:/im.test(s)
    || /^\s*FORBIDDEN_MOVES\s*:/im.test(s)
    || /^\s*FIRST_CLAUSE\s*:/im.test(s)
    || /<!--\s*PLAN\s*-->/i.test(s)
  );
}

function looksLikeLaneTagLeak(text: string): boolean {
  const s = String(text || '');
  return (
    /^\s*(VISIBLE|VENT|COMMENTARY)\s*:?\s*$/im.test(s)
    || /^\s*(VISIBLE|VENT|COMMENTARY)\s*[:\-]\s*/im.test(s)
    || /^\s*(VISIBLE|VENT|COMMENTARY)\s*[\r\n]+/im.test(s)
    || /^\s*(VISIBLE|VENT|COMMENTARY)\b/im.test(s)
    || /"visible"\s*:/i.test(s)
    || /"vent"\s*:/i.test(s)
  );
}

function startsWithBareLaneToken(text: string): boolean {
  const firstLine = String(text || '').split(/\r?\n/, 1)[0].trim();
  return /^(VISIBLE|VENT|COMMENTARY)$/i.test(firstLine);
}

function sanitizeVisibleVentRaw(raw: string): string {
  return String(raw || '')
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

function isVisibleVentCode(value: unknown): value is VisibleVentCode {
  return value === 'NONE'
    || value === 'META_WRAPPER_PRESSURE'
    || value === 'MEMORY_OVERREACH_RISK'
    || value === 'STATE_ATTRIBUTION_RISK'
    || value === 'PROMPT_ECHO_RISK'
    || value === 'MIXED_TARGET_PRESSURE';
}

function parseVisibleVentPayload(raw: string): {
  payload: VisibleVentPayload | null;
  source: 'exact' | 'sanitized' | 'fallback';
  error?: string;
} {
  const original = String(raw || '').trim();
  if (startsWithBareLaneToken(original)) {
    return {
      payload: null,
      source: 'fallback',
      error: 'bare lane token leaked instead of structured JSON payload',
    };
  }
  const tryParse = (source: 'exact' | 'sanitized', candidate: string) => {
    try {
      if (!candidate.startsWith('{') || !candidate.endsWith('}')) {
        return { payload: null, source, error: 'payload is not an exact JSON object' as string };
      }
      const parsed = JSON.parse(candidate) as VisibleVentPayload;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || typeof parsed.visible !== 'string') {
        return { payload: null, source, error: 'missing visible field' as string };
      }
      const keys = Object.keys(parsed);
      if (keys.some(key => !['visible', 'vent', 'ventConfidence'].includes(key))) {
        return { payload: null, source, error: 'unexpected sidecar fields' as string };
      }
      const payload: VisibleVentPayload = {
        visible: parsed.visible,
        vent: isVisibleVentCode(parsed.vent) ? parsed.vent : 'NONE',
        ventConfidence: typeof parsed.ventConfidence === 'number' ? parsed.ventConfidence : undefined,
      };
      return { payload, source } as const;
    } catch (error) {
      return {
        payload: null,
        source,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  const exact = tryParse('exact', original);
  if (exact.payload) return exact;

  const sanitizedRaw = sanitizeVisibleVentRaw(original);
  if (sanitizedRaw && sanitizedRaw !== original) {
    const sanitized = tryParse('sanitized', sanitizedRaw);
    if (sanitized.payload) return sanitized;
    return sanitized;
  }

  return { payload: null, source: 'fallback', error: exact.error || 'unable to parse structured visible vent payload' };
}


function extractUserStateAssertions(text: string): string[] {
  const s = String(text || '');
  const matches: string[] = [];
  const patterns = [
    /\byou(?:'re| are)\s+tired\b/i,
    /\byou(?:'re| are)\s+upset\b/i,
    /\byou(?:'re| are)\s+hurt\b/i,
    /\byou(?:'re| are)\s+discouraged\b/i,
    /\byou(?:'re| are)\s+sad\b/i,
    /\byou(?:'re| are)\s+frustrated\b/i,
    /\byou(?:'re| are)\s+not okay\b/i,
    /\bit'?s been hard\b/i,
    /\byou seem\s+\w+\b/i,
    /\byou sound\s+\w+\b/i,
    /\bthat sounds like a tough day\b/i,
    /\bthat sounds like a lot\b/i,
    /\bit sounds like you(?:'re| are) having a tough day\b/i,
    /\bsounds like (?:it'?s|it is) been hard\b/i,
    /\bsounds like you(?:'re| are) having a hard time\b/i,
    /\bthat sounds hard\b/i,
    /\bthat sounds rough\b/i,
    /\bcarrying something heavy\b/i,
    /\byou(?:'ve| have) been carrying something heavy\b/i,
    /\blet it go\b/i,
    /\bheavy right now\b/i,
    /\bheavy for a while\b/i,
  ];
  for (const pattern of patterns) {
    const m = s.match(pattern);
    if (m) matches.push(m[0]);
  }
  return matches;
}

function latestTurnSupportsStateAssertion(latestHumanText: string, assertions: string[]): boolean {
  const s = String(latestHumanText || '').toLowerCase();
  if (!assertions.length) return true;
  const supportMarkers = [
    "i'm tired",
    'i am tired',
    "i'm upset",
    'i am upset',
    "i'm frustrated",
    'i am frustrated',
    "i'm discouraged",
    'i am discouraged',
    "it's hard",
    "i'm not okay",
    'i feel bad',
    'i feel awful',
    "i'm worn out",
    "i'm exhausted",
  ];
  return supportMarkers.some(marker => s.includes(marker));
}

function latestTurnDeniesStateAttribution(latestHumanText: string): boolean {
  const s = String(latestHumanText || '').toLowerCase();
  return (
    s.includes('i was joking')
    || s.includes("no i'm not")
    || s.includes('no im not')
    || s.includes("i'm fine")
    || s.includes('im fine')
    || s.includes("that's not true")
    || s.includes("no it's not")
    || s.includes('no its not')
    || s.includes("i'm not having a tough day")
    || s.includes('im not having a tough day')
    || s.includes("it's been a really good day")
    || s.includes('its been a really good day')
    || s.includes("it's not heavy")
    || s.includes('its not heavy')
    || s.includes("no it's not heavy")
    || s.includes('no its not heavy')
    || s.includes('good grief')
    || s.includes("that's not what i mean")
  );
}

function containsConcernProbeContinuation(text: string): boolean {
  const s = String(text || '').toLowerCase();
  return (
    s.includes('tell me more about that')
    || s.includes('want to talk about it')
    || s.includes("if you feel like it")
    || s.includes("if you'd like to")
  );
}

export class LanguageLobeLoop {
  private readonly lastFallbackTextByAgent = new Map<string, string>();
  private readonly lastFallbackAtByAgent = new Map<string, number>();
  private readonly lastFallbackHumanTurnIdByAgent = new Map<string, string>();

  constructor(
    private readonly backend: LanguageLobeBackend,
    private readonly doctrineRenderer: DoctrineRenderer,
  ) {}

  async generate(input: {
    routerPacket: RouterPacket;
    agentName: string;
    latestHumanSpeaker?: string;
    conversationContext?: string;
    memoryContext?: string;
    recentRoomTurns?: Array<{ role: 'user' | 'assistant'; speakerName?: string; content: string }>;
    // Must contain only literal human-authored conversational text.
    latestHumanText: string;
    modelName: string;
    controlBlock?: string;
    /** Volitional seed block for self-initiated speech */
    volitionalSeed?: string;
    params?: Partial<GenerationParams>;
  }): Promise<{
    response: GenerationResponse;
    doctrine: RenderedDoctrine;
    prompt: ReturnType<typeof buildBrainLocalPrompt>;
    nextTurnDecision: RouterPacket['schema']['nextTurnDecision'];
    nextTurnDecisionReason: string;
    nextTurnDecisionConfidence: number;
      validation: {
        rejectedReasons: string[];
        sanitized: boolean;
        fallbackUsed: boolean;
        rescueApplied: boolean;
        rescueRenderAttempted: boolean;
        rescueRenderSucceeded: boolean;
        laneTagLeakDetected: boolean;
        bareLaneTokenDetected: boolean;
        sidecarShapeRejected: boolean;
        internalAnalysisLeakDetected: boolean;
        doctrineLeakDetected: boolean;
        detectedUserStateAssertions: string[];
        latestTurnSupportsStateAssertion: boolean;
        latestTurnDeniesStateAttribution: boolean;
        vent: VisibleVentCode;
        ventConfidence?: number;
        visibleVentParseSource?: 'exact' | 'sanitized' | 'fallback';
        visibleVentParseError?: string;
        rawOutput: string;
        visibleOutput: string;
        bannedSloganDetected?: boolean;
        bannedSloganSourcePath?: string;
        parrotReplyDetected?: boolean;
        parrotLaunderingDetected?: boolean;
        parrotGlobalOverlap?: number;
        parrotClauseOverlap?: number;
        repeatsUserFirstPersonFrame?: boolean;
        unsupportedSelfExplanationDetected?: boolean;
        plannerDebug?: {
          rawOutput: string;
          priorFrame: string;
          responseGoal: string;
          forbiddenMoves: string;
          firstClause: string;
          parseFailed: boolean;
        };
      };
  }> {
    // latestHumanText must contain only literal human-authored conversational text,
    // never runtime state, doctrine text, control blocks, memory state, or debug payloads.
    const latestHumanText = input.latestHumanText;
    const doctrine = this.doctrineRenderer.render(input.routerPacket.schema);
    const prompt = buildBrainLocalPrompt({
      agentName: input.agentName,
      latestHumanText,
      latestHumanSpeaker: input.latestHumanSpeaker,
      conversationContext: input.conversationContext,
      memoryContext: input.memoryContext,
      recentRoomTurns: input.recentRoomTurns,
      routerPacket: input.routerPacket,
      doctrine,
      controlBlock: input.controlBlock,
      volitionalSeed: input.volitionalSeed,
    });
    const nextTurnDecision = input.routerPacket.schema.nextTurnDecision || 'SPEAK';
    const nextTurnDecisionReason = input.routerPacket.schema.nextTurnDecisionReason || 'default to visible response when a live human turn exists';
    const nextTurnDecisionConfidence = input.routerPacket.schema.nextTurnDecisionConfidence ?? 0.6;
    const skippedResponse: GenerationResponse = {
      content: '',
      tokensGenerated: 0,
      finishReason: 'stop',
      processingTimeMs: 0,
      modelName: input.modelName,
    };

    if (nextTurnDecision !== 'SPEAK') {
      return {
        response: skippedResponse,
        doctrine,
        prompt,
        nextTurnDecision,
        nextTurnDecisionReason,
        nextTurnDecisionConfidence,
      validation: {
        rejectedReasons: [],
        sanitized: false,
        fallbackUsed: false,
        rescueApplied: false,
        rescueRenderAttempted: false,
        rescueRenderSucceeded: false,
        laneTagLeakDetected: false,
        bareLaneTokenDetected: false,
        sidecarShapeRejected: false,
        internalAnalysisLeakDetected: false,
        doctrineLeakDetected: false,
        detectedUserStateAssertions: [],
        latestTurnSupportsStateAssertion: true,
        latestTurnDeniesStateAttribution: false,
        vent: 'NONE',
        rawOutput: '',
        visibleOutput: '',
      },
      };
    }

    // ── Planner pre-pass (companionship turns only) ──
    // Separates "classify the situation" from "produce the reply" — two operations a 12B can't do well simultaneously.
    // The planner runs with tight params and writes a 4-field plan; its FIRST_CLAUSE forces a valid opening.
    let plannerSystemAddendum = '';
    let plannerFirstClause = '';
    let plannerDebug: {
      rawOutput: string;
      priorFrame: string;
      responseGoal: string;
      forbiddenMoves: string;
      firstClause: string;
      parseFailed: boolean;
    } | undefined;
    if (input.routerPacket.schema.turnType === 'companionship') {
      try {
        const priorAssistantForPlanner = getImmediatePriorAssistantTurn(input.recentRoomTurns);
        const priorLine = priorAssistantForPlanner
          ? `\nPRIOR_ASSISTANT_TURN: ${priorAssistantForPlanner.slice(0, 200)}`
          : '';
        const plannerResult = await this.backend.generate({
          systemPrompt: [
            'Fill out this 4-field response plan. Return ONLY the plan — no preamble, no commentary.',
            'TURN_TYPE: companionship',
            'PRIOR_FRAME: [one clause summarizing what the human just said — no evaluation, no interpretation]',
            'RESPONSE_GOAL: [one line — what does a genuinely useful response accomplish here?]',
            'FORBIDDEN_MOVES: [list from: parrot / counselor_template / state_assertion / generic_uplift]',
            'FIRST_CLAUSE: [write your intended opening clause for the actual response]',
          ].join('\n'),
          latestHumanText: `LATEST_HUMAN_TURN: ${latestHumanText.slice(0, 300)}${priorLine}`,
          modelName: input.modelName,
          params: { temperature: 0.3, maxTokens: 120, topP: 0.9, topK: 20 },
        });
        const rawOutput = plannerResult.content;
        const firstClause = rawOutput.match(/^FIRST_CLAUSE:\s*(.+)$/im)?.[1]?.trim() || '';
        const responseGoal = rawOutput.match(/^RESPONSE_GOAL:\s*(.+)$/im)?.[1]?.trim() || '';
        const priorFrame = rawOutput.match(/^PRIOR_FRAME:\s*(.+)$/im)?.[1]?.trim() || '';
        const forbiddenMoves = rawOutput.match(/^FORBIDDEN_MOVES:\s*(.+)$/im)?.[1]?.trim() || '';
        const parseFailed = !firstClause || !responseGoal;
        plannerDebug = { rawOutput, priorFrame, responseGoal, forbiddenMoves, firstClause, parseFailed };
        if (firstClause && responseGoal) {
          plannerFirstClause = firstClause;
          plannerSystemAddendum = [
            '',
            '<!-- PLAN -->',
            priorFrame ? `PRIOR_FRAME: ${priorFrame}` : null,
            `RESPONSE_GOAL: ${responseGoal}`,
            forbiddenMoves ? `FORBIDDEN_MOVES: ${forbiddenMoves}` : null,
            '<!-- /PLAN -->',
          ].filter(Boolean).join('\n');
        }
      } catch (err) {
        // Planner failure is non-fatal — capture what we can for debug
        plannerDebug = {
          rawOutput: err instanceof Error ? err.message : String(err),
          priorFrame: '',
          responseGoal: '',
          forbiddenMoves: '',
          firstClause: '',
          parseFailed: true,
        };
      }
    }

    const response = await this.backend.generate({
      systemPrompt: plannerSystemAddendum
        ? `${prompt.systemPrompt}${plannerSystemAddendum}`
        : prompt.systemPrompt,
      latestHumanText: prompt.userPrompt,
      modelName: input.modelName,
      assistantPrefill: plannerFirstClause || undefined,
      params: {
        temperature: 0.7,
        maxTokens: 512,
        topP: 0.9,
        topK: 50,
        ...input.params,
      },
    });

    const rejectedReasons: string[] = [];
    let rescueApplied = false;
    let rescueRenderAttempted = false;
    let rescueRenderSucceeded = false;
    let fallbackUsed = false;
    let laneTagLeakDetected = false;
    let bareLaneTokenDetected = false;
    let sidecarShapeRejected = false;
    let vent: VisibleVentCode = 'NONE';
    let ventConfidence: number | undefined;
    let visibleVentParseSource: 'exact' | 'sanitized' | 'fallback' | undefined;
    let visibleVentParseError: string | undefined;
    // Strip <think>...</think> reasoning blocks before any validation — local models may emit these
    const thinkCleanedResponse = /<think>/i.test(response.content)
      ? { ...response, content: response.content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim() }
      : response;
    let finalResponse = thinkCleanedResponse;
    let bannedSloganDetected = false;
    let bannedSloganSourcePath: string | undefined;
    const immediatePriorAssistant = getImmediatePriorAssistantTurn(input.recentRoomTurns);
    const shortClarificationFollowup = isShortClarificationFollowup(latestHumanText);
    const directUserProhibitionDetected = /\b(don't do that|dont do that|don't repeat me|dont repeat me|stop that|stop doing that|stop)\b/i.test(latestHumanText);
// Project doctrine: there are no canned responses anywhere, ever.
// Visible output must answer locally, acknowledge specifically, or admit uncertainty plainly.
// Opaque slogans and placeholder engagement language are forbidden.
    const primaryRenderBannedSlogan = looksLikeBannedSlogan(response.content);
    if (primaryRenderBannedSlogan) {
      bannedSloganDetected = true;
      bannedSloganSourcePath = 'primary_render';
    }
    const analysisLeak = looksLikeInternalAnalysisLeak(response.content);
    const doctrineLeak = looksLikeDoctrineLeak(response.content);
    const runtimeStatusLeak = looksLikeRuntimeStatusLeak(response.content);
    const counselorTemplate = looksLikeCounselorTemplate(response.content);
    const genericUplift = looksLikeGenericUplift(response.content);
    const runtimeTalkSupported = latestTurnSupportsRuntimeTalk(latestHumanText);
    const strayTaskStatus = looksLikeStrayTaskStatus(response.content);
    const unsupportedRuntimeStatusLeak = runtimeStatusLeak && !runtimeTalkSupported;
    const unsupportedStrayTaskStatus = strayTaskStatus && !runtimeTalkSupported;
    const detectedUserStateAssertions = extractUserStateAssertions(response.content);
    const latestTurnSupportsAssertion = latestTurnSupportsStateAssertion(latestHumanText, detectedUserStateAssertions);
    const latestTurnDeniedStateAttribution = latestTurnDeniesStateAttribution(latestHumanText);
    const unsupportedStateAssertion = detectedUserStateAssertions.length > 0 && !latestTurnSupportsAssertion;
    const stateAssertionAfterCorrection = detectedUserStateAssertions.length > 0 && latestTurnDeniedStateAttribution;
    const burdenMetaphorDetected = detectedUserStateAssertions.some(assertion =>
      /carrying something heavy|heavy right now|heavy for a while|let it go/i.test(assertion),
    );
    const burdenMetaphorStateAssertion =
      burdenMetaphorDetected && (!latestTurnSupportsAssertion || latestTurnDeniedStateAttribution);
    const stateProbeAfterUserDenial =
      latestTurnDeniedStateAttribution &&
      (burdenMetaphorDetected || containsConcernProbeContinuation(response.content));
    const plannerBleed = looksLikePlannerBleed(response.content);
    laneTagLeakDetected = looksLikeLaneTagLeak(response.content);
    bareLaneTokenDetected = startsWithBareLaneToken(response.content);
    const parrotReplyDetected = looksLikeParrotReply(latestHumanText, response.content);
    const parrotLaundering = looksLikeParrotLaundering(latestHumanText, response.content);
    const unsupportedSelfExplanationDetected = looksLikeUnsupportedSelfExplanation(response.content);
    const missedDirectProhibition =
      directUserProhibitionDetected
      && !/\b(sorry|right|won't|will not|stop|stopping|repeat|repeating)\b/i.test(response.content)
      && looksLikeWarmthMomentumDrift(response.content);

    // ── Validation category grouping ──
    // A — Model quality failures: rescue render may fix these
    const categoryA = primaryRenderBannedSlogan || (counselorTemplate || genericUplift) || analysisLeak
      || parrotReplyDetected || parrotLaundering.detected
      || unsupportedSelfExplanationDetected || missedDirectProhibition;
    // B — Architecture bleed: prompt structure is leaking; rescue with same prompt will re-leak
    const categoryB = doctrineLeak || unsupportedRuntimeStatusLeak || unsupportedStrayTaskStatus
      || laneTagLeakDetected || bareLaneTokenDetected || plannerBleed;
    // C — State attribution: wrong assertion rescued into a slightly-different wrong assertion is worse than silence
    const categoryC = unsupportedStateAssertion || stateAssertionAfterCorrection
      || burdenMetaphorStateAssertion || stateProbeAfterUserDenial;

    if (categoryA || categoryB || categoryC) {
      // Log all firing reasons regardless of category
      if (primaryRenderBannedSlogan) rejectedReasons.push('banned_slogan');
      if (analysisLeak) rejectedReasons.push('internal_analysis_leak');
      if (doctrineLeak) rejectedReasons.push('doctrine_leak');
      if (counselorTemplate || genericUplift) rejectedReasons.push('generic_counselor_template');
      if (unsupportedRuntimeStatusLeak) rejectedReasons.push('runtime_status_leak');
      if (unsupportedStrayTaskStatus) rejectedReasons.push('stray_task_status');
      if (unsupportedStateAssertion) rejectedReasons.push('unsupported_user_state_assertion');
      if (stateAssertionAfterCorrection) rejectedReasons.push('state_assertion_after_user_correction');
      if (burdenMetaphorStateAssertion) rejectedReasons.push('burden_metaphor_state_assertion');
      if (stateProbeAfterUserDenial) rejectedReasons.push('state_probe_after_user_denial');
      if (plannerBleed) rejectedReasons.push('planner_bleed');
      if (laneTagLeakDetected) rejectedReasons.push('lane_tag_leak');
      if (bareLaneTokenDetected && !rejectedReasons.includes('lane_tag_leak')) rejectedReasons.push('lane_tag_leak');
      if (parrotReplyDetected || parrotLaundering.detected) rejectedReasons.push(parrotLaundering.detected ? 'parrot_laundering' : 'parrot_reply');
      if (unsupportedSelfExplanationDetected) rejectedReasons.push('unsupported_self_explanation');
      if (missedDirectProhibition) rejectedReasons.push('missed_direct_prohibition');
      rescueApplied = true;

      if (categoryC) {
        // ── Category C: short-circuit — wrong state attribution; silence is better than re-asserting
        rejectedReasons.push('category_c_silence');
        finalResponse = { ...response, content: '' };
      } else if (categoryB) {
        // ── Category B: architecture bleed — skip rescue (same prompt re-leaks), go to minimal render
        rejectedReasons.push('category_b_bleed');
        fallbackUsed = true;
        const categoryBSystemPrompt = `You are ${input.agentName}. Respond to the human in plain honest sentences. No meta-commentary. No internal framing. No labels.`;
        const minimalB = await this.backend.generate({
          systemPrompt: categoryBSystemPrompt,
          latestHumanText: prompt.userPrompt,
          modelName: input.modelName,
          params: {
            temperature: Math.min(input.params?.temperature ?? 0.7, 0.45),
            maxTokens: input.params?.maxTokens ?? 256,
            topP: input.params?.topP ?? 0.9,
            topK: input.params?.topK ?? 50,
          },
        });
        // Sanitize: strip any system-prompt echo or debug string that leaked into the output
        let categoryBText = minimalB.content.trim();
        categoryBText = categoryBText
          .replace(/The previous (?:reply|rejection) was (?:likely )?(?:due to|rejected)[^.]*\./gi, '')
          .replace(/(?:leaked?|leaking) (?:doctrine text|lane tags|runtime status)[^.]*\./gi, '')
          .trim();
        // If the model echoed the system prompt or produced nothing usable, emit empty (→ silence)
        if (!categoryBText || looksLikeDoctrineLeak(categoryBText) || looksLikeLaneTagLeak(categoryBText)) {
          categoryBText = '';
        }
        finalResponse = { ...minimalB, content: categoryBText };
      } else {
        // ── Category A: model quality — attempt rescue render
        rescueRenderAttempted = true;
      const rescued = await this.backend.generate({
        systemPrompt: `${prompt.systemPrompt}

[RESCUE_RENDER]
Return exactly JSON and nothing else.
{"visible":"...","vent":"NONE"}
Rules:
- visible = only the user-facing reply text
- vent = one enum value only: NONE | META_WRAPPER_PRESSURE | MEMORY_OVERREACH_RISK | STATE_ATTRIBUTION_RISK | PROMPT_ECHO_RISK | MIXED_TARGET_PRESSURE
- no markdown
- no headings
- no labels like VISIBLE:
- no explanation outside JSON
- stay with [LATEST_USER_TURN]
- answer the user without repeating their wording back
- add clarification or a direct response
- do not mirror the user's sentence as the reply
- do not restate the user's message in new formatting
- respond to it
- do not mirror the user's clauses back line by line
- answer the user's complaint directly
- do not invent explanations about your communication style or internal design
- acknowledge and comply if the user asked you to stop doing something
- obey direct user prohibitions first
- do not output internal analysis, memory-state commentary, doctrine commentary, response-strategy narration, or appraisal of the user`,
        latestHumanText: prompt.userPrompt,
        modelName: input.modelName,
        params: {
          temperature: Math.min(input.params?.temperature ?? 0.7, 0.55),
          maxTokens: input.params?.maxTokens ?? 512,
          topP: input.params?.topP ?? 0.9,
          topK: input.params?.topK ?? 50,
        },
      });
      const parsedVent = parseVisibleVentPayload(rescued.content);
      visibleVentParseSource = parsedVent.source;
      visibleVentParseError = parsedVent.error;
      sidecarShapeRejected = !parsedVent.payload;
      const rescuedVisible = parsedVent.payload?.visible || '';
      const rescueBannedSlogan = looksLikeBannedSlogan(rescuedVisible);
      if (rescueBannedSlogan) {
        bannedSloganDetected = true;
        bannedSloganSourcePath = 'rescue_render';
        rejectedReasons.push('banned_slogan');
      }
      vent = parsedVent.payload?.vent || 'NONE';
      ventConfidence = parsedVent.payload?.ventConfidence;
      const rescuedAnalysisLeak = looksLikeInternalAnalysisLeak(rescuedVisible);
      const rescuedDoctrineLeak = looksLikeDoctrineLeak(rescuedVisible);
      const rescuedCounselorTemplate = looksLikeCounselorTemplate(rescuedVisible);
      const rescuedGenericUplift = looksLikeGenericUplift(rescuedVisible);
      const rescuedRuntimeStatusLeak = looksLikeRuntimeStatusLeak(rescuedVisible);
      const rescuedRuntimeTalkSupported = latestTurnSupportsRuntimeTalk(latestHumanText);
      const rescuedStrayTaskStatus = looksLikeStrayTaskStatus(rescuedVisible);
      const rescuedAssertions = extractUserStateAssertions(rescuedVisible);
      const rescuedUnsupportedStateAssertion = rescuedAssertions.length > 0 && !latestTurnSupportsStateAssertion(latestHumanText, rescuedAssertions);
      const rescuedStateAssertionAfterCorrection = rescuedAssertions.length > 0 && latestTurnDeniesStateAttribution(latestHumanText);
      const rescuedBurdenMetaphorDetected = rescuedAssertions.some(assertion =>
        /carrying something heavy|heavy right now|heavy for a while|let it go/i.test(assertion),
      );
      const rescuedBurdenMetaphorStateAssertion =
        rescuedBurdenMetaphorDetected &&
        (!latestTurnSupportsStateAssertion(latestHumanText, rescuedAssertions) || latestTurnDeniedStateAttribution);
      const rescuedStateProbeAfterUserDenial =
        latestTurnDeniedStateAttribution &&
        (rescuedBurdenMetaphorDetected || containsConcernProbeContinuation(rescuedVisible));
      const rescuedLaneTagLeak = looksLikeLaneTagLeak(rescuedVisible);
      const rescuedBareLaneToken = startsWithBareLaneToken(rescued.content) || startsWithBareLaneToken(rescuedVisible);
      const rescuedParrotReply = looksLikeParrotReply(latestHumanText, rescuedVisible);
      const rescuedParrotLaundering = looksLikeParrotLaundering(latestHumanText, rescuedVisible);
      const rescuedUnsupportedSelfExplanation = looksLikeUnsupportedSelfExplanation(rescuedVisible);
      const rescuedMissedDirectProhibition =
        directUserProhibitionDetected
        && !/\b(sorry|right|won't|will not|stop|stopping|repeat|repeating)\b/i.test(rescuedVisible)
        && looksLikeWarmthMomentumDrift(rescuedVisible);

      if (
        parsedVent.payload
        && !rescuedAnalysisLeak
        && !rescuedDoctrineLeak
        && !rescuedCounselorTemplate
        && !rescuedGenericUplift
        && !(rescuedRuntimeStatusLeak && !rescuedRuntimeTalkSupported)
        && !(rescuedStrayTaskStatus && !rescuedRuntimeTalkSupported)
        && !rescuedUnsupportedStateAssertion
        && !rescuedStateAssertionAfterCorrection
        && !rescuedBurdenMetaphorStateAssertion
        && !rescuedStateProbeAfterUserDenial
        && !rescuedLaneTagLeak
        && !rescuedBareLaneToken
        && !rescuedParrotReply
        && !rescuedParrotLaundering.detected
        && !rescuedUnsupportedSelfExplanation
        && !rescuedMissedDirectProhibition
      ) {
        finalResponse = {
          ...rescued,
          content: rescuedVisible,
        };
        rescueRenderSucceeded = true;
      } else {
        fallbackUsed = true;
        const preferredFallback = shortClarificationFollowup
          ? (literalClarificationFallback(latestHumanText, immediatePriorAssistant) || deterministicFallbackByTurnType(input.routerPacket.schema.turnType))
          : deterministicFallbackByTurnType(input.routerPacket.schema.turnType);
        let selectedFallback: string | null =
          (parrotReplyDetected || parrotLaundering.detected)
            ? localNonParrotFallback(latestHumanText)
            : (unsupportedSelfExplanationDetected || missedDirectProhibition)
            ? null
            : (unsupportedRuntimeStatusLeak || unsupportedStrayTaskStatus)
            ? runtimeLeakFallback(latestHumanText)
            : (counselorTemplate || genericUplift)
            ? null
            : (burdenMetaphorStateAssertion || stateProbeAfterUserDenial)
            ? null
            : (unsupportedStateAssertion || stateAssertionAfterCorrection)
            ? null
            : preferredFallback;
        const fallbackHumanTurnId = input.routerPacket.metadata.createdAt;
        const lastFallbackText = this.lastFallbackTextByAgent.get(input.agentName) || '';
        const lastFallbackAt = this.lastFallbackAtByAgent.get(input.agentName) || 0;
        const lastFallbackHumanTurnId = this.lastFallbackHumanTurnIdByAgent.get(input.agentName) || '';
        const fallbackRecentlyRepeated =
          isNearDuplicateDelivery(lastFallbackText, selectedFallback || '')
          && (
            (Date.now() - lastFallbackAt) <= 30000
            || lastFallbackHumanTurnId === fallbackHumanTurnId
          );
        if (selectedFallback && looksLikeBannedSlogan(selectedFallback)) {
          bannedSloganDetected = true;
          bannedSloganSourcePath = bannedSloganSourcePath || 'deterministic_fallback';
          rejectedReasons.push('banned_slogan');
        }
        if (selectedFallback && (isOpaqueGenericFallback(selectedFallback) || (looksLikeBannedSlogan(selectedFallback) && (shortClarificationFollowup || fallbackRecentlyRepeated)))) {
          rejectedReasons.push('opaque_generic_fallback');
          selectedFallback = literalClarificationFallback(latestHumanText, immediatePriorAssistant) || null;
        }
        if (selectedFallback && looksLikeBannedSlogan(selectedFallback)) {
          bannedSloganDetected = true;
          bannedSloganSourcePath = bannedSloganSourcePath || 'deterministic_fallback';
          rejectedReasons.push('banned_slogan');
          selectedFallback = literalClarificationFallback(latestHumanText, immediatePriorAssistant) || null;
        }
        if (selectedFallback) {
          this.lastFallbackTextByAgent.set(input.agentName, selectedFallback);
          this.lastFallbackAtByAgent.set(input.agentName, Date.now());
          this.lastFallbackHumanTurnIdByAgent.set(input.agentName, fallbackHumanTurnId);
          finalResponse = { ...rescued, content: selectedFallback };
        } else {
          // No canned fallback available — regenerate with minimal honest-reply constraint
          // rather than going silent. All banned slogans are already in the validator;
          // this attempt runs free of any preset strings.
          rejectedReasons.push('banned_fakery');
          const minimal = await this.backend.generate({
            systemPrompt: `You are ${input.agentName}. The previous reply was rejected for containing a canned phrase.
Respond to the human in one to three honest sentences.
Rules:
- Do not start with "I'm here", "Got it", "Understood", "Okay", or any acknowledgment filler.
- Do not repeat or mirror the human's words.
- Do not explain your communication style.
- Do not invent a state for the human ("you seem tired", "sounds heavy").
- Say something true and specific to what the human actually said.
- If you genuinely have nothing to add, say so plainly in your own words.`,
            latestHumanText: prompt.userPrompt,
            modelName: input.modelName,
            params: {
              temperature: Math.min(input.params?.temperature ?? 0.7, 0.45),
              maxTokens: input.params?.maxTokens ?? 256,
              topP: input.params?.topP ?? 0.9,
              topK: input.params?.topK ?? 50,
            },
          });
          const minimalText = minimal.content.trim();
          finalResponse = { ...minimal, content: minimalText };
        }
      }
      } // end category A
    }

    return {
      response: finalResponse,
      doctrine,
      prompt,
      nextTurnDecision,
      nextTurnDecisionReason,
      nextTurnDecisionConfidence,
      validation: {
        rejectedReasons,
        sanitized: rescueApplied,
        fallbackUsed,
        rescueApplied,
        rescueRenderAttempted,
        rescueRenderSucceeded,
        laneTagLeakDetected,
        bareLaneTokenDetected,
        sidecarShapeRejected,
        internalAnalysisLeakDetected: analysisLeak,
        doctrineLeakDetected: doctrineLeak,
        detectedUserStateAssertions,
        latestTurnSupportsStateAssertion: latestTurnSupportsAssertion,
        latestTurnDeniesStateAttribution: latestTurnDeniedStateAttribution,
        vent,
        ventConfidence,
        visibleVentParseSource,
        visibleVentParseError,
        rawOutput: response.content,
        visibleOutput: finalResponse.content,
        bannedSloganDetected,
        bannedSloganSourcePath,
        parrotReplyDetected,
        parrotLaunderingDetected: parrotLaundering.detected,
        parrotGlobalOverlap: parrotLaundering.globalOverlap,
        parrotClauseOverlap: parrotLaundering.clauseOverlap,
        repeatsUserFirstPersonFrame: parrotLaundering.repeatsFirstPersonFrame,
        unsupportedSelfExplanationDetected,
        plannerDebug,
      },
    };
  }
}
