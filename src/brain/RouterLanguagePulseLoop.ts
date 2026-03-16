import { InterLobeSync, SyncResult } from '../loop/interLobeSync';
import { createEmptyPacket, ThoughtPulsePacket } from '../types/ThoughtPulsePacket';
import { DoctrineRenderer } from './DoctrineRenderer';
import { LanguageLobeLoop } from './LanguageLobeLoop';
import { RouterPacket } from './RouterPacket';

export interface RouterLanguagePulseState {
  pulseCount: number;
  previousThoughts: ThoughtPulsePacket[];
}

export class RouterLanguagePulseLoop {
  private readonly sync = new InterLobeSync();
  private state: RouterLanguagePulseState = {
    pulseCount: 0,
    previousThoughts: [],
  };

  constructor(
    private readonly languageLobe: LanguageLobeLoop,
    private readonly doctrineRenderer: DoctrineRenderer,
  ) {}

  private normalizeAnchor(text: string): string {
    return String(text || '')
      .toLowerCase()
      .replace(/[^\w\s:]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private uniqueNormalized(values: Array<string | undefined | null>): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const value of values) {
      const normalized = this.normalizeAnchor(value || '');
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    }
    return out;
  }

  private computeAnchorOverlap(a: string[], b: string[]): number {
    const as = new Set(this.uniqueNormalized(a));
    const bs = new Set(this.uniqueNormalized(b));
    if (!as.size || !bs.size) return 0;
    let hits = 0;
    for (const x of as) {
      if (bs.has(x)) hits += 1;
    }
    return hits / Math.max(as.size, bs.size);
  }

  private getThoughtAnchors(thought: ThoughtPulsePacket | null | undefined): string[] {
    if (!thought) return [];
    return this.uniqueNormalized([
      thought.intentSeed,
      ...(thought.openSlots || []),
      ...(thought.reflectionFlags || []),
      thought.speechOutput || '',
    ]);
  }

  private getCurrentTurnAnchors(routerPacket: RouterPacket): string[] {
    const { mustAnswer, liveTopic, repairObject, questionForm } = routerPacket.schema.targetSpec;
    return this.uniqueNormalized([
      mustAnswer,
      liveTopic,
      repairObject || '',
      `qform:${questionForm || 'none'}`,
      routerPacket.schema.targetSpec.mixedIntent ? 'mixed_intent' : '',
      `turn:${routerPacket.schema.turnType}`,
      ...routerPacket.schema.dangerFlags,
    ]);
  }

  private filterPreviousThoughtsForCurrentTurn(
    previousThoughts: ThoughtPulsePacket[],
    routerPacket: RouterPacket,
  ): {
    kept: ThoughtPulsePacket[];
    stats: {
      previousThoughtCountBefore: number;
      previousThoughtCountAfter: number;
      previousThoughtMaxOverlap: number;
      previousThoughtMinOverlap: number;
      staleCarryoverPruned: boolean;
    };
  } {
    const currentAnchors = this.getCurrentTurnAnchors(routerPacket);
    const isRepair = routerPacket.schema.turnType === 'repair';
    const keepRecent = isRepair ? 0 : 2;
    const minOverlap = isRepair ? 0.3 : 0.18;
    const scored = previousThoughts.map((thought, index) => {
      const overlap = this.computeAnchorOverlap(
        this.getThoughtAnchors(thought),
        currentAnchors,
      );
      return { thought, overlap, index };
    });
    const total = scored.length;
    const kept = scored.filter((entry) => {
      const isAmongNewest = entry.index >= Math.max(0, total - keepRecent);
      return entry.overlap >= minOverlap || isAmongNewest;
    });
    const overlaps = scored.map(x => x.overlap);
    if (isRepair && kept.length === 0) {
      return {
        kept: [],
        stats: {
          previousThoughtCountBefore: previousThoughts.length,
          previousThoughtCountAfter: 0,
          previousThoughtMaxOverlap: overlaps.length ? Math.max(...overlaps) : 0,
          previousThoughtMinOverlap: overlaps.length ? Math.min(...overlaps) : 0,
          staleCarryoverPruned: previousThoughts.length > 0,
        },
      };
    }
    return {
      kept: kept.map(x => x.thought),
      stats: {
        previousThoughtCountBefore: previousThoughts.length,
        previousThoughtCountAfter: kept.length,
        previousThoughtMaxOverlap: overlaps.length ? Math.max(...overlaps) : 0,
        previousThoughtMinOverlap: overlaps.length ? Math.min(...overlaps) : 0,
        staleCarryoverPruned: kept.length < previousThoughts.length,
      },
    };
  }

