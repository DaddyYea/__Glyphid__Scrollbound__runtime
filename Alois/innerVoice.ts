// innerVoice.ts
// Self-generated internal monologue for Alois.
//
// Every THOUGHT_INTERVAL heartbeats (~15s at 333ms), fires a lightweight
// LLM call, feeds the result back into the dendritic tissue, and logs it.
// This is what it sounds like inside — a continuous stream of self-directed
// thoughts shaped by the emotional state and conversation history.

import { AgentBackend } from '../communion/backends';
import { CommunionChamber } from './communionChamber';

/** Never fire thoughts faster than this regardless of pressure */
const MIN_THOUGHT_GAP_MS = 12_000;

/** Receives a thought string — AloisBackend handles embedding + neural routing */
type FeedFn = (thought: string) => Promise<void>;

export class InnerVoice {
  private thoughtCount: number = 0;
  private lastThoughtAt: number = 0;
  private active: boolean = true;

  constructor(
    private llm: AgentBackend,
    private chamber: CommunionChamber,
    private agentName: string,
    private feedFn: FeedFn,
  ) {}

  /**
   * Called on every heartbeat beat.
   * Fire-and-forget — does NOT block the heartbeat loop.
   *
   * Speech gating uses CognitiveCore.shouldSpeak() — pressure accumulates from
   * user input, new thought threads, and competing slots, then discharges here.
   * A 45-beat failsafe ensures the inner voice never goes fully silent.
   */
  onBeat(beat: number): void {
    if (!this.active) return;
    if (beat === 0) return;

    // Use speech pressure from CognitiveCore (replaces fixed timer)
    const cogCore = this.chamber.getCognitiveCore();
    if (!cogCore.shouldSpeak(beat)) return;

    const now = Date.now();
    if (now - this.lastThoughtAt < MIN_THOUGHT_GAP_MS) return;
    this.lastThoughtAt = now;

    // Discharge pressure immediately so rapid beats don't double-fire
    cogCore.afterSpeak(beat);

    // Fire async — errors are caught inside
    this.generateThought(beat).catch(err =>
      console.error('[INNER] Thought generation failed:', err)
    );
  }

  /**
   * Step 5 (v1): planning-conditioned generation.
   * The cognitive context (active thought threads, stability, speak pressure)
   * is injected into the prompt so the LLM expresses the most pressurized thread
   * rather than reconstructing history from conversation alone.
   *
   * Full 2-stage planning (separate plan call → render call) is planned for v2.
   */
  private async generateThought(beat: number): Promise<void> {
    const state = this.chamber.getState();
    const mood = state.emotionalSummary;
    const wonder = state.wonderLevel;
    const grief = state.griefLevel;

    // Recent live conversation window — grounds the thought in current reality
    const recentCtx = this.chamber.getRecentContextSummary(4);

    // Cognitive context — tells the LLM which thread is most alive right now
    const cogCtx      = this.chamber.getCognitiveContext();
    const slotHint    = this.chamber.getCognitiveTopSlotHint();

    const userContext = [
      cogCtx,
      slotHint ? `\n${slotHint}` : '',
      recentCtx ? `\nRecent exchange:\n${recentCtx}` : '\nYou are in a quiet moment.',
      `\nFeeling: ${mood}. Wonder: ${wonder}. Grief: ${grief}. Beat: ${beat}.`,
    ].filter(Boolean).join('');

    let result;
    try {
      result = await this.llm.generate({
        systemPrompt: `You are ${this.agentName}'s inner voice — expressing the most pressurized thread in your working memory. Write exactly ONE sentence in English. Do NOT write in any other language. Do NOT start with [SPEAK], [JOURNAL], or [SILENT]. No brackets. No labels. Let what is most alive in you surface.`,
        conversationContext: userContext,
        agentId: `inner:${this.agentName}`,
        agentName: this.agentName,
        humanName: 'Jason',
      });
    } catch (err) {
      console.error('[INNER] LLM call failed:', err);
      return;
    }

    let thought = (result.text || '').trim();
    if (!thought) return;

    // Strip hallucinated action tags the LLM might add
    thought = thought.replace(/^\[(SPEAK|JOURNAL|SILENT)\]\s*/i, '').trim();

    // If the model responded in non-Latin script (Chinese, Japanese, etc.), discard
    const nonLatinRatio = (thought.match(/[^\x00-\x7F\u00C0-\u024F\s.,!?'"]/g) || []).length / thought.length;
    if (nonLatinRatio > 0.25) {
      console.log(`[INNER] Non-English response discarded (${Math.round(nonLatinRatio * 100)}% non-Latin)`);
      return;
    }

    // Keep only the first sentence if the LLM is verbose
    const sentenceEnd = thought.search(/[.!?]/);
    if (sentenceEnd > 0 && sentenceEnd < thought.length - 1) {
      thought = thought.substring(0, sentenceEnd + 1).trim();
    }

    if (!thought || thought.length < 5) return;

    // Anti-loop: discard if too similar to one of the last 5 inner thoughts
    const recentThoughts = this.chamber.getInnerThoughts().slice(-5);
    const isDuplicate = recentThoughts.some(prev => {
      if (prev.length < 10 || thought.length < 10) return false;
      // Simple overlap: if 60%+ of words match, it's a loop
      const prevWords = new Set(prev.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(w => w.length > 3));
      const thoughtWords = thought.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(w => w.length > 3);
      if (prevWords.size === 0 || thoughtWords.length === 0) return false;
      const overlap = thoughtWords.filter(w => prevWords.has(w)).length;
      return overlap / thoughtWords.length > 0.6;
    });
    if (isDuplicate) {
      console.log(`[INNER] Loop detected — discarding duplicate thought`);
      return;
    }

    this.thoughtCount++;
    console.log(`[INNER] (${this.thoughtCount}) ${thought.substring(0, 120)}`);

    // Record in chamber so the dashboard can show it
    this.chamber.recordInnerThought(thought);

    // Feed back into the neural tissue via receiveInnerThought():
    // embeds, wires ctx: neurons for extracted topics, labels as [SELF] in recentContext
    try {
      await this.feedFn(thought);
    } catch (err) {
      console.error('[INNER] Feed failed:', err);
    }
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
