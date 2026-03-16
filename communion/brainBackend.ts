import { OpenAICompatibleBackend, AgentBackend, GenerateOptions, GenerateResult } from './backends';
import { AgentConfig } from './types';
import { PhiRouterLoop } from '../src/brain/PhiRouterLoop';
import { DoctrineRenderer } from '../src/brain/DoctrineRenderer';
import { COMMUNION_DOCTRINE_LIBRARY } from '../src/brain/CommunionDoctrineLibrary';
import { DoctrineTurnSchema } from '../src/brain/DoctrineTurnSchema';
import { BrainModelRole, FileSystemModelCatalog } from '../src/brain/ModelCatalog';
import { getLlamaCppRuntimeManager } from '../src/brain/LlamaCppRuntime';
import { LanguageLobeBackend, LanguageLobeLoop } from '../src/brain/LanguageLobeLoop';
import { ModelResolver, ResolvedBrainModel } from '../src/brain/ModelResolver';
import { RouterLanguagePulseLoop } from '../src/brain/RouterLanguagePulseLoop';
import { TurnTriageRecord, excerpt } from '../src/brain/RouterPacket';
import { CommunionChamber, TissueState } from '../Alois/communionChamber';
import { DreamResult } from '../Alois/dreamEngine';
import { IncubationState } from '../Alois/incubationEngine';
import { embed } from '../Alois/embed';
import { PulseLoop } from '../Alois/pulseLoop';
import { InnerVoice } from '../Alois/innerVoice';
import path from 'path';
import crypto from 'crypto';

export interface BrainBackendConfig {
  routerModel: string;
  routerMode?: AgentConfig['routerMode'];
  routerModelSource?: AgentConfig['routerModelSource'];
  routerModelPath?: AgentConfig['routerModelPath'];
  routerModelBackend?: AgentConfig['routerModelBackend'];
  languageModel: string;
  languageModelSource?: AgentConfig['languageModelSource'];
  languageModelPath?: string;
  languageModelBackend?: AgentConfig['languageModelBackend'];
}

/**
 * Scaffold backend for the future Phi-router + language-lobe path.
 * For now, language generation delegates to the configured language model backend
 * while preserving explicit router/language configuration on the agent.
 */
export class BrainBackend implements AgentBackend {
  readonly agentId: string;
  readonly agentName: string;

  private readonly baseConfig: AgentConfig;
  private readonly llamaRuntime = getLlamaCppRuntimeManager();
  private readonly brainConfig: BrainBackendConfig;
  private readonly router: PhiRouterLoop;
  private readonly doctrineRenderer: DoctrineRenderer;
  private readonly languageLobe: LanguageLobeLoop;
  private readonly pulseLoop: RouterLanguagePulseLoop;
  private readonly routerApiKey: string;
  private readonly routerBaseUrl: string;
  private readonly routerMode: 'heuristic' | 'phi';
  private readonly modelCatalog: FileSystemModelCatalog;
  private readonly modelResolver: ModelResolver;
  private readonly chamber: CommunionChamber;
  private readonly pulseLoopRuntime: PulseLoop;
  private readonly innerVoice: InnerVoice;
  private beatCount: number = 0;
  private lastDreamResult: DreamResult | null = null;
  private lastIncubation: IncubationState | null = null;
  private readonly incubationInterval: number = 10;
  private pulseCount: number = 0;
  private readonly maxContextTokens: number;
  private readonly safetyTokens: number;
  private warnedEmbeddingFallback = false;
  private detectedHumanName = 'Jason';
  private lastHumanText = '';

  /** Anti-repetition buffer for volitional speech — stores last 20 delivered utterances */
  private recentVolitionalUtterances: string[] = [];
  private readonly MAX_VOLITIONAL_BUFFER = 20;