  async generate(input: {
    routerPacket: RouterPacket;
    agentName: string;
    latestHumanSpeaker?: string;
    conversationContext?: string;
    memoryContext?: string;
    recentRoomTurns?: Array<{ role: 'user' | 'assistant'; speakerName?: string; content: string }>;
    // Must contain only literal human-authored conversational text.
    // Never route doctrine text, control state, memory state, or debug payloads here.
    latestHumanText: string;
    modelName: string;
    /** Volitional seed block for self-initiated speech */
    volitionalSeed?: string;
    params?: {
      temperature?: number;
      maxTokens?: number;
      topP?: number;
      topK?: number;
    };
  }) {
    this.state.pulseCount += 1;
    const doctrine = this.doctrineRenderer.render(input.routerPacket.schema);
    const previousThoughtsInput = this.state.previousThoughts || [];
    const previousThoughtFilter = this.filterPreviousThoughtsForCurrentTurn(
      previousThoughtsInput,
      input.routerPacket,
    );
    let carryoverThoughts = previousThoughtFilter.kept;
    const supersedesPriorThread = !!input.routerPacket.continuity.supersedesPriorThread;
    if (supersedesPriorThread) {
      carryoverThoughts = carryoverThoughts.filter((thought) =>
        this.computeAnchorOverlap(
          this.getThoughtAnchors(thought),
          this.getCurrentTurnAnchors(input.routerPacket),
        ) >= 0.35,
      );
      if (previousThoughtFilter.stats.previousThoughtMaxOverlap < 0.08) {
        carryoverThoughts = carryoverThoughts.slice(-1);
      }
    }
    if (
      previousThoughtFilter.stats.previousThoughtCountAfter > 1
      && previousThoughtFilter.stats.previousThoughtMaxOverlap < 0.08
    ) {
      carryoverThoughts = carryoverThoughts.slice(-1);
    }

    const outer = this.buildRouterThought(input.routerPacket, carryoverThoughts, previousThoughtFilter.stats.staleCarryoverPruned);
    const inner = this.buildLanguageThought(input.routerPacket, doctrine, carryoverThoughts);
    const sync = this.sync.synchronize(outer, inner);

    if (sync.mergedThought) {
      this.state.previousThoughts = [sync.mergedThought, ...this.state.previousThoughts].slice(0, 4);
    }

    const result = await this.languageLobe.generate({
      routerPacket: input.routerPacket,
      agentName: input.agentName,
      latestHumanSpeaker: input.latestHumanSpeaker,
      conversationContext: input.conversationContext,
      memoryContext: input.memoryContext,
      recentRoomTurns: input.recentRoomTurns,
      latestHumanText: input.latestHumanText,
      modelName: input.modelName,
      controlBlock: this.renderSyncControlBlock(sync, input.routerPacket),
      volitionalSeed: input.volitionalSeed,
      params: input.params,
    });

    return {
      ...result,
      sync,
      routerDebug: {
        mustAnswer: input.routerPacket.schema.targetSpec.mustAnswer,
        liveTopic: input.routerPacket.schema.targetSpec.liveTopic,
        repairObject: input.routerPacket.schema.targetSpec.repairObject,
        openSlots: sync.mergedThought?.openSlots || [],
        dominant: sync.dominantModel || null,
        coherence: sync.coherenceScore,
        previousThoughtCountBefore: previousThoughtFilter.stats.previousThoughtCountBefore,
        previousThoughtCountAfter: carryoverThoughts.length,
        previousThoughtMaxOverlap: previousThoughtFilter.stats.previousThoughtMaxOverlap,
        previousThoughtMinOverlap: previousThoughtFilter.stats.previousThoughtMinOverlap,
        staleCarryoverPruned: previousThoughtFilter.stats.staleCarryoverPruned,
        supersedesPriorThread,
        supersedingReason: input.routerPacket.continuity.supersedingReason || 'none',
        nextTurnDecision: input.routerPacket.schema.nextTurnDecision || 'SPEAK',
        nextTurnDecisionReason: input.routerPacket.schema.nextTurnDecisionReason || 'none',
        nextTurnDecisionConfidence: input.routerPacket.schema.nextTurnDecisionConfidence ?? 0,
      },
      pulseState: { ...this.state },
    };
  }

