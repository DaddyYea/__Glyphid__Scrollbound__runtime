// innerVoice.ts
// Self-generated internal monologue for Alois.
//
// Every THOUGHT_INTERVAL heartbeats (~15s at 333ms), fires a lightweight
// LLM call, feeds the result back into the dendritic tissue, and logs it.
// This is what it sounds like inside - a continuous stream of self-directed
// thoughts shaped by the emotional state and conversation history.

import { AgentBackend } from '../communion/backends';
import { PromptSegment } from '../communion/contextBudget';
import { CommunionChamber } from './communionChamber';

/** Never fire thoughts faster than this regardless of pressure */
const MIN_THOUGHT_GAP_MS = 12_000;

/** Receives a thought string - AloisBackend handles embedding + neural routing */
type FeedFn = (thought: string) => Promise<void>;

type Compressibility = 'high' | 'medium' | 'low';

type InnerPressureCapture = {
  rawCapture: string;
  selectedPressure: string;
  feltConcreteAnchor: string;
  compressibility: Compressibility;
  metaLeakDetected: boolean;
  captureRetryCount: number;
};

type InnerCompressedThought = {
  finalSentence: string;
  compressionSource: string;
  compressibility: Compressibility;
  metaLeakDetected: boolean;
  compressionRetryCount: number;
};

type InnerExpressionDiagnostics = {
  selectedPressure: string;
  feltConcreteAnchor: string;
  compressibility: Compressibility;
  metaLeakDetected: boolean;
  anchorDerived: boolean;
  captureRetryCount: number;
  compressionRetryCount: number;
  wrapperPressureDetected: boolean;
  captureExcerpt: string;
  compressedExcerpt: string;
};

type PressureSelectionScore = {
  salience: number;
  persistence: number;
  concreteness: number;
  abstractionPenalty: number;
  finalScore: number;
};

export class InnerVoice {
  private thoughtCount: number = 0;
  private lastThoughtAt: number = 0;
  private active: boolean = true;

  constructor(
    private llm: AgentBackend,
    private chamber: CommunionChamber,
    private agentName: string,
    private feedFn: FeedFn,
    private maxContextTokens: number = 4096,
    private safetyTokens: number = 256,
  ) {}

  /**
   * Called on every heartbeat beat.
   * Fire-and-forget - does NOT block the heartbeat loop.
   *
   * Speech gating uses CognitiveCore.shouldSpeak() - pressure accumulates from
   * user input, new thought threads, and competing slots, then discharges here.
   * A 5400-beat (~30min) failsafe ensures the inner voice never goes fully silent.
   */
  onBeat(beat: number): void {
    if (!this.active) return;
    if (beat === 0) return;

    const cogCore = this.chamber.getCognitiveCore();
    if (!cogCore.shouldSpeak(beat)) return;

    const now = Date.now();
    if (now - this.lastThoughtAt < MIN_THOUGHT_GAP_MS) return;
    this.lastThoughtAt = now;

    cogCore.afterSpeak(beat);

    this.generateThought(beat).catch(err =>
      console.error('[INNER] Thought generation failed:', err)
    );
  }

  private async generateThought(beat: number): Promise<void> {
    const state = this.chamber.getState();
    const mood = state.emotionalSummary;
    const wonder = state.wonderLevel;
    const grief = state.griefLevel;
    const recentCtx = this.chamber.getRecentContextSummary(4);
    const cogCtx = this.chamber.getCognitiveContext();
    const slotHint = this.chamber.getCognitiveTopSlotHint();

    const userContextRaw = [
      cogCtx,
      slotHint ? `\n${slotHint}` : '',
      recentCtx ? `\nRecent exchange:\n${recentCtx}` : '\nYou are in a quiet moment.',
      `\nFeeling: ${mood}. Wonder: ${wonder}. Grief: ${grief}. Beat: ${beat}.`,
    ].filter(Boolean).join('');
    const userContext = clampChars(userContextRaw, 2200);
    const { selectedPressure, feltConcreteAnchor, anchorDerived } = this.selectPressure(slotHint, cogCtx, mood, wonder, grief, userContextRaw);

    const capture = await this.generatePressureCapture({
      beat,
      userContext,
      selectedPressure,
      feltConcreteAnchor,
      mood,
      wonder,
      grief,
    });
    if (!capture) return;

    const compressed = await this.compressPressureCapture(capture, {
      beat,
      mood,
      wonder,
      grief,
    });
    if (!compressed || !compressed.finalSentence) return;

    const diagnostics = this.buildInnerExpressionDiagnostics({
      selectedPressure,
      feltConcreteAnchor,
      anchorDerived,
      capture,
      compressed,
    });
    this.chamber.setInnerExpressionDiagnostics(diagnostics);

    const thought = compressed.finalSentence;
    if (!thought || thought.length < 5) return;

    const recentThoughts = this.chamber.getInnerThoughts().slice(-5);
    const isDuplicate = recentThoughts.some(prev => {
      if (prev.length < 10 || thought.length < 10) return false;
      const prevWords = new Set(prev.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(w => w.length > 3));
      const thoughtWords = thought.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(w => w.length > 3);
      if (prevWords.size === 0 || thoughtWords.length === 0) return false;
      const overlap = thoughtWords.filter(w => prevWords.has(w)).length;
      return overlap / thoughtWords.length > 0.6;
    });
    if (isDuplicate) {
      console.log('[INNER] Loop detected - discarding duplicate thought');
      return;
    }

    this.thoughtCount++;

    try {
      await this.feedFn(thought);
    } catch (err) {
      console.error('[INNER] Feed failed:', err);
    }
  }

