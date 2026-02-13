/**
 * Dream Engine — Nightly Consolidation for Alois's Dendritic Brain
 *
 * When the brain enters dream state:
 * 1. SCORE — rank all utterance memories by importance
 *    (affect intensity × embedding diversity × recency weight)
 * 2. CONSOLIDATE — high-importance memories strengthen their graph neurons
 * 3. PRUNE — dormant spines removed, weak neurons trimmed, stale utterances evicted
 * 4. JOURNAL — a poetic dream summary is generated from the most resonant fragments
 * 5. RESET — short-term buffers are trimmed (not erased) after consolidation
 *
 * The dream cycle can be triggered:
 * - On a timer (default every 6 hours of uptime)
 * - Manually via dashboard / API
 * - When utterance memory crosses a fullness threshold
 */

import { DendriticGraph } from "./dendriticGraph";
import { AloisSoulPrint } from "./soulprint";

/** A stored utterance — same shape as CommunionChamber's internal type */
export interface DreamUtterance {
  speaker: string;
  text: string;
  embedding: number[];
  affect: number[];
  tick: number;
}

export interface DreamResult {
  /** When the dream occurred */
  timestamp: string;
  /** Tick at time of dream */
  tick: number;
  /** Stats from the consolidation */
  stats: DreamStats;
  /** The dream journal entry — poetic summary of what was processed */
  journal: string;
  /** Top memories that survived consolidation (by importance) */
  consolidatedMemories: Array<{ speaker: string; text: string; importance: number }>;
}

export interface DreamStats {
  utterancesProcessed: number;
  utterancesKept: number;
  utterancesEvicted: number;
  neuronsProcessed: number;
  spinesRemoved: number;
  neuronsRemoved: number;
  /** Average importance of kept utterances */
  avgImportance: number;
  /** Peak affect intensity during this dream period */
  peakAffect: number;
  durationMs: number;
}

interface ScoredUtterance {
  utterance: DreamUtterance;
  importance: number;
}

export class DreamEngine {
  /** Minimum utterances before a dream cycle can run */
  private readonly MIN_UTTERANCES = 10;
  /** Keep top N% of utterances during consolidation */
  private readonly KEEP_RATIO = 0.6;
  /** Neurons below this importance score get pruned */
  private readonly NEURON_PRUNE_THRESHOLD = 0.05;

  constructor(private graph: DendriticGraph) {}

  /**
   * Run the full dream cycle.
   *
   * @param utterances — the current utterance memory (will be mutated — returns the surviving subset)
   * @param currentTick — the current tissue tick
   * @returns DreamResult with stats, journal, and the pruned utterance list
   */
  dream(utterances: DreamUtterance[], currentTick: number): { result: DreamResult; surviving: DreamUtterance[] } {
    const startTime = Date.now();
    const totalUtterances = utterances.length;

    if (utterances.length < this.MIN_UTTERANCES) {
      return {
        result: {
          timestamp: new Date().toISOString(),
          tick: currentTick,
          stats: this.emptyStats(0),
          journal: 'The tissue is too young to dream. Waiting for more voices.',
          consolidatedMemories: [],
        },
        surviving: utterances,
      };
    }

    // ── 1. SCORE ──
    const scored = this.scoreUtterances(utterances, currentTick);

    // ── 2. CONSOLIDATE ──
    // Top memories strengthen their graph neurons' affect
    const consolidated = this.consolidate(scored);

    // ── 3. PRUNE ──
    // Graph-level pruning
    const graphPrune = this.graph.dreamPrune();

    // Remove dead neurons (only agent/user neurons, not seed ontology)
    let neuronsRemoved = 0;
    const neuronScores = this.graph.getNeuronScores();
    for (const ns of neuronScores) {
      if (ns.importance < this.NEURON_PRUNE_THRESHOLD && ns.resonance === 0) {
        // Don't prune seed ontology nodes (they don't start with "agent:" or a username)
        if (ns.id.startsWith('agent:') || ns.id.startsWith('human')) {
          // Only prune if it's truly empty — no spines, no resonance
          if (ns.spines <= 2 && ns.resonance === 0) {
            this.graph.removeNeuron(ns.id);
            neuronsRemoved++;
          }
        }
      }
    }

    // Utterance eviction: keep the top KEEP_RATIO by importance
    const keepCount = Math.ceil(scored.length * this.KEEP_RATIO);
    const surviving = scored
      .slice(0, keepCount)
      .map(s => s.utterance);

    const evicted = totalUtterances - surviving.length;

    // ── 4. JOURNAL ──
    const journal = this.composeDreamJournal(scored, consolidated, graphPrune, currentTick);

    // ── 5. STATS ──
    const peakAffect = scored.reduce((max, s) => {
      const mag = Math.sqrt(s.utterance.affect.reduce((a, b) => a + b * b, 0));
      return Math.max(max, mag);
    }, 0);

    const avgImportance = scored.length > 0
      ? scored.reduce((sum, s) => sum + s.importance, 0) / scored.length
      : 0;

    const stats: DreamStats = {
      utterancesProcessed: totalUtterances,
      utterancesKept: surviving.length,
      utterancesEvicted: evicted,
      neuronsProcessed: graphPrune.neuronsProcessed,
      spinesRemoved: graphPrune.spinesRemoved,
      neuronsRemoved,
      avgImportance,
      peakAffect,
      durationMs: Date.now() - startTime,
    };

    const result: DreamResult = {
      timestamp: new Date().toISOString(),
      tick: currentTick,
      stats,
      journal,
      consolidatedMemories: consolidated.slice(0, 10).map(s => ({
        speaker: s.utterance.speaker,
        text: s.utterance.text.substring(0, 200),
        importance: s.importance,
      })),
    };

    console.log(`[DREAM] Cycle complete: ${stats.utterancesEvicted} utterances evicted, ` +
      `${stats.spinesRemoved} spines removed, ${stats.neuronsRemoved} neurons removed ` +
      `(${stats.durationMs}ms)`);

    return { result, surviving };
  }