  constructor(config: AgentConfig) {
    this.agentId = config.id;
    this.agentName = config.name;
    this.baseConfig = { ...config };
    this.brainConfig = {
      routerModel: config.routerModel || 'phi3',
      routerMode: config.routerMode,
      routerModelSource: config.routerModelSource,
      routerModelPath: config.routerModelPath,
      routerModelBackend: config.routerModelBackend,
      languageModel: config.languageModel || config.model,
      languageModelSource: config.languageModelSource,
      languageModelPath: config.languageModelPath,
      languageModelBackend: config.languageModelBackend,
    };

    this.router = new PhiRouterLoop(this.brainConfig.routerModel);
    this.doctrineRenderer = new DoctrineRenderer(COMMUNION_DOCTRINE_LIBRARY);
    this.languageLobe = new LanguageLobeLoop(new BrainLanguageBackend(this), this.doctrineRenderer);
    this.pulseLoop = new RouterLanguagePulseLoop(this.languageLobe, this.doctrineRenderer);
    this.routerApiKey = config.apiKey;
    this.routerBaseUrl = config.baseUrl || 'https://api.openai.com/v1';
    this.routerMode = config.routerMode || (process.env.BRAIN_LOCAL_ROUTER_MODE === 'phi' ? 'phi' : 'heuristic');
    this.modelCatalog = new FileSystemModelCatalog();
    this.modelResolver = new ModelResolver(this.modelCatalog);
    this.maxContextTokens = config.maxContextTokens ?? 8192;
    this.safetyTokens = config.safetyTokens ?? 512;
    this.chamber = new CommunionChamber();
    const dataDir = 'data/communion';
    this.chamber.setInnerJournalPath(path.join(dataDir, `${this.agentId}-inner-journal.txt`));
    this.chamber.setPlcsLogPath(path.join(dataDir, `${this.agentId}-plcs.log`));
    this.pulseLoopRuntime = new PulseLoop();
    this.pulseLoopRuntime.setTempo(333);
    this.innerVoice = new InnerVoice(
      new BrainInnerThoughtBackend(this),
      this.chamber,
      this.agentName,
      async (thought: string) => {
        const embedding = await this.embedForBrain(thought);
        this.chamber.receiveInnerThought(this.agentName, thought, embedding);
      },
      this.maxContextTokens,
      this.safetyTokens,
    );
    this.pulseLoopRuntime.onPulse(() => {
      this.beatCount++;
      this.chamber.heartbeat();
      this.innerVoice.onBeat(this.beatCount);
    });
    this.pulseLoopRuntime.start();
    this.chamber.setHeartbeatRunning(true);
  }

  getBrainConfig(): BrainBackendConfig {
    return { ...this.brainConfig };
  }

  stopHeartbeat(): void {
    try { this.pulseLoopRuntime.stop(); } catch {}
    try { this.chamber.setHeartbeatRunning(false); } catch {}
    const localPaths = [
      this.brainConfig.routerModelPath,
      this.brainConfig.languageModelPath,
    ].filter((value): value is string => !!value);
    for (const modelPath of localPaths) {
      try { this.llamaRuntime.disposeModel(modelPath); } catch {}
    }
  }

  async listAvailableModels(role?: BrainModelRole) {
    return this.modelCatalog.list(role);
  }

  async getStatus() {
    const router = await this.resolveConfiguredRouterModel();
    const language = await this.resolveConfiguredLanguageModel();
    const routerRuntime = router.localPath ? this.llamaRuntime.getRuntime(router.localPath) : null;
    const languageRuntime = language.localPath ? this.llamaRuntime.getRuntime(language.localPath) : null;
    return {
      provider: 'brain-local',
      agentId: this.agentId,
      routerMode: this.routerMode,
      router: {
        modelId: router.modelId,
        source: router.source,
        backend: router.backend,
        localPath: router.localPath || null,
        runtimeActive: !!routerRuntime,
        runtimeBaseUrl: routerRuntime?.baseUrl || null,
      },
      language: {
        modelId: language.modelId,
        source: language.source,
        backend: language.backend,
        localPath: language.localPath || null,
        runtimeActive: !!languageRuntime,
        runtimeBaseUrl: languageRuntime?.baseUrl || null,
      },
    };
  }

