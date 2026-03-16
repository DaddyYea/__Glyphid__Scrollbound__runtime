import {
  DoctrineMode,
  DoctrineTurnSchema,
  RouterDangerFlag,
  RouterLength,
  NextTurnDecision,
  RouterTargetSpec,
  RouterTone,
  RouterTurnType,
} from './DoctrineTurnSchema';

export interface RouterContinuityState {
  keepThread: boolean;
  threadLabel: string | null;
  priorTopic: string | null;
  supersedesPriorThread?: boolean;
  supersedingReason?: 'explicit_return' | 'explicit_topic_shift' | 'explicit_correction' | 'new_task' | 'fresh_question' | 'none';
}

export interface RouterTrace {
  directAnswerLike: boolean;
  repairLike: boolean;
  searchLike: boolean;
  taskLike: boolean;
  explicitReturn?: boolean;
  explicitTopicShift?: boolean;
  explicitCorrection?: boolean;
  freshQuestionSupersession?: boolean;
  chosenTurnType: RouterTurnType;
  extractedMustAnswer: string;
  extractedLiveTopic: string;
  extractedRepairObject?: string;
  mixedIntent: boolean;
  primaryIntent?: 'repair' | 'question' | 'task' | 'companionship' | 'disclosure';
  secondaryIntent?: 'repair' | 'question' | 'task' | 'companionship' | 'disclosure' | 'none';
  arbitrationReason?: string;
  winningClause?: string;
  questionForm: 'yes_no' | 'open' | 'none';
  doctrineModes: DoctrineMode[];
  dangerFlags: RouterDangerFlag[];
  supersedesPriorThread: boolean;
  supersedingReason: 'explicit_return' | 'explicit_topic_shift' | 'explicit_correction' | 'new_task' | 'fresh_question' | 'none';
  nextTurnDecision?: NextTurnDecision;
  nextTurnDecisionReason?: string;
  nextTurnDecisionConfidence?: number;
}

export interface TurnTriageRecord {
  timestamp: string;
  tickId?: number | null;
  latestHumanText: string;
  router: {
    turnType: string;
    target: string;
    mustAnswer?: string;
    liveTopic?: string;
    repairObject?: string;
    questionForm?: string;
    mixedIntent?: boolean;
    primaryIntent?: string;
    secondaryIntent?: string;
    arbitrationReason?: string;
    nextTurnDecision?: string;
    nextTurnDecisionReason?: string;
    nextTurnDecisionConfidence?: number;
    supersedesPriorThread?: boolean;
    supersedingReason?: string;
    dangerFlags?: string[];
    doctrineModes?: string[];
    trace?: unknown;
  };
  carryover: {
    previousThoughtCountBefore?: number;
    previousThoughtCountAfter?: number;
    previousThoughtMaxOverlap?: number;
    previousThoughtMinOverlap?: number;
    staleCarryoverPruned?: boolean;
  };
  prompt: {
    selectedContextDetails?: Array<{ source: string; text: string }>;
    renderedSchemaSummary?: Record<string, unknown>;
    systemPromptExcerpt?: string;
    userPromptExcerpt?: string;
  };
  decisionLane?: {
    rawDecisionOutput?: string;
    parsedDecision?: string;
    parseSource?: 'exact' | 'sanitized' | 'fallback';
    parseError?: string;
  };
  model: {
    rawOutput?: string;
    visibleOutput?: string;
    finalDeliveredOutput?: string;
  };
  validators: {
    rejectedReasons: string[];
    sanitized: boolean;
    fallbackUsed: boolean;
    rescueRenderAttempted?: boolean;
    rescueRenderSucceeded?: boolean;
    duplicateDeliverySuppressed?: boolean;
    staleCandidateSuperseded?: boolean;
    bannedSloganDetected?: boolean;
    bannedSloganSourcePath?: string;
    laneTagLeakDetected?: boolean;
    bareLaneTokenDetected?: boolean;
    sidecarShapeRejected?: boolean;
    internalAnalysisLeakDetected?: boolean;
    doctrineLeakDetected?: boolean;
    parrotLaunderingDetected?: boolean;
    parrotGlobalOverlap?: number;
    parrotClauseOverlap?: number;
    repeatsUserFirstPersonFrame?: boolean;
    detectedUserStateAssertions?: string[];
    latestTurnSupportsStateAssertion?: boolean;
    latestTurnDeniesStateAttribution?: boolean;
    vent?: string;
    ventConfidence?: number;
    visibleVentParseSource?: 'exact' | 'sanitized' | 'fallback';
    visibleVentParseError?: string;
    plannerDebug?: {
      rawOutput: string;
      priorFrame: string;
      responseGoal: string;
      forbiddenMoves: string;
      firstClause: string;
      parseFailed: boolean;
    };
  };
}

