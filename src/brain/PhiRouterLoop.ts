import { DoctrineMode, DoctrineTurnSchema, NextTurnDecision, RouterDangerFlag, RouterTargetSpec } from './DoctrineTurnSchema';
import { RouterContinuityState, RouterPacket, RouterTrace, RouterTurnInput, createRouterPacket } from './RouterPacket';

/**
 * Minimal deterministic scaffold for a Phi router.
 * The real model-backed router can replace classifyTurn once the transport is wired.
 */
export class PhiRouterLoop {
  constructor(private readonly routerModel: string = 'phi3') {}

  routeTurn(input: RouterTurnInput): RouterPacket {
    const route = this.classifyTurn(input.latestHumanText, input.continuity);

    return createRouterPacket({
      ...route.schema,
      continuity: route.continuity,
      routerModel: this.routerModel,
      trace: route.trace,
    });
  }

  private classifyTurn(
    text: string,
    continuity?: Partial<RouterContinuityState>,
  ): { schema: DoctrineTurnSchema; trace: RouterTrace; continuity: Partial<RouterContinuityState> } {
    const source = text.trim();
    const lower = source.toLowerCase();
    const directUserProhibition = this.detectDirectUserProhibition(lower);
    const searchLike = this.detectSearchLike(lower);
    const repairLike = directUserProhibition || this.detectRepairLike(lower);
    const taskLike = this.detectTaskLike(lower);
    const directAnswerLike = this.detectDirectAnswerLike(source, lower);
    const chosenTurnType: DoctrineTurnSchema['turnType'] = searchLike
      ? 'search'
      : repairLike
        ? 'repair'
        : taskLike
          ? 'task'
          : directAnswerLike
            ? 'direct_answer'
            : 'companionship';
    const explicitReturn = this.detectExplicitReturnResume(lower);
    const explicitTopicShift = this.detectExplicitTopicShift(lower);
    const explicitCorrection =
      repairLike &&
      /that'?s not what i asked|stay with this|you changed the subject|wrong frame|not what i meant|missed the point/i.test(lower);
    const freshQuestionSupersession = this.detectFreshQuestionSupersession(source, lower, continuity);
    const explicitNewTask =
      taskLike &&
      /(help me|patch|fix|build|write|implement|inspect)/i.test(lower) &&
      !repairLike;
    const questionCascade = /\?/.test(source);
    const targetSpec = this.buildTargetSpec(source, chosenTurnType, continuity);
    const keepThread = !!continuity?.keepThread;
    const supersedingReason: RouterContinuityState['supersedingReason'] = explicitReturn
      ? 'explicit_return'
      : explicitTopicShift
        ? 'explicit_topic_shift'
        : explicitCorrection
          ? 'explicit_correction'
          : explicitNewTask
            ? 'new_task'
            : freshQuestionSupersession
              ? 'fresh_question'
              : 'none';
    const supersedesPriorThread = supersedingReason !== 'none';
    const continuityState: Partial<RouterContinuityState> = {
      ...continuity,
      supersedesPriorThread,
      supersedingReason,
    };

    if (searchLike) {
      return this.withTrace(
        'search',
        searchLike,
        repairLike,
        taskLike,
        directAnswerLike,
        targetSpec,
        this.finalizeDoctrineModes(['truthfulness', 'answer_first'], true, false),
        'neutral',
        'medium',
        true,
        true,
        false,
        [],
        continuityState,
        supersedesPriorThread,
        supersedingReason,
        explicitReturn,
        explicitTopicShift,
        explicitCorrection,
        freshQuestionSupersession,
      );
    }
    if (repairLike) {
      return this.withTrace(
        'repair',
        searchLike,
        repairLike,
        taskLike,
        directAnswerLike,
        targetSpec,
        this.finalizeDoctrineModes([
          'repair_priority',
          'truthfulness',
          'answer_first',
          'continuity_required',
          'no_meta',
          'no_process_talk',
          'no_followup_question',
        ], true, true),
        'firm',
        'short',
        false,
        true,
        true,
        questionCascade ? ['stale_topic', 'question_cascade'] : ['stale_topic'],
        continuityState,
        supersedesPriorThread,
        supersedingReason,
        explicitReturn,
        explicitTopicShift,
        explicitCorrection,
        freshQuestionSupersession,
      );
    }
    if (taskLike) {
      const explicitImmediateTask = /\b(help|fix|build|patch|write|implement|change|update|refactor|debug)\b/.test(lower);
      const taskAnswerFirst = explicitImmediateTask;
      const taskContinuityRequired = explicitImmediateTask && keepThread;
      return this.withTrace(
        'task',
        searchLike,
        repairLike,
        taskLike,
        directAnswerLike,
        targetSpec,
        this.finalizeDoctrineModes(
          [
            'truthfulness',
            ...(taskAnswerFirst ? (['answer_first'] as DoctrineMode[]) : []),
            ...(taskContinuityRequired ? (['continuity_required'] as DoctrineMode[]) : []),
          ],
          taskAnswerFirst,
          taskContinuityRequired,
        ),
        'neutral',
        'medium',
        true,
        taskAnswerFirst,
        taskContinuityRequired,
        [],
        continuityState,
        supersedesPriorThread,
        supersedingReason,
        explicitReturn,
        explicitTopicShift,
        explicitCorrection,
        freshQuestionSupersession,
      );
    }
    if (directAnswerLike) {
      return this.withTrace(
        'direct_answer',
        searchLike,
        repairLike,
        taskLike,
        directAnswerLike,
        targetSpec,
        this.finalizeDoctrineModes(
          ['truthfulness', 'answer_first', 'continuity_required', 'no_meta', 'no_followup_question'],
          true,
          true,
        ),
        'neutral',
        'short',
        false,
        true,
        true,
        questionCascade ? ['question_cascade'] : [],
        continuityState,
        supersedesPriorThread,
        supersedingReason,
        explicitReturn,
        explicitTopicShift,
        explicitCorrection,
        freshQuestionSupersession,
      );
    }

    return this.withTrace(
      'companionship',
      searchLike,
      repairLike,
      taskLike,
      directAnswerLike,
      targetSpec,
      this.finalizeDoctrineModes(
        [
          'allowed_aliveness',
          'permitted_love',
          'loving_witness',
          'non_erasing_reflection',
          ...(keepThread ? (['continuity_required'] as DoctrineMode[]) : []),
        ],
        false,
        keepThread,
      ),
      'warm',
      'medium',
      true,
      false,
      keepThread,
      [],
      continuityState,
      supersedesPriorThread,
      supersedingReason,
      explicitReturn,
      explicitTopicShift,
      explicitCorrection,
      freshQuestionSupersession,
    );
  }