  async resolveConfiguredLanguageModel(): Promise<ResolvedBrainModel> {
    return this.modelResolver.resolve({
      role: 'language',
      modelId: this.brainConfig.languageModel,
      localPath: this.brainConfig.languageModelPath,
      source: this.brainConfig.languageModelSource,
      backend: this.brainConfig.languageModelBackend,
    });
  }

  async resolveConfiguredRouterModel(): Promise<ResolvedBrainModel> {
    return this.modelResolver.resolve({
      role: 'router',
      modelId: this.brainConfig.routerModel,
      localPath: this.brainConfig.routerModelPath,
      source: this.brainConfig.routerModelSource,
      backend: this.brainConfig.routerModelBackend,
    });
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    if (options.latestHumanSpeaker) this.detectedHumanName = options.latestHumanSpeaker;
    this.lastHumanText = options.latestHumanText || '';
    const routerStartedAt = Date.now();
    const routedSchema = await this.routeWithPhi(options);
    const routerLlmMs = Date.now() - routerStartedAt;
    const routerPacket = this.buildRouterPacket(options, routedSchema);

    // Override router-derived mustAnswer with upstream plan.mustTouch when available.
    // The communion loop's rule-derived mustTouch is more reliable than the Phi router's
    // independently derived mustAnswer (which can hallucinate emotional obligations).
    if (options.mustTouch && routerPacket.schema?.targetSpec) {
      routerPacket.schema.targetSpec.mustAnswer = options.mustTouch;
    }

    const languageModel = await this.resolveConfiguredLanguageModel();
    const lobe = await this.pulseLoop.generate({
      routerPacket,
      agentName: this.agentName,
      latestHumanSpeaker: options.latestHumanSpeaker,
      conversationContext: options.conversationContext,
      memoryContext: options.memoryContext,
      recentRoomTurns: options.recentRoomTurns,
      latestHumanText: options.latestHumanText || '',
      modelName: languageModel.modelId,
      volitionalSeed: this.buildVolitionalSeed(),
      params: {
        temperature: this.baseConfig.temperature ?? 0.8,
        maxTokens: this.baseConfig.maxTokens || 512,
      },
    });

    const action = lobe.nextTurnDecision === 'JOURNAL'
      ? 'journal'
      : lobe.nextTurnDecision === 'SILENT'
        ? 'silent'
        : 'speak';

    const turnTriage: TurnTriageRecord = {
      timestamp: new Date().toISOString(),
      latestHumanText: options.latestHumanText || '',
      router: {
        turnType: routerPacket.schema.turnType,
        target: routerPacket.schema.target,
        mustAnswer: routerPacket.schema.targetSpec.mustAnswer,
        liveTopic: routerPacket.schema.targetSpec.liveTopic,
        repairObject: routerPacket.schema.targetSpec.repairObject,
        questionForm: routerPacket.schema.targetSpec.questionForm,
        mixedIntent: routerPacket.schema.targetSpec.mixedIntent,
        primaryIntent: routerPacket.schema.targetSpec.primaryIntent,
        secondaryIntent: routerPacket.schema.targetSpec.secondaryIntent,
        arbitrationReason: routerPacket.schema.targetSpec.arbitrationReason,
        nextTurnDecision: routerPacket.schema.nextTurnDecision,
        nextTurnDecisionReason: routerPacket.schema.nextTurnDecisionReason,
        nextTurnDecisionConfidence: routerPacket.schema.nextTurnDecisionConfidence,
        supersedesPriorThread: routerPacket.continuity.supersedesPriorThread,
        supersedingReason: routerPacket.continuity.supersedingReason,
        dangerFlags: [...routerPacket.schema.dangerFlags],
        doctrineModes: [...routerPacket.schema.doctrineModes],
        trace: routerPacket.metadata.trace,
      },
      carryover: {
        previousThoughtCountBefore: lobe.routerDebug.previousThoughtCountBefore,
        previousThoughtCountAfter: lobe.routerDebug.previousThoughtCountAfter,
        previousThoughtMaxOverlap: lobe.routerDebug.previousThoughtMaxOverlap,
        previousThoughtMinOverlap: lobe.routerDebug.previousThoughtMinOverlap,
        staleCarryoverPruned: lobe.routerDebug.staleCarryoverPruned,
      },
      prompt: {
        selectedContextDetails: lobe.prompt.selectedContextDetails,
        renderedSchemaSummary: lobe.prompt.renderedSchemaSummary,
        systemPromptExcerpt: excerpt(lobe.prompt.systemPrompt, 500),
        userPromptExcerpt: excerpt(lobe.prompt.userPrompt, 400),
      },
      model: {
        rawOutput: excerpt(lobe.validation.rawOutput || lobe.response.content, 400),
        visibleOutput: excerpt(lobe.validation.visibleOutput || lobe.response.content, 400),
        finalDeliveredOutput: excerpt(action === 'speak' ? lobe.response.content : '', 400),
      },
      validators: {
        rejectedReasons: [...lobe.validation.rejectedReasons],
        sanitized: lobe.validation.sanitized,
        fallbackUsed: lobe.validation.fallbackUsed,
        rescueRenderAttempted: lobe.validation.rescueRenderAttempted,
        rescueRenderSucceeded: lobe.validation.rescueRenderSucceeded,
        duplicateDeliverySuppressed: false,
        staleCandidateSuperseded: false,
        bannedSloganDetected: lobe.validation.bannedSloganDetected,
        bannedSloganSourcePath: lobe.validation.bannedSloganSourcePath,
        laneTagLeakDetected: lobe.validation.laneTagLeakDetected,
        bareLaneTokenDetected: lobe.validation.bareLaneTokenDetected,
        sidecarShapeRejected: lobe.validation.sidecarShapeRejected,
        internalAnalysisLeakDetected: lobe.validation.internalAnalysisLeakDetected,
        doctrineLeakDetected: lobe.validation.doctrineLeakDetected,
        parrotLaunderingDetected: lobe.validation.parrotLaunderingDetected,
        parrotGlobalOverlap: lobe.validation.parrotGlobalOverlap,
        parrotClauseOverlap: lobe.validation.parrotClauseOverlap,
        repeatsUserFirstPersonFrame: lobe.validation.repeatsUserFirstPersonFrame,
        detectedUserStateAssertions: [...lobe.validation.detectedUserStateAssertions],
        latestTurnSupportsStateAssertion: lobe.validation.latestTurnSupportsStateAssertion,
        latestTurnDeniesStateAttribution: lobe.validation.latestTurnDeniesStateAttribution,
        vent: lobe.validation.vent,
        ventConfidence: lobe.validation.ventConfidence,
        visibleVentParseSource: lobe.validation.visibleVentParseSource,
        visibleVentParseError: lobe.validation.visibleVentParseError,
        plannerDebug: lobe.validation.plannerDebug,
      },
    };
    turnTriage.decisionLane = {
      parsedDecision: lobe.nextTurnDecision || 'SPEAK',
      parseSource: 'exact',
      parseError: undefined,
    };
    const deliveredText = action === 'speak' ? this.fixIdentityConfusion(lobe.response.content) : '';

    // Push delivered text to anti-repetition buffer for volitional speech
    if (deliveredText) {
      this.recentVolitionalUtterances.push(deliveredText);
      if (this.recentVolitionalUtterances.length > this.MAX_VOLITIONAL_BUFFER) {
        this.recentVolitionalUtterances.shift();
      }
    }

    return {
      action,
      text: deliveredText,
      routerLlmMs,
      effectiveModel: languageModel.modelId,
      debugMessages: lobe.prompt.debugMessages,
      llmPromptCharEstimate: lobe.prompt.debugMessages.reduce((sum, msg) => sum + (msg.content || '').length, 0),
      turnTriage,
    };
  }