export interface RouterPacket {
  schema: DoctrineTurnSchema;
  continuity: RouterContinuityState;
  metadata: {
    routerModel: string;
    createdAt: string;
    version: 'router_packet_v1';
    trace?: RouterTrace;
  };
}

export interface RouterTurnInput {
  latestHumanText: string;
  latestHumanSpeaker?: string;
  continuity?: Partial<RouterContinuityState>;
}

export function createRouterPacket(input: {
  turnType: RouterTurnType;
  target: string;
  targetSpec: RouterTargetSpec;
  doctrineModes?: DoctrineMode[];
  tone?: RouterTone;
  length?: RouterLength;
  askAllowed?: boolean;
  answerFirst?: boolean;
  continuityRequired?: boolean;
  dangerFlags?: RouterDangerFlag[];
  nextTurnDecision?: NextTurnDecision;
  nextTurnDecisionReason?: string;
  nextTurnDecisionConfidence?: number;
  continuity?: Partial<RouterContinuityState>;
  routerModel: string;
  trace?: RouterTrace;
}): RouterPacket {
  return {
    schema: {
      turnType: input.turnType,
      target: input.target,
      targetSpec: input.targetSpec,
      doctrineModes: input.doctrineModes || [],
      tone: input.tone || 'neutral',
      length: input.length || 'medium',
      askAllowed: input.askAllowed ?? true,
      answerFirst: input.answerFirst ?? false,
      continuityRequired: input.continuityRequired ?? false,
      dangerFlags: input.dangerFlags || [],
      nextTurnDecision: input.nextTurnDecision,
      nextTurnDecisionReason: input.nextTurnDecisionReason,
      nextTurnDecisionConfidence: input.nextTurnDecisionConfidence,
    },
    continuity: {
      keepThread: input.continuity?.keepThread ?? false,
      threadLabel: input.continuity?.threadLabel ?? null,
      priorTopic: input.continuity?.priorTopic ?? null,
      supersedesPriorThread: input.continuity?.supersedesPriorThread ?? false,
      supersedingReason: input.continuity?.supersedingReason ?? 'none',
    },
    metadata: {
      routerModel: input.routerModel,
      createdAt: new Date().toISOString(),
      version: 'router_packet_v1',
      trace: input.trace,
    },
  };
}

export function excerpt(text: string, max = 300): string {
  const source = String(text || '').replace(/\s+/g, ' ').trim();
  return source.length > max ? `${source.slice(0, max)}...` : source;
}

export function shouldEmitTriage(record: TurnTriageRecord): boolean {
  return (
    record.validators.rejectedReasons.length > 0
    || record.validators.sanitized
    || record.validators.fallbackUsed
    || !!record.validators.rescueRenderAttempted
    || !!record.validators.duplicateDeliverySuppressed
    || !!record.validators.staleCandidateSuperseded
    || !!record.carryover.staleCarryoverPruned
    || !!record.validators.laneTagLeakDetected
    || !!record.validators.internalAnalysisLeakDetected
    || !!record.validators.doctrineLeakDetected
    || !!record.validators.visibleVentParseError
    || !!record.decisionLane?.parseError
    || /<think/i.test(record.model.rawOutput || '')
    || !record.model.finalDeliveredOutput
  );
}

export function summarizeTriage(record: TurnTriageRecord): string {
  return [
    `turnType=${record.router.turnType}`,
    `decision=${record.router.nextTurnDecision || 'n/a'}`,
    `mustAnswer=${JSON.stringify(record.router.mustAnswer || '')}`,
    `primary=${record.router.primaryIntent || 'n/a'}`,
    `supersede=${record.router.supersedesPriorThread ? record.router.supersedingReason : 'no'}`,
    `carryover=${record.carryover.previousThoughtCountBefore ?? 0}->${record.carryover.previousThoughtCountAfter ?? 0}`,
    `sanitized=${record.validators.sanitized}`,
    `fallback=${record.validators.fallbackUsed}`,
    `rescue=${record.validators.rescueRenderAttempted ? 'yes' : 'no'}`,
    `dup=${record.validators.duplicateDeliverySuppressed ? 'yes' : 'no'}`,
    `stale=${record.validators.staleCandidateSuperseded ? 'yes' : 'no'}`,
    `rejected=${record.validators.rejectedReasons.join('|') || 'none'}`,
  ].join(' ');
}