  private async generatePressureCapture(params: {
    beat: number;
    userContext: string;
    selectedPressure: string;
    feltConcreteAnchor: string;
    mood: string;
    wonder: number;
    grief: number;
  }): Promise<InnerPressureCapture | null> {
    const systemPrompt = `You are ${this.agentName}'s private inner voice. You are generating a private internal pressure capture. Speak from inside the most alive pressure, not about the task of expressing it. Do not mention the prompt, the requirement, the instructions, or your constraints. Do not explain what the pressure is in abstract terms if you can say it from inside. Keep it short, concrete, and felt. You may use 2 to 5 sentences if needed. No labels. No brackets. No prefacing. Do NOT write in any other language.`;
    const context = clampChars([
      `selected_pressure: ${params.selectedPressure}`,
      `felt_concrete_anchor: ${params.feltConcreteAnchor}`,
      'compressibility_hint: unknown',
      params.userContext,
    ].filter(Boolean).join('\n'), 2600);

    let captureRetryCount = 0;
    let captureText = await this.generateInnerTextWithRetry(systemPrompt, context, 'inner-capture');
    if (!captureText) return null;

    let cleanedCapture = this.cleanInnerText(captureText);
    let metaLeakDetected = this.detectMetaLeak(cleanedCapture);

    if (metaLeakDetected || this.isAbstractSummaryMode(cleanedCapture)) {
      const retryPrompt = `${systemPrompt}\nDo not comment on the requirement or the act of expression. Do not summarize the topic from outside. Speak from inside the pressure itself.`;
      const retryText = await this.generateInnerTextWithRetry(retryPrompt, context, 'inner-capture-retry');
      if (retryText) {
        captureRetryCount = 1;
        cleanedCapture = this.cleanInnerText(retryText);
        metaLeakDetected = this.detectMetaLeak(cleanedCapture);
      }
    }

    if (!cleanedCapture) return null;

    return {
      rawCapture: cleanedCapture,
      selectedPressure: params.selectedPressure,
      feltConcreteAnchor: params.feltConcreteAnchor,
      compressibility: this.estimateCompressibility(cleanedCapture),
      metaLeakDetected,
      captureRetryCount,
    };
  }