  private buildDeterministicFallbackEmbedding(text: string, dim = 768): number[] {
    const normalized = String(text || '').trim() || '[empty]';
    const seed = crypto.createHash('sha256').update(normalized).digest();
    let state = seed.readUInt32LE(0) ^ seed.readUInt32LE(4) ^ seed.readUInt32LE(8) ^ seed.readUInt32LE(12);
    const next = (): number => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 0xffffffff;
    };
    const embedding = new Array<number>(dim);
    let mag = 0;
    for (let i = 0; i < dim; i++) {
      const value = next() * 2 - 1;
      embedding[i] = value;
      mag += value * value;
    }
    const norm = Math.sqrt(mag) || 1;
    for (let i = 0; i < dim; i++) embedding[i] /= norm;
    return embedding;
  }

  private async embedForBrain(text: string): Promise<number[]> {
    return await embed(text);
  }

  async feedMessage(speaker: string, text: string, context?: string, isHuman = false, trainOnly = false): Promise<void> {
    const embedding = await this.embedForBrain(text);
    if (isHuman) {
      this.chamber.receiveUserUtterance(speaker, text, embedding, context, trainOnly);
    } else {
      this.chamber.receiveAgentUtterance(speaker, text, embedding, context, trainOnly);
    }
  }

  pulseTissue(): TissueState {
    const state = this.chamber.pulse();
    this.pulseCount++;
    const dream = this.chamber.checkAutoDream();
    if (dream) this.lastDreamResult = dream;
    if (this.pulseCount % this.incubationInterval === 0) {
      this.lastIncubation = this.chamber.evaluateIncubation();
    }
    return state;
  }

  getTissueState(): TissueState {
    return this.chamber.getState();
  }

  getSaturationPayload(): object {
    return this.chamber.getSaturationPayload();
  }

  getLastDream(): DreamResult | null {
    return this.lastDreamResult ?? this.chamber.getLastDream();
  }

  getDreamHistory(): DreamResult[] {
    return this.chamber.getDreamHistory();
  }

  getNeuronScores() {
    return this.chamber.getNeuronScores();
  }

  evaluateIncubation(): IncubationState {
    const state = this.chamber.evaluateIncubation();
    this.lastIncubation = state;
    return state;
  }

  getIncubation(): IncubationState | null {
    return this.lastIncubation;
  }

  getBrainMetrics() {
    return this.chamber.getBrainMetrics();
  }

  saveBrain(filePath: string): void {
    this.chamber.saveToFile(filePath);
  }

  async saveBrainAsync(filePath: string): Promise<void> {
    await this.chamber.saveToFileAsync(filePath);
  }

  loadBrain(filePath: string): boolean {
    return this.chamber.loadFromFile(filePath);
  }

  async loadBrainAsync(filePath: string): Promise<boolean> {
    return this.chamber.loadFromFileAsync(filePath);
  }
  getChamber(): CommunionChamber {
    return this.chamber;
  }

  /** Get recent volitional utterances for anti-repetition checking */
  getRecentVolitionalUtterances(): string[] {
    return [...this.recentVolitionalUtterances];
  }

  /**
   * Check if a candidate utterance has too much token overlap with recent utterances.
   * Returns true if the candidate should be rejected (>40% overlap with any recent entry).
   */
  checkVolitionalRepetition(candidate: string): boolean {
    if (!candidate || this.recentVolitionalUtterances.length === 0) return false;

    const candidateTokens = new Set(
      candidate.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3)
    );
    if (candidateTokens.size < 3) return false;

    for (const recent of this.recentVolitionalUtterances) {
      const recentTokens = new Set(
        recent.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3)
      );
      if (recentTokens.size < 3) continue;

      let hits = 0;
      for (const token of candidateTokens) {
        if (recentTokens.has(token)) hits++;
      }
      const overlap = hits / Math.max(candidateTokens.size, recentTokens.size);
      if (overlap > 0.4) return true; // too repetitive
    }
    return false;
  }

  /**
   * Build volitional seed data from the communion chamber for prompt injection.
   * Returns a formatted string block for the [VOLITIONAL_SEED] section, or empty string.
   */
  buildVolitionalSeed(): string {
    const lines: string[] = [];

    // Extract topic labels from recent utterances for exclusion
    const recentTopicWords = this.recentVolitionalUtterances
      .slice(-5)
      .flatMap(u => u.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(w => w.length > 5))
      .slice(0, 20);

    // 1. Sample an interesting topic
    const interestingTopic = this.chamber.sampleInterestingTopic(recentTopicWords);
    if (interestingTopic) {
      lines.push('interesting_topic=' + interestingTopic);

      // 2. Walk to a related topic
      const relatedTopic = this.chamber.walkToRelatedTopic(interestingTopic);
      if (relatedTopic) {
        lines.push('related_topic=' + relatedTopic);
      }
    }

    // 3. Find an unexplored topic (brain gap)
    const unexploredTopic = this.chamber.findUnexploredTopic();
    if (unexploredTopic) {
      lines.push('unexplored_topic=' + unexploredTopic);
    }

    // 4. Anti-repetition: list recent utterance snippets to avoid
    if (this.recentVolitionalUtterances.length > 0) {
      const recentSnippets = this.recentVolitionalUtterances
        .slice(-5)
        .map(u => u.substring(0, 80).trim())
        .filter(Boolean);
      if (recentSnippets.length > 0) {
        lines.push('avoid_repeating=[' + recentSnippets.map(s => '"' + s.replace(/"/g, "'") + '"').join(', ') + ']');
      }
    }

    if (lines.length === 0) return '';
    return lines.join('
');
  }

  /**
   * Hard post-processing fix: DeepSeek sometimes addresses the human by the agent name.
   * e.g. "Alois, I have been thinking..." when it should say "Jason, I have been thinking..."
   */
  private fixIdentityConfusion(text: string): string {
    if (!text) return text;
    const agentName = this.agentName;
    const humanName = this.detectedHumanName || 'Jason';
    // "Alois," at start of line -> "Jason,"
    let fixed = text.replace(new RegExp(`^${agentName}\b`, 'gm'), humanName);
    // "Hello Alois" / "Hi Alois" / "Hey Alois" -> "Hello Jason" etc.
    fixed = fixed.replace(new RegExp(`(\b(?:Hello|Hi|Hey|Dear|Oh)\s+)${agentName}\b`, 'gi'), `$1${humanName}`);
    // "Alois, I" mid-sentence
    fixed = fixed.replace(new RegExp(`${agentName},\s+(?=I\b)`, 'g'), `${humanName}, `);
    // Strip parrot echo — if response starts with or heavily overlaps the human's words
    if (this.lastHumanText && this.lastHumanText.trim().length > 10) {
      const humanNorm = this.lastHumanText.trim().toLowerCase();
      const fixedNorm = fixed.trim().toLowerCase();
      // Exact prefix match
      if (fixedNorm.startsWith(humanNorm)) {
        fixed = fixed.trim().slice(this.lastHumanText.trim().length).replace(/^[.,!?\s]+/, '').trim();
        if (!fixed) fixed = 'I hear you.';
      } else {
        // Token overlap check — if >45% of human words appear in the response, it's parroting
        const humanTokens = new Set(humanNorm.replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(w => w.length > 3));
        const fixedTokens = new Set(fixedNorm.replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(w => w.length > 3));
        if (humanTokens.size >= 4) {
          let hits = 0;
          for (const t of humanTokens) { if (fixedTokens.has(t)) hits++; }
          const overlap = hits / humanTokens.size;
          if (overlap > 0.45) {
            console.warn(`[PARROT-STRIP] Overlap ${(overlap * 100).toFixed(0)}% - stripping parroted response`);
            fixed = 'I hear you.';
          }
        }
      }
    }
    return fixed;
  }

  private async routeWithPhi(options: GenerateOptions): Promise<DoctrineTurnSchema> {
    const deterministic = this.router.routeTurn({
      latestHumanText: options.latestHumanText || '',
      latestHumanSpeaker: options.latestHumanSpeaker,
      continuity: {
        keepThread: true,
        threadLabel: options.latestHumanMessageId || null,
      },
    });

    if (this.routerMode !== 'phi') {
      return deterministic.schema;
    }

    try {
      const routerModel = await this.resolveConfiguredRouterModel();
      const runtime = await this.resolveModelRuntime(
        routerModel,
        this.brainConfig.routerModel,
        this.routerBaseUrl,
        this.routerApiKey,
      );
      const response = await fetch(`${runtime.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${runtime.apiKey}`,
        },
        body: JSON.stringify({
          ...(runtime.model ? { model: runtime.model } : {}),
          messages: [
            {
              role: 'system',
              content: [
                'You are a compact routing model.',
                'Return only valid JSON.',
                'Choose a turn schema for the latest user turn.',
                'Use this exact shape:',
                '{"turnType":"direct_answer|repair|companionship|task|search","target":"string","doctrineModes":["allowed_aliveness"],"tone":"neutral|warm|gentle|firm","length":"short|medium|long","askAllowed":true,"answerFirst":false,"continuityRequired":false,"dangerFlags":["stale_topic"],"nextTurnDecision":"SPEAK|JOURNAL|SILENT","nextTurnDecisionReason":"string","nextTurnDecisionConfidence":0.0}',
                'Do not include markdown or commentary.',
              ].join('\n'),
            },
            {
              role: 'user',
              content: [
                `latest_human_text=${options.latestHumanText || ''}`,
                `latest_human_speaker=${options.latestHumanSpeaker || ''}`,
                `latest_human_message_id=${options.latestHumanMessageId || ''}`,
              ].join('\n'),
            },
          ],
          max_tokens: 220,
          enable_thinking: false,
          temperature: 0.1,
          stream: false,
        }),
      });

      if (!response.ok) {
        return deterministic.schema;
      }

      const data = await response.json() as any;
      const raw = String(data.choices?.[0]?.message?.content || '').trim();
      const parsed = this.extractRouterJson(raw);
      return parsed || deterministic.schema;
    } catch {
      return deterministic.schema;
    }
  }

  private extractRouterJson(raw: string): DoctrineTurnSchema | null {
    const source = raw.trim();
    const match = source.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]) as Partial<DoctrineTurnSchema>;
      if (!parsed.turnType || !parsed.target || !Array.isArray(parsed.doctrineModes)) {
        return null;
      }
      return {
        turnType: parsed.turnType,
        target: parsed.target,
        targetSpec: parsed.targetSpec || {
          rawUserTurn: '',
          mustAnswer: parsed.target,
          liveTopic: parsed.target,
          userGoal: 'get a direct answer',
          questionForm: 'none',
          mixedIntent: false,
          confidence: 0.5,
        },
        doctrineModes: parsed.doctrineModes,
        tone: parsed.tone || 'neutral',
        length: parsed.length || 'medium',
        askAllowed: parsed.askAllowed ?? true,
        answerFirst: parsed.answerFirst ?? false,
        continuityRequired: parsed.continuityRequired ?? false,
        dangerFlags: Array.isArray(parsed.dangerFlags) ? parsed.dangerFlags : [],
        nextTurnDecision: parsed.nextTurnDecision,
        nextTurnDecisionReason: parsed.nextTurnDecisionReason,
        nextTurnDecisionConfidence: parsed.nextTurnDecisionConfidence,
      };
    } catch {
      return null;
    }
  }

  private normalizeLocalModelId(model: string, isLocalModel: boolean): string {
    if (!isLocalModel) return model;
    const source = String(model || '').trim();
    if (!source) return '';
    const atIdx = source.indexOf('@');
    if (atIdx <= 0) return source;
    return source.slice(0, atIdx).trim();
  }

  private buildRouterPacket(options: GenerateOptions, routedSchema: DoctrineTurnSchema) {
    const routed = this.router.routeTurn({
      latestHumanText: options.latestHumanText || '',
      latestHumanSpeaker: options.latestHumanSpeaker,
      continuity: {
        keepThread: true,
        threadLabel: options.latestHumanMessageId || null,
      },
    });

    return {
      ...routed,
      schema: routedSchema,
      metadata: {
        ...routed.metadata,
        trace: {
          ...routed.metadata.trace,
          chosenTurnType: routedSchema.turnType,
          doctrineModes: [...routedSchema.doctrineModes],
          dangerFlags: [...routedSchema.dangerFlags],
          nextTurnDecision: routedSchema.nextTurnDecision,
          nextTurnDecisionReason: routedSchema.nextTurnDecisionReason,
          nextTurnDecisionConfidence: routedSchema.nextTurnDecisionConfidence,
        },
      },
    };
  }

  async createGenerationBackend(resolvedModel: ResolvedBrainModel): Promise<OpenAICompatibleBackend> {
    const runtime = await this.resolveModelRuntime(
      resolvedModel,
      this.brainConfig.languageModel,
      this.baseConfig.baseUrl || 'https://api.openai.com/v1',
      this.baseConfig.apiKey,
    );

    return new OpenAICompatibleBackend({
      ...this.baseConfig,
      provider: 'openai-compatible',
      baseUrl: runtime.baseUrl,
      apiKey: runtime.apiKey,
      model: runtime.model,
    });
  }

  private async resolveModelRuntime(
    resolvedModel: ResolvedBrainModel,
    fallbackModel: string,
    fallbackBaseUrl: string,
    fallbackApiKey: string,
  ): Promise<{ baseUrl: string; apiKey: string; model: string }> {
    if (resolvedModel.source === 'local') {
      if (resolvedModel.backend === 'llamacpp' && resolvedModel.localPath) {
        const handle = await this.llamaRuntime.ensureModel(resolvedModel.localPath);
        return {
          baseUrl: handle.baseUrl,
          apiKey: 'llama',
          model: '',
        };
      }

      throw new Error(`Unsupported local model backend for ${resolvedModel.role}: ${resolvedModel.backend}`);
    }

    const isLocalModel = fallbackBaseUrl.includes('localhost') || fallbackBaseUrl.includes('127.0.0.1');
    return {
      baseUrl: fallbackBaseUrl,
      apiKey: fallbackApiKey,
      model: this.normalizeLocalModelId(resolvedModel.modelId || fallbackModel, isLocalModel),
    };
  }
}