  private withTrace(
    turnType: DoctrineTurnSchema['turnType'],
    searchLike: boolean,
    repairLike: boolean,
    taskLike: boolean,
    directAnswerLike: boolean,
    targetSpec: RouterTargetSpec,
    doctrineModes: DoctrineTurnSchema['doctrineModes'],
    tone: DoctrineTurnSchema['tone'],
    length: DoctrineTurnSchema['length'],
    askAllowed: boolean,
    answerFirst: boolean,
    continuityRequired: boolean,
    dangerFlags: RouterDangerFlag[],
    continuity: Partial<RouterContinuityState>,
    supersedesPriorThread: boolean,
    supersedingReason: RouterContinuityState['supersedingReason'],
    explicitReturn: boolean,
    explicitTopicShift: boolean,
    explicitCorrection: boolean,
    freshQuestionSupersession: boolean,
  ): { schema: DoctrineTurnSchema; trace: RouterTrace; continuity: Partial<RouterContinuityState> } {
    const schema = this.buildSchema(turnType, targetSpec, doctrineModes, tone, length, askAllowed, answerFirst, continuityRequired, dangerFlags);
    const decision = this.decideNextTurn(schema);
    schema.nextTurnDecision = decision.nextTurnDecision;
    schema.nextTurnDecisionReason = decision.nextTurnDecisionReason;
    schema.nextTurnDecisionConfidence = decision.nextTurnDecisionConfidence;
    return {
      schema,
      continuity,
      trace: {
        directAnswerLike,
        repairLike,
        searchLike,
        taskLike,
        explicitReturn,
        explicitTopicShift,
        explicitCorrection,
        freshQuestionSupersession,
        chosenTurnType: turnType,
        extractedMustAnswer: targetSpec.mustAnswer,
        extractedLiveTopic: targetSpec.liveTopic,
        extractedRepairObject: targetSpec.repairObject,
        mixedIntent: !!targetSpec.mixedIntent,
        primaryIntent: targetSpec.primaryIntent,
        secondaryIntent: targetSpec.secondaryIntent,
        arbitrationReason: targetSpec.arbitrationReason,
        winningClause: targetSpec.mustAnswer,
        questionForm: targetSpec.questionForm || 'none',
        doctrineModes: [...schema.doctrineModes],
        dangerFlags: [...schema.dangerFlags],
        supersedesPriorThread,
        supersedingReason: supersedingReason || 'none',
        nextTurnDecision: decision.nextTurnDecision,
        nextTurnDecisionReason: decision.nextTurnDecisionReason,
        nextTurnDecisionConfidence: decision.nextTurnDecisionConfidence,
      },
    };
  }