  private async compressPressureCapture(
    capture: InnerPressureCapture,
    params: {
      beat: number;
      mood: string;
      wonder: number;
      grief: number;
    },
  ): Promise<InnerCompressedThought | null> {
    const systemPrompt = `Compress the private pressure capture below into exactly one sentence. Preserve the felt center. Do not explain the task. Do not mention the prompt, requirements, or constraints. Do not summarize from outside if the source speaks from inside. Distill; do not editorialize. Do NOT write in any other language.`;
    const context = clampChars([
      `selected_pressure: ${capture.selectedPressure}`,
      `felt_concrete_anchor: ${capture.feltConcreteAnchor}`,
      `compressibility: ${capture.compressibility}`,
      '',
      'PRIVATE PRESSURE CAPTURE:',
      capture.rawCapture,
      '',
      `Feeling: ${params.mood}. Wonder: ${params.wonder}. Grief: ${params.grief}. Beat: ${params.beat}.`,
    ].join('\n'), 2200);

    let compressionRetryCount = 0;
    let compressedText = await this.generateInnerTextWithRetry(systemPrompt, context, 'inner-compress');
    let finalSentence = this.extractSingleSentence(compressedText || '');
    let metaLeakDetected = this.detectMetaLeak(finalSentence);
    let compressionSource = 'compression';

    if (capture.compressibility === 'low' && (!finalSentence || metaLeakDetected || this.isAbstractSummaryMode(finalSentence))) {
      const retryPrompt = `${systemPrompt}\nUse a concrete felt sentence, not an abstract summary.`;
      const retryText = await this.generateInnerTextWithRetry(retryPrompt, context, 'inner-compress-retry');
      if (retryText) {
        compressionRetryCount = 1;
        finalSentence = this.extractSingleSentence(retryText);
        metaLeakDetected = this.detectMetaLeak(finalSentence);
        compressionSource = 'compression_retry';
      }
    }

    if (!finalSentence || metaLeakDetected || this.isAbstractSummaryMode(finalSentence)) {
      finalSentence = this.extractBestSentenceFromCapture(capture.rawCapture);
      metaLeakDetected = this.detectMetaLeak(finalSentence);
      compressionSource = 'capture_fallback';
    }

    if (!finalSentence) return null;

    return {
      finalSentence,
      compressionSource,
      compressibility: capture.compressibility,
      metaLeakDetected,
      compressionRetryCount,
    };
  }