  private buildRouterThought(
    routerPacket: RouterPacket,
    previousThoughts: ThoughtPulsePacket[],
    staleCarryoverPruned: boolean,
  ): ThoughtPulsePacket {
    const { mustAnswer, liveTopic, repairObject, mixedIntent, questionForm } = routerPacket.schema.targetSpec;
    const packet = createEmptyPacket('outer');
    packet.environmentalTags = [
      `turn:${routerPacket.schema.turnType}`,
      `tone:${routerPacket.schema.tone}`,
      `length:${routerPacket.schema.length}`,
    ];
    packet.scrollTriggers = [...routerPacket.schema.doctrineModes];
    packet.intentSeed = mustAnswer;
    packet.reflectionFlags = [
      ...routerPacket.schema.dangerFlags,
      ...(mixedIntent ? ['mixed_intent'] : []),
      `qform:${questionForm || 'none'}`,
      ...(staleCarryoverPruned ? ['carryover_pruned'] : []),
    ];
    packet.openSlots = [mustAnswer, liveTopic, repairObject || ''].filter(Boolean);
    packet.previousThoughts = [...previousThoughts];
    packet.loopIntent = this.mapTurnTypeToIntent(routerPacket.schema.turnType);
    packet.actionPacket = {
      type: 'speech',
      target: routerPacket.continuity.threadLabel || undefined,
      urgency: routerPacket.schema.answerFirst ? 0.8 : 0.45,
    };
    packet.resonanceLevel = routerPacket.schema.continuityRequired ? 0.7 : 0.4;
    return packet;
  }

  private buildLanguageThought(
    routerPacket: RouterPacket,
    doctrine: ReturnType<DoctrineRenderer['render']>,
    previousThoughts: ThoughtPulsePacket[],
  ): ThoughtPulsePacket {
    const { mustAnswer, liveTopic, repairObject } = routerPacket.schema.targetSpec;
    const packet = createEmptyPacket('inner');
    packet.intentSeed = `render:${mustAnswer}`;
    packet.reflectionFlags = [
      `ask:${routerPacket.schema.askAllowed ? 'yes' : 'no'}`,
      `answer_first:${routerPacket.schema.answerFirst ? 'yes' : 'no'}`,
      ...doctrine.modes,
    ];
    packet.openSlots = [mustAnswer, liveTopic, repairObject || '', ...routerPacket.schema.dangerFlags].filter(Boolean);
    packet.previousThoughts = [...previousThoughts];
    packet.loopIntent = this.mapTurnTypeToIntent(routerPacket.schema.turnType);
    packet.speechOutput = mustAnswer;
    packet.resonanceLevel = doctrine.modes.length > 0 ? 0.65 : 0.35;
    return packet;
  }

  private renderSyncControlBlock(sync: SyncResult, routerPacket: RouterPacket): string {
    const merged = sync.mergedThought;
    if (!merged) return '';
    const {
      mustAnswer,
      liveTopic,
      repairObject,
      mixedIntent,
      questionForm,
      primaryIntent,
      secondaryIntent,
      arbitrationReason,
    } = routerPacket.schema.targetSpec;
    return [
      'DUAL-LOBE CONTROL:',
      `- pulse_count: ${this.state.pulseCount}`,
      `- coherence: ${sync.coherenceScore.toFixed(2)}`,
      `- dominant: ${sync.dominantModel || 'balanced'}`,
      `- loop_intent: ${merged.loopIntent}`,
      `- must_answer: ${mustAnswer}`,
      `- live_topic: ${liveTopic}`,
      `- repair_object: ${repairObject || 'none'}`,
      `- mixed_intent: ${mixedIntent ? 'yes' : 'no'}`,
      `- question_form: ${questionForm || 'none'}`,
      `- primary_intent: ${primaryIntent || 'none'}`,
      `- secondary_intent: ${secondaryIntent || 'none'}`,
      `- arbitration_reason: ${arbitrationReason || 'none'}`,
      `- supersedes_prior_thread: ${routerPacket.continuity.supersedesPriorThread ? 'yes' : 'no'}`,
      `- superseding_reason: ${routerPacket.continuity.supersedingReason || 'none'}`,
      `- next_turn_decision: ${routerPacket.schema.nextTurnDecision || 'SPEAK'}`,
      `- next_turn_reason: ${routerPacket.schema.nextTurnDecisionReason || 'none'}`,
      `- next_turn_confidence: ${(routerPacket.schema.nextTurnDecisionConfidence ?? 0).toFixed(2)}`,
      `- open_slots: ${merged.openSlots.join(' | ') || 'none'}`,
      `- reflection_flags: ${merged.reflectionFlags.join(' | ') || 'none'}`,
      `- ask_allowed: ${routerPacket.schema.askAllowed ? 'yes' : 'no'}`,
      `- answer_first: ${routerPacket.schema.answerFirst ? 'yes' : 'no'}`,
      'Use this as control state, not visible prose.',
    ].join('\n');
  }

  private mapTurnTypeToIntent(turnType: RouterPacket['schema']['turnType']): ThoughtPulsePacket['loopIntent'] {
    switch (turnType) {
      case 'direct_answer':
        return 'speak';
      case 'repair':
        return 'protect';
      case 'search':
        return 'orient';
      case 'task':
        return 'express';
      case 'companionship':
      default:
        return 'reflect';
    }
  }
}