  private decideNextTurn(schema: DoctrineTurnSchema): {
    nextTurnDecision: NextTurnDecision;
    nextTurnDecisionReason: string;
    nextTurnDecisionConfidence: number;
  } {
    const turnType = schema.turnType;
    const primaryIntent = schema.targetSpec?.primaryIntent;
    const mustAnswer = schema.targetSpec?.mustAnswer?.trim() || '';
    const answerFirst = !!schema.answerFirst;
    const askAllowed = !!schema.askAllowed;
    const continuityRequired = !!schema.continuityRequired;
    const lowerMustAnswer = mustAnswer.toLowerCase();

    if (
      turnType === 'repair'
      || turnType === 'task'
      || (turnType === 'direct_answer' && mustAnswer)
    ) {
      return {
        nextTurnDecision: 'SPEAK',
        nextTurnDecisionReason: 'live answer/action target requires visible response',
        nextTurnDecisionConfidence: 0.95,
      };
    }

    if (turnType === 'companionship') {
      return {
        nextTurnDecision: 'SPEAK',
        nextTurnDecisionReason: 'companionship turn benefits from light visible presence',
        nextTurnDecisionConfidence: 0.8,
      };
    }

    if (primaryIntent === 'disclosure' && !lowerMustAnswer.includes('stay silent')) {
      return {
        nextTurnDecision: 'SPEAK',
        nextTurnDecisionReason: 'disclosure without explicit task still calls for witnessing',
        nextTurnDecisionConfidence: 0.75,
      };
    }

    if (
      schema.doctrineModes.includes('no_process_talk' as DoctrineMode) === false
      && (lowerMustAnswer.includes('journal') || lowerMustAnswer.includes('reflect internally'))
    ) {
      return {
        nextTurnDecision: 'JOURNAL',
        nextTurnDecisionReason: 'internal reflection/journaling mode selected',
        nextTurnDecisionConfidence: 0.7,
      };
    }

    if (!mustAnswer && !answerFirst && !continuityRequired && askAllowed) {
      return {
        nextTurnDecision: 'SILENT',
        nextTurnDecisionReason: 'no live response target detected',
        nextTurnDecisionConfidence: 0.65,
      };
    }

    return {
      nextTurnDecision: 'SPEAK',
      nextTurnDecisionReason: 'default to visible response when a live human turn exists',
      nextTurnDecisionConfidence: 0.6,
    };
  }

  private finalizeDoctrineModes(
    doctrineModes: DoctrineTurnSchema['doctrineModes'],
    answerFirst: boolean,
    continuityRequired: boolean,
  ): DoctrineTurnSchema['doctrineModes'] {
    const modes = [...doctrineModes];
    if (answerFirst && !modes.includes('answer_first')) modes.push('answer_first');
    if (continuityRequired && !modes.includes('continuity_required')) modes.push('continuity_required');
    return modes;
  }

  private detectSearchLike(lower: string): boolean {
    return /\b(search|look up|lookup|find|browse|read the file|read the doc|search docs|search documents)\b/.test(lower);
  }