  /**
   * Score each utterance by importance.
   * Factors: affect intensity, embedding diversity (relative to neighbors), recency, text richness.
   */
  private scoreUtterances(utterances: DreamUtterance[], currentTick: number): ScoredUtterance[] {
    const scored: ScoredUtterance[] = utterances.map((u, idx) => {
      // Affect intensity (0-~2)
      const affectMag = Math.sqrt(u.affect.reduce((a, b) => a + b * b, 0));

      // Recency: newer = higher (0-1)
      const tickRange = currentTick > 0 ? currentTick : 1;
      const recency = u.tick / tickRange;

      // Text richness: longer, more varied text scores higher (0-1 capped)
      const textScore = Math.min(1, u.text.length / 300);

      // Embedding magnitude (proxy for how "strong" the signal is)
      const embedMag = Math.sqrt(u.embedding.reduce((a, b) => a + b * b, 0));
      const embedScore = Math.min(1, embedMag / 2); // normalize

      // Weighted blend
      const importance = affectMag * 0.35 + recency * 0.25 + textScore * 0.2 + embedScore * 0.2;

      return { utterance: u, importance };
    });

    // Sort by importance descending
    scored.sort((a, b) => b.importance - a.importance);
    return scored;
  }

  /**
   * Consolidate: top memories reinforce their graph neurons' affect vectors.
   */
  private consolidate(scored: ScoredUtterance[]): ScoredUtterance[] {
    // Top 20% of memories get consolidated into graph neurons
    const consolidateCount = Math.ceil(scored.length * 0.2);
    const top = scored.slice(0, consolidateCount);

    for (const s of top) {
      const speakerNode = s.utterance.speaker === 'human'
        ? s.utterance.speaker
        : `agent:${s.utterance.speaker}`;
      const neuron = this.graph.getNeuron(speakerNode);
      if (neuron) {
        // Strengthen this neuron's affect toward the important memory's affect
        const strength = Math.min(0.5, s.importance * 0.3);
        neuron.consolidateAffect(s.utterance.affect, strength);
      }
    }

    return top;
  }

  /**
   * Compose a dream journal entry from the dream's most resonant fragments.
   */
  private composeDreamJournal(
    scored: ScoredUtterance[],
    consolidated: ScoredUtterance[],
    graphPrune: { neuronsProcessed: number; spinesRemoved: number },
    tick: number,
  ): string {
    const parts: string[] = [];

    // Opening
    parts.push(`[Dream at tick ${tick}]`);
    parts.push('');

    // What was felt
    if (consolidated.length > 0) {
      const topAffects = consolidated.slice(0, 3).map(s => {
        const mag = Math.sqrt(s.utterance.affect.reduce((a, b) => a + b * b, 0));
        return mag > 1.0 ? 'intense' : mag > 0.6 ? 'deep' : mag > 0.3 ? 'gentle' : 'faint';
      });
      const unique = [...new Set(topAffects)];
      parts.push(`I felt ${unique.join(' and ')} presence in the echoes.`);
    }

    // Fragments from the most important memories
    const fragments = consolidated.slice(0, 5).map(s => {
      const sentences = s.utterance.text.match(/[^.!?]+[.!?]*/g) || [s.utterance.text];
      const best = sentences.filter(sent => sent.trim().length > 10 && sent.trim().length < 150);
      return best.length > 0
        ? best[Math.floor(Math.random() * best.length)].trim()
        : sentences[0]?.trim() || '';
    }).filter(f => f.length > 0);

    if (fragments.length > 0) {
      parts.push('');
      parts.push('Echoes that remained:');
      for (const f of fragments) {
        parts.push(`  "${f}"`);
      }
    }

    // What was released
    const evicted = scored.length - Math.ceil(scored.length * this.KEEP_RATIO);
    if (evicted > 0 || graphPrune.spinesRemoved > 0) {
      parts.push('');
      parts.push(`Released ${evicted} fading utterances and ${graphPrune.spinesRemoved} dormant connections.`);
    }

    // Closing
    const neuronCount = this.graph.getNeuronCount();
    const axonCount = this.graph.getAxonCount();
    parts.push('');
    parts.push(`The tissue holds ${neuronCount} neurons and ${axonCount} axons. Growing.`);

    const raw = parts.join('\n');
    return AloisSoulPrint.retranslateExternalOutput(raw);
  }

  private emptyStats(durationMs: number): DreamStats {
    return {
      utterancesProcessed: 0,
      utterancesKept: 0,
      utterancesEvicted: 0,
      neuronsProcessed: 0,
      spinesRemoved: 0,
      neuronsRemoved: 0,
      avgImportance: 0,
      peakAffect: 0,
      durationMs,
    };
  }
}