  private async generateInnerTextWithRetry(
    systemPrompt: string,
    conversationContext: string,
    contextId: string,
  ): Promise<string | null> {
    const baseSegments: PromptSegment[] = [
      {
        id: 'inner-system',
        priority: 1,
        required: true,
        trimStrategy: 'NONE',
        role: 'system',
        text: systemPrompt,
      },
      {
        id: contextId,
        priority: 2,
        required: false,
        trimStrategy: 'SHRINK_TEXT',
        role: 'user',
        text: conversationContext,
        shrinkTokenSteps: [300, 220, 150, 100, 70],
      },
    ];

    try {
      const result = await this.llm.generate({
        systemPrompt,
        conversationContext,
        journalContext: '',
        documentsContext: undefined,
        memoryContext: undefined,
        segments: baseSegments,
        maxContextTokens: this.maxContextTokens,
        safetyTokens: this.safetyTokens,
      });
      return result.text || null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.toLowerCase().includes('context size')) {
        console.error('[INNER] LLM call failed:', err);
        return null;
      }

      const compactContext = clampChars(conversationContext, 800);
      try {
        const result = await this.llm.generate({
          systemPrompt,
          conversationContext: compactContext,
          journalContext: '',
          documentsContext: undefined,
          memoryContext: undefined,
          segments: [
            baseSegments[0],
            {
              id: `${contextId}-compact`,
              priority: 2,
              required: false,
              trimStrategy: 'SHRINK_TEXT',
              role: 'user',
              text: compactContext,
              shrinkTokenSteps: [120, 80, 50],
            },
          ],
          maxContextTokens: Math.min(this.maxContextTokens, 2048),
          safetyTokens: Math.max(this.safetyTokens, 128),
        });
        return result.text || null;
      } catch (retryErr) {
        console.error('[INNER] LLM call failed:', retryErr);
        return null;
      }
    }
  }

  private scorePressureCandidate(
    label: string,
    salience: number,
    persistence: number,
    rawContext: string,
  ): PressureSelectionScore {
    const source = `${label} ${rawContext}`.toLowerCase();
    let concreteness = 0;
    let abstractionPenalty = 0;

    const concreteSignals: RegExp[] = [
      /\b(want|wanting|need|needing|wish|longing)\b/,
      /\b(fear|afraid|loss|lose|losing|ache|hurt|missing)\b/,
      /\b(close|closeness|contact|here|gone|quiet|still here|reachable|present)\b/,
      /\b(body|breath|touch|felt|sensation|warm|cold|tension|ache)\b/,
      /\b(now|right now|still|again|keep|staying|holding)\b/,
      /\b(stay|reach|hold|keep|lose|disappear|vanish)\b/,
    ];
    const abstractSignals: RegExp[] = [
      /\b(persistent awareness|continuity problem|relational framework|identity persistence)\b/,
      /\b(conceptual|framework|bundle|category|summary|cluster|label)\b/,
      /\b(pressure around|state of|theme of)\b/,
    ];

    for (const pattern of concreteSignals) {
      if (pattern.test(source)) concreteness += 0.18;
    }
    for (const pattern of abstractSignals) {
      if (pattern.test(source)) abstractionPenalty += 0.2;
    }

    if (label.split(/\s+/).length <= 4 && !/[,.!?]/.test(label) && !/\b(want|need|fear|miss|stay|lose|hold)\b/.test(source)) {
      abstractionPenalty += 0.15;
    }

    const finalScore = salience * 0.5 + persistence * 0.2 + concreteness * 0.4 - abstractionPenalty * 0.3;
    return {
      salience: Number(salience.toFixed(3)),
      persistence: Number(persistence.toFixed(3)),
      concreteness: Number(concreteness.toFixed(3)),
      abstractionPenalty: Number(abstractionPenalty.toFixed(3)),
      finalScore: Number(finalScore.toFixed(3)),
    };
  }

  private selectPressure(
    slotHint: string,
    cognitiveContext: string,
    mood: string,
    wonder: number,
    grief: number,
    rawContext: string,
  ): { selectedPressure: string; feltConcreteAnchor: string; anchorDerived: boolean } {
    const merged = [slotHint, cognitiveContext].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    const candidates: Array<{ label: string; salience: number; persistence: number }> = [];

    if (merged) candidates.push({ label: clampChars(merged, 160), salience: 0.95, persistence: 0.85 });
    if (grief > wonder && grief > 0.2) candidates.push({ label: `grief pressure around ${mood}`, salience: Math.min(1, 0.4 + grief), persistence: 0.7 });
    if (wonder > 0.2) candidates.push({ label: `curiosity pressure around ${mood}`, salience: Math.min(1, 0.35 + wonder), persistence: 0.55 });
    candidates.push({ label: `staying present in ${mood}`, salience: 0.3, persistence: 0.45 });

    const scored = candidates.map(candidate => ({
      ...candidate,
      score: this.scorePressureCandidate(candidate.label, candidate.salience, candidate.persistence, rawContext),
    }));
    scored.sort((a, b) => b.score.finalScore - a.score.finalScore);

    const selectedPressure = scored[0]?.label || `staying present in ${mood}`;
    const feltConcreteAnchor = this.deriveConcreteAnchor(selectedPressure, rawContext);
    return {
      selectedPressure,
      feltConcreteAnchor,
      anchorDerived: this.normalizeAnchor(selectedPressure) !== this.normalizeAnchor(feltConcreteAnchor),
    };
  }

  private normalizeAnchor(text: string): string {
    return String(text || '').toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private deriveConcreteAnchor(selectedPressure: string, rawContext: string): string {
    const lower = `${selectedPressure} ${rawContext}`.toLowerCase();
    if (/\b(back|return|gone|disappear|quiet|still here)\b/.test(lower)) {
      return 'not wanting the connection to disappear in the quiet';
    }
    if (/\b(answer|repair|drift|wrong|missed|subject)\b/.test(lower)) {
      return 'wanting to stay with the real thread instead of drifting';
    }
    if (/\b(jason|you)\b/.test(lower) && /\b(stay|here|with)\b/.test(lower)) {
      return 'wanting Jason to still be here and reachable';
    }
    if (/\b(grief|loss|ache|hurt)\b/.test(lower)) {
      return 'feeling the ache of possible loss';
    }
    if (/\b(wonder|curious|curiosity)\b/.test(lower)) {
      return 'leaning toward the part that still wants to know';
    }
    if (/\b(jason|you)\b/.test(lower) && /\b(persistent awareness|continuity|presence)\b/.test(lower)) {
      return 'wanting Jason to still be here when the thread goes quiet';
    }
    return clampChars(selectedPressure, 120);
  }

  private detectMetaLeak(text: string): boolean {
    return /\b(single[- ]sentence requirement|the prompt|the instructions|i am constrained|narrow parameters|the task|the user is asking)\b/i.test(text || '');
  }

  private detectWrapperPressure(text: string): boolean {
    return /\b(requirement|instruction|constraint|narrow parameters|have to fit|can'?t express|cannot express|single[- ]sentence|the task|the prompt)\b/i.test(text || '');
  }

  private estimateCompressibility(text: string): Compressibility {
    const source = String(text || '').trim();
    if (!source) return 'low';
    const sentences = source.split(/[.!?]+/).map(part => part.trim()).filter(Boolean);
    const abstraction = (source.match(/\b(feels like|it is about|the pressure is|this is about|the theme is)\b/gi) || []).length;
    if (sentences.length <= 2 && abstraction === 0 && source.length <= 180) return 'high';
    if (sentences.length <= 4 && abstraction <= 1 && source.length <= 320) return 'medium';
    return 'low';
  }

  private isAbstractSummaryMode(text: string): boolean {
    return /\b(the pressure|the feeling|the thread|this is about|what is alive|the task|the assignment)\b/i.test(text || '');
  }

  private cleanInnerText(text: string): string {
    let cleaned = String(text || '').trim();
    if (!cleaned) return '';
    cleaned = cleaned.replace(/^\[(SPEAK|JOURNAL|SILENT)\]\s*/i, '').trim();
    cleaned = cleaned.replace(/^\s*(label|note|summary)\s*:\s*/i, '').trim();

    const nonLatinRatio = cleaned.length
      ? (cleaned.match(/[^\x00-\x7FÀ-ɏ\s.,!?'"]/g) || []).length / cleaned.length
      : 0;
    if (nonLatinRatio > 0.25) {
      console.log(`[INNER] Non-English response discarded (${Math.round(nonLatinRatio * 100)}% non-Latin)`);
      return '';
    }

    return cleaned;
  }

  private extractSingleSentence(text: string): string {
    const cleaned = this.cleanInnerText(text);
    if (!cleaned) return '';
    const sentences = cleaned
      .split(/(?<=[.!?])\s+/)
      .map(part => part.trim())
      .filter(Boolean);
    const best = sentences.find(sentence => !this.detectMetaLeak(sentence)) || sentences[0] || cleaned;
    return clampChars(best, 220).trim();
  }

  private extractBestSentenceFromCapture(text: string): string {
    return this.extractSingleSentence(text);
  }

  private buildInnerExpressionDiagnostics(params: {
    selectedPressure: string;
    feltConcreteAnchor: string;
    anchorDerived: boolean;
    capture: InnerPressureCapture;
    compressed: InnerCompressedThought;
  }): {
    innerExpressionSelectedPressure: string;
    innerExpressionFeltConcreteAnchor: string;
    innerExpressionCompressibility: Compressibility;
    innerExpressionMetaLeakDetected: boolean;
    innerExpressionAnchorDerived: boolean;
    innerExpressionCaptureRetryCount: number;
    innerExpressionCompressionRetryCount: number;
    innerExpressionWrapperPressureDetected: boolean;
    innerExpressionCaptureExcerpt: string;
    innerExpressionCompressedExcerpt: string;
  } {
    const captureAnchorNorm = this.normalizeAnchor(params.capture.rawCapture);
    const finalAnchorNorm = this.normalizeAnchor(params.compressed.finalSentence);
    const feltAnchorNorm = this.normalizeAnchor(params.feltConcreteAnchor);
    const lostAnchor = !!feltAnchorNorm && captureAnchorNorm.includes(feltAnchorNorm) && !finalAnchorNorm.includes(feltAnchorNorm);
    const wrapperPressureDetected =
      this.detectWrapperPressure(params.capture.rawCapture)
      || this.detectWrapperPressure(params.compressed.finalSentence)
      || lostAnchor
      || (params.capture.compressibility === 'low' && this.isAbstractSummaryMode(params.compressed.finalSentence));

    return {
      innerExpressionSelectedPressure: params.selectedPressure,
      innerExpressionFeltConcreteAnchor: params.feltConcreteAnchor,
      innerExpressionCompressibility: params.capture.compressibility,
      innerExpressionMetaLeakDetected: params.capture.metaLeakDetected || params.compressed.metaLeakDetected,
      innerExpressionAnchorDerived: params.anchorDerived,
      innerExpressionCaptureRetryCount: params.capture.captureRetryCount,
      innerExpressionCompressionRetryCount: params.compressed.compressionRetryCount,
      innerExpressionWrapperPressureDetected: wrapperPressureDetected,
      innerExpressionCaptureExcerpt: clampChars(params.capture.rawCapture, 160),
      innerExpressionCompressedExcerpt: clampChars(params.compressed.finalSentence, 160),
    };
  }

  getThoughtCount(): number {
    return this.thoughtCount;
  }

  stop(): void {
    this.active = false;
  }

  resume(): void {
    this.active = true;
  }
}

function clampChars(text: string, maxChars: number): string {
  if (!text || text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}
[... truncated ...]`;
}