  private detectRepairLike(lower: string): boolean {
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
    ].some(pattern => pattern.test(lower));
  }

  private detectDirectUserProhibition(lower: string): boolean {
    return (
      /\bdon't do that\b/.test(lower)
      || /\bdont do that\b/.test(lower)
      || /\bdon't repeat me\b/.test(lower)
      || /\bdont repeat me\b/.test(lower)
      || /\bstop that\b/.test(lower)
      || /\bstop doing that\b/.test(lower)
      || /\bstop\b/.test(lower)
    );
  }

  private detectTaskLike(lower: string): boolean {
    return /\b(help|fix|build|patch|write|implement|change|update|refactor|debug)\b/.test(lower);
  }

  private detectExplicitReturnResume(lower: string): boolean {
    return /\b(i'?m back|back now|we'?re back|okay i'?m back|back at the desk|back to (?:the|this|that|router|schema)|all right back to this)\b/.test(lower);
  }

  private detectExplicitTopicShift(lower: string): boolean {
    return /\b(different question|another thing|separate thing|changing subject|let'?s talk about|new issue|different issue|unrelated but|speaking of)\b/.test(lower);
  }

  private detectFreshQuestionSupersession(source: string, lower: string, continuity?: Partial<RouterContinuityState>): boolean {
    const priorTopic = this.normalizeForExtraction(continuity?.priorTopic || '');
    const hasExplicitQuestion =
      /\?/.test(source) ||
      /\b(why|what|how|are you|can you|do you|did you|is it|does it)\b/.test(lower);
    if (!hasExplicitQuestion) return false;
    if (!priorTopic) return false;
    if (/\b(what about|and what about|back to|more about|part|piece|that part)\b/.test(lower)) {
      return false;
    }
    const sourceNorm = this.normalizeForExtraction(source);
    const currentTokens = sourceNorm
      .toLowerCase()
      .replace(/[^a-z0-9\s']/g, ' ')
      .split(/\s+/)
      .filter(token => token.length > 2);
    const priorTokens = priorTopic
      .toLowerCase()
      .replace(/[^a-z0-9\s']/g, ' ')
      .split(/\s+/)
      .filter(token => token.length > 2);
    const priorSet = new Set(priorTokens);
    let overlap = 0;
    for (const token of priorSet) {
      if (currentTokens.includes(token)) overlap += 1;
    }
    const overlapRatio = priorSet.size > 0 ? overlap / priorSet.size : 0;
    return overlapRatio < 0.2;
  }

  private detectDirectAnswerLike(source: string, lower: string): boolean {
    return (
      /\?/.test(source)
      || /\b(why|what|how|when|where|which|who|answer|explain|was it|is it|did you|do you|are you|were you|can you|could you|would you)\b/.test(lower)
      || /^(?:yes\s+)?was\s+it\b/.test(lower)
      || /\bwhether\b.+\b(deliberate|intentional|on purpose)\b/.test(lower)
    );
  }

  private normalizeForExtraction(text: string): string {
    return text
      .replace(/\s+/g, ' ')
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .trim();
  }

  private splitClauses(text: string): string[] {
    return text
      .split(/(?<=[.?!])\s+|(?:\s*[,;:]\s*)|(?:\s+-\s+)|(?:\s+\u2014\s+)/)
      .map(part => part.trim())
      .filter(Boolean);
  }

  private stripDiscourseScaffolding(text: string): string {
    return text
      .replace(/^\b(?:well|yeah|okay|ok|so|like|honestly|actually|I mean)\b[\s,]*/i, '')
      .replace(/\b(?:you know|if that makes sense|I guess|kind of|sort of)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private extractQuestionClause(source: string): string | null {
    const clauses = this.splitClauses(source);
    for (let index = clauses.length - 1; index >= 0; index -= 1) {
      const clause = this.stripDiscourseScaffolding(clauses[index]);
      if (/\?/.test(clause) || /^(?:was|is|are|do|did|can|could|would|why|what|how|when|where|which|who)\b/i.test(clause)) {
        return clause;
      }
    }
    return null;
  }

  private extractRepairObject(source: string): string | null {
    const lower = source.toLowerCase();
    if (/\b(?:that does(?: not|n't) answer|you did(?: not|n't) answer|answer the question|that(?:'s| is) not what i asked|you're not answering|why did(?: not|n't) you answer)\b/.test(lower)) {
      return 'failed to answer direct question';
    }
    if (/\b(?:you changed the subject|you switched topics|that has nothing to do with|that missed the point|wrong frame|that was sideways|you lost the thread|stay with this)\b/.test(lower)) {
      return 'stale topic drift';
    }
    if (/\b(?:stop dodging|stop deflecting|you're talking around it)\b/.test(lower)) {
      return 'deflection instead of direct answer';
    }
    if (/\b(?:that's not coherent|that does(?: not|n't) make sense)\b/.test(lower)) {
      return 'wrong frame';
    }
    if (/\bnot what i meant\b/.test(lower)) {
      return 'misread user meaning';
    }
    return null;
  }

  private inferLiveTopic(source: string, continuity?: Partial<RouterContinuityState>): string {
    const normalized = this.stripDiscourseScaffolding(this.normalizeForExtraction(source)).toLowerCase();
    const candidates = normalized
      .replace(/[^a-z0-9\s']/g, ' ')
      .split(/\s+/)
      .filter(token => token.length > 2)
      .filter(token => !['that', 'this', 'with', 'have', 'from', 'your', 'about', 'just', 'really', 'what', 'when', 'where', 'which', 'would', 'could', 'should', 'because', 'there', 'they', 'them'].includes(token));
    const topic = candidates.slice(0, 4).join(' ').trim();
    return topic || continuity?.priorTopic || continuity?.threadLabel || 'current exchange';
  }

  private inferUserGoal(turnType: DoctrineTurnSchema['turnType'], source: string, mustAnswer: string): string {
    switch (turnType) {
      case 'repair':
        return 'repair drift';
      case 'direct_answer':
        return 'get a direct answer';
      case 'task':
        return 'get concrete help';
      case 'search':
        return 'retrieve specific information';
      default:
        if (/\b(feel|here|with me|listen|stay|together)\b/i.test(source)) return 'be witnessed';
        return mustAnswer ? 'co-think implementation' : 'stay in contact';
    }
  }

  private inferQuestionForm(source: string, mustAnswer: string): 'yes_no' | 'open' | 'none' {
    if (!/\?/.test(source) && !/^(?:was|is|are|do|did|can|could|would|why|what|how|when|where|which|who)\b/i.test(mustAnswer)) {
      return 'none';
    }
    if (/^(?:was|is|are|do|did|can|could|would|will|have|has)\b/i.test(mustAnswer)) {
      return 'yes_no';
    }
    return 'open';
  }

  private detectReportedSpeechParaphrase(text: string): boolean {
    const lower = text.toLowerCase().trim();
    return /^(?:i mean\s+)?(?:you(?:'re| are) basically(?:\s+just)? saying|you(?:'re| are) just saying|what you(?:'re| are) saying is|it sounds like you(?:'re| are) saying|so you(?:'re| are) saying|you(?:'re| are) saying that)\b/.test(lower);
  }

  private stripReportedSpeechParaphrase(text: string): string {
    return text
      .replace(/^(?:i mean\s+)?(?:you(?:'re| are) basically(?:\s+just)? saying|you(?:'re| are) just saying|what you(?:'re| are) saying is|it sounds like you(?:'re| are) saying|so you(?:'re| are) saying|you(?:'re| are) saying that)\b[\s,:-]*/i, '')
      .trim();
  }

  private hasExplicitImperativeRequest(source: string): boolean {
    if (this.detectReportedSpeechParaphrase(source)) {
      return false;
    }
    const stripped = this.stripReportedSpeechParaphrase(source);
    return /\b(help me|help us|can you|could you|would you|please|patch|fix|build|inspect|write|implement|look at|audit|review|lay out|give me)\b/i.test(stripped);
  }

  private scoreClause(clause: string): {
    clause: string;
    repairScore: number;
    questionScore: number;
    taskScore: number;
    disclosureScore: number;
    companionshipScore: number;
  } {
    const lower = clause.toLowerCase();
    const reportedSpeechParaphrase = this.detectReportedSpeechParaphrase(clause);
    const repairScore =
      (this.detectRepairLike(lower) ? 4 : 0)
      + (/\b(answer|asked|subject|topic|frame|dodging|deflecting|coherent|thread|missed|wrong)\b/.test(lower) ? 1 : 0);
    let questionScore =
      (/\?/.test(clause) ? 2 : 0)
      + (/^(?:was|is|are|do|did|can|could|would|why|what|how|when|where|which|who)\b/i.test(clause) ? 2 : 0)
      + (/\b(can you|are you|do you|did you|was it|is it|does it|should we|would it|whether)\b/.test(lower) ? 2 : 0);
    let taskScore =
      (/\b(help me|patch|write|fix|build|make|implement|debug|update|refactor|inspect|look at|audit|review|lay out|give me)\b/.test(lower) ? 3 : 0)
      + (/^(?:please\s+)?(?:help|fix|build|write|patch|implement|make|update|refactor|inspect|audit|review|lay out|give me)\b/i.test(clause) ? 2 : 0);
    const disclosureScore =
      (/\b(i feel|i'm discouraged|i am discouraged|i'm excited|i am excited|it's hard|i'm tired|i am tired|i don't know if this will work|i hate this|i'm grieving|i am grieving|i was worried)\b/.test(lower) ? 3 : 0)
      + (/\b(i'm|i am|i was)\b/.test(lower) ? 1 : 0);
    let companionshipScore =
      (/\b(just walking|just hanging out|just chat|just talking|with me|with you|are you with me|stay with me|be here|together|i'm just outside|we're just talking|keep me company)\b/.test(lower) ? 2 : 0)
      + (/\b(we can just|just be|just chat)\b/.test(lower) ? 1 : 0);
    if (reportedSpeechParaphrase) {
      taskScore = Math.max(0, taskScore - 4);
      questionScore = Math.max(0, questionScore - 2);
      companionshipScore += 2;
    }
    return { clause, repairScore, questionScore, taskScore, disclosureScore, companionshipScore };
  }

  private determineIntents(
    source: string,
    routeType: DoctrineTurnSchema['turnType'],
  ): {
    primaryIntent: NonNullable<RouterTargetSpec['primaryIntent']>;
    secondaryIntent: NonNullable<RouterTargetSpec['secondaryIntent']>;
    arbitrationReason: string;
    bestClause: string;
  } {
    const normalizedSource = this.stripDiscourseScaffolding(this.normalizeForExtraction(source));
    const sourceIsReportedSpeechParaphrase = this.detectReportedSpeechParaphrase(normalizedSource);
    const clauses = this.splitClauses(normalizedSource).map(clause => this.stripDiscourseScaffolding(clause)).filter(Boolean);
    const clauseScores = clauses.map(clause => this.scoreClause(clause));
    const totals = clauseScores.reduce(
      (acc, entry) => {
        acc.repair += entry.repairScore;
        acc.question += entry.questionScore;
        acc.task += entry.taskScore;
        acc.disclosure += entry.disclosureScore;
        acc.companionship += entry.companionshipScore;
        return acc;
      },
      { repair: 0, question: 0, task: 0, disclosure: 0, companionship: 0 },
    );
    const intents: Array<{ name: NonNullable<RouterTargetSpec['primaryIntent']>; score: number }> = [
      { name: 'repair', score: totals.repair },
      { name: 'task', score: totals.task },
      { name: 'question', score: totals.question },
      { name: 'disclosure', score: totals.disclosure },
      { name: 'companionship', score: totals.companionship },
    ];

    let primaryIntent: NonNullable<RouterTargetSpec['primaryIntent']>;
    if (clauseScores.some(entry => entry.repairScore >= 2)) {
      primaryIntent = 'repair';
    } else if (clauseScores.some(entry => entry.taskScore >= 2 && /\b(help me|patch|fix|build|write|inspect|make|implement|look at|audit|review|lay out|give me)\b/.test(entry.clause.toLowerCase()))) {
      primaryIntent = 'task';
    } else if (clauseScores.some(entry => entry.questionScore >= 2)) {
      primaryIntent = 'question';
    } else if (totals.disclosure >= totals.companionship) {
      primaryIntent = 'disclosure';
    } else {
      primaryIntent = 'companionship';
    }

    if (routeType === 'repair') primaryIntent = 'repair';
    else if (routeType === 'task' && primaryIntent !== 'repair') primaryIntent = 'task';
    else if (routeType === 'direct_answer' && !['repair', 'task'].includes(primaryIntent)) primaryIntent = 'question';

    const hasExplicitImperativeRequest = this.hasExplicitImperativeRequest(normalizedSource);
    if (primaryIntent === 'task' && routeType === 'companionship' && !hasExplicitImperativeRequest) {
      primaryIntent = totals.disclosure > totals.companionship ? 'disclosure' : 'companionship';
    }

    if (sourceIsReportedSpeechParaphrase && routeType === 'companionship' && !hasExplicitImperativeRequest) {
      primaryIntent = totals.disclosure > totals.companionship ? 'disclosure' : 'companionship';
    }

    let secondaryIntent: NonNullable<RouterTargetSpec['secondaryIntent']> = intents
      .filter(entry => entry.name !== primaryIntent && entry.score > 0)
      .sort((a, b) => b.score - a.score)[0]?.name || 'none';

    if (sourceIsReportedSpeechParaphrase && routeType === 'companionship' && !hasExplicitImperativeRequest) {
      secondaryIntent = 'none';
    }

    let arbitrationReason = `${primaryIntent} won by clause score`;
    if (primaryIntent === 'repair' && secondaryIntent === 'question') {
      arbitrationReason = 'repair outranked question due to explicit answer-failure language';
    } else if (primaryIntent === 'task') {
      arbitrationReason = 'task outranked side commentary due to explicit imperative request';
    } else if (primaryIntent === 'question' && secondaryIntent === 'disclosure') {
      arbitrationReason = 'question outranked disclosure due to explicit answerable ask';
    } else if (primaryIntent === 'question') {
      arbitrationReason = 'question outranked disclosure/companionship due to explicit answerable ask';
    } else if (primaryIntent === 'disclosure') {
      arbitrationReason = 'disclosure dominated and no stronger task/question/repair signal was present';
    } else if (primaryIntent === 'companionship') {
      arbitrationReason = 'companionship dominated and no stronger task/question/repair signal was present';
    } else if (routeType === 'repair') {
      arbitrationReason = 'repair route forced by explicit correction signal';
    }

    if (sourceIsReportedSpeechParaphrase && routeType === 'companionship' && !hasExplicitImperativeRequest) {
      arbitrationReason = 'reported-speech reflection did not contain an explicit imperative request';
    }

    const relevantScoreField =
      primaryIntent === 'repair' ? 'repairScore'
      : primaryIntent === 'task' ? 'taskScore'
      : primaryIntent === 'question' ? 'questionScore'
      : primaryIntent === 'disclosure' ? 'disclosureScore'
      : 'companionshipScore';
    const sorted = [...clauseScores].sort((a, b) => (b[relevantScoreField] as number) - (a[relevantScoreField] as number));
    let bestClause = sorted[0]?.clause || this.stripDiscourseScaffolding(this.normalizeForExtraction(source));
    if (
      bestClause
      && /^(?:i mean|well|you know|honestly|like|i don'?t know)$/i.test(bestClause)
      && sorted[1]
      && (sorted[1][relevantScoreField] as number) >= ((sorted[0][relevantScoreField] as number) + 1)
    ) {
      bestClause = sorted[1].clause;
    }

    if (sourceIsReportedSpeechParaphrase && routeType === 'companionship' && !hasExplicitImperativeRequest) {
      bestClause = normalizedSource;
    }

    return {
      primaryIntent,
      secondaryIntent,
      arbitrationReason,
      bestClause,
    };
  }

  private buildTargetSpec(
    source: string,
    turnType: DoctrineTurnSchema['turnType'],
    continuity?: Partial<RouterContinuityState>,
  ): RouterTargetSpec {
    const rawUserTurn = source.trim();
    const normalized = this.stripDiscourseScaffolding(this.normalizeForExtraction(rawUserTurn));
    const reportedSpeechParaphrase = this.detectReportedSpeechParaphrase(normalized);
    const directUserProhibition = this.detectDirectUserProhibition(normalized.toLowerCase());
    const intentState = this.determineIntents(normalized, turnType);
    const questionClause = this.extractQuestionClause(normalized);
    const repairObject = turnType === 'repair' ? this.extractRepairObject(normalized) : null;
    let mustAnswer = intentState.bestClause || normalized;
    if (intentState.primaryIntent === 'repair') {
      if (directUserProhibition && /\b(?:don't|dont)\s+repeat me\b/i.test(normalized)) {
        mustAnswer = "acknowledge the repetition and stop repeating the user";
      } else if (directUserProhibition) {
        mustAnswer = 'acknowledge the user\'s prohibition and stop the behavior';
      } else if (repairObject === 'failed to answer direct question') {
        mustAnswer = 'address the miss and answer what was asked';
      } else if (repairObject === 'stale topic drift') {
        mustAnswer = 'return to the previous question or topic';
      } else if (repairObject === 'deflection instead of direct answer') {
        mustAnswer = 'stop deflecting and answer directly';
      } else if (repairObject === 'wrong frame') {
        mustAnswer = 'repair the framing and answer coherently';
      } else if (repairObject === 'misread user meaning') {
        mustAnswer = 'correct the misunderstanding and stay with the user meaning';
      }
    } else if (intentState.primaryIntent === 'question' && questionClause) {
      mustAnswer = questionClause;
    } else if (intentState.primaryIntent === 'task') {
      mustAnswer = intentState.bestClause
        .replace(/^(?:but\s+)?when i get back\s+/i, '')
        .replace(/^(?:but\s+)?when we get back\s+/i, '')
        .replace(/^(?:but\s+)?once i get back\s+/i, '')
        .replace(/^(?:but\s+)?once we get back\s+/i, '')
        .replace(/^(?:can you|could you|would you|please)\s+/i, '')
        .replace(/^(?:help me|help us)\s+/i, 'help ')
        .trim();
    } else if (intentState.primaryIntent === 'disclosure') {
      if (/\b(exhausted|worn out|tired|hard|discouraged|worried|grieving|hate this)\b/i.test(normalized)) {
        mustAnswer = 'respond to the user\'s exhaustion and difficulty';
      } else {
        mustAnswer = 'respond to the user\'s emotional state directly';
      }
    } else if (intentState.primaryIntent === 'companionship') {
      mustAnswer = reportedSpeechParaphrase
        ? "respond to the user's reflection on what the assistant is expressing"
        : 'stay with the user in light companionship';
    }

    if (reportedSpeechParaphrase && mustAnswer === normalized) {
      mustAnswer = "respond to the user's reflection on what the assistant is expressing";
    }

    let liveTopic = this.inferLiveTopic(normalized, continuity);
    if (reportedSpeechParaphrase && (!liveTopic || liveTopic === normalized || /^you(?:'re| are) basically saying/.test(liveTopic))) {
      liveTopic = 'user reflection on assistant meaning';
    }
    const questionForm = intentState.primaryIntent === 'question'
      ? this.inferQuestionForm(normalized, mustAnswer)
      : 'none';
    const mixedIntent = intentState.secondaryIntent !== 'none';

    return {
      rawUserTurn,
      mustAnswer,
      liveTopic,
      userGoal: this.inferUserGoal(turnType, normalized, mustAnswer),
      repairObject: repairObject || undefined,
      questionForm,
      mixedIntent,
      primaryIntent: intentState.primaryIntent,
      secondaryIntent: intentState.secondaryIntent,
      arbitrationReason: intentState.arbitrationReason,
      confidence: turnType === 'companionship' ? 0.6 : 0.78,
    };
  }

  private buildSchema(
    turnType: DoctrineTurnSchema['turnType'],
    targetSpec: RouterTargetSpec,
    doctrineModes: DoctrineTurnSchema['doctrineModes'],
    tone: DoctrineTurnSchema['tone'],
    length: DoctrineTurnSchema['length'],
    askAllowed: boolean,
    answerFirst: boolean,
    continuityRequired: boolean,
    dangerFlags: RouterDangerFlag[],
  ): DoctrineTurnSchema {
    return {
      turnType,
      target: targetSpec.mustAnswer,
      targetSpec,
      doctrineModes,
      tone,
      length,
      askAllowed,
      answerFirst,
      continuityRequired,
      dangerFlags,
    };
  }
}