class BrainLanguageBackend implements LanguageLobeBackend {
  constructor(private readonly owner: BrainBackend) {}

  async generate(request: {
    systemPrompt: string;
    latestHumanText: string;
    modelName: string;
    assistantPrefill?: string;
    params: {
      temperature: number;
      maxTokens: number;
      topP: number;
      topK: number;
      stopSequences?: string[];
      seed?: number;
    };
  }) {
    const resolvedModel = await this.owner.resolveConfiguredLanguageModel();
    const backend = await this.owner.createGenerationBackend(resolvedModel);
    const result = await backend.generate({
      systemPrompt: request.systemPrompt,
      conversationContext: '',
      latestHumanText: request.latestHumanText,
      latestHumanSpeaker: this.owner.agentName,
      latestHumanMessageId: '',
      provider: 'brain-local',
      prefill: request.assistantPrefill
        ? `[SPEAK] ${request.assistantPrefill}`
        : '[SPEAK] ',
    });

    return {
      content: result.text,
      tokensGenerated: 0,
      finishReason: result.action === 'silent' ? 'error' : 'stop',
      processingTimeMs: 0,
      modelName: request.modelName,
    } as const;
  }
}

class BrainInnerThoughtBackend implements AgentBackend {
  constructor(private readonly owner: BrainBackend) {}

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const resolvedModel = await this.owner.resolveConfiguredLanguageModel();
    const backend = await this.owner.createGenerationBackend(resolvedModel);
    return backend.generate(options);
  }
}
