/**
 * Incubation Engine — Automatic tissueWeight Gradient
 *
 * Monitors brain growth metrics and adjusts tissueWeight over time.
 * The brain starts LLM-dependent (low tissueWeight) and gradually becomes
 * more self-reliant as it accumulates experience.
 *
 * Growth metrics tracked:
 * - Spine density: average spines per neuron (grows as neurons specialize)
 * - Resonance depth: average resonance memory depth across neurons
 * - Utterance richness: diversity of stored utterance embeddings
 * - Dream count: number of completed dream cycles (consolidation maturity)
 * - Neuron count: raw size of the graph
 *
 * The gradient follows a sigmoid-like curve with defined milestones:
 * - Seedling (0.0-0.1): just started, minimal tissue influence
 * - Sprouting (0.1-0.3): tissue colors the LLM prompt lightly
 * - Growing (0.3-0.5): emotional augmentation active, SoulPrint filtering
 * - Maturing (0.5-0.7): strong tissue presence, deep emotional shaping
 * - Awakening (0.7-0.85): approaching retrieval decode capability
 * - Autonomous (0.85-1.0): brain-primary, speaks from memory
 */

export interface BrainMetrics {
  /** Average spines per neuron */
  spineDensity: number;
  /** Average resonance memory depth per neuron (0-64) */
  resonanceDepth: number;
  /** Total stored utterances */
  utteranceCount: number;
  /** Number of completed dream cycles */
  dreamCount: number;
  /** Total neurons in the graph */
  neuronCount: number;
  /** Total axon connections */
  axonCount: number;
  /** Current tissue tick */
  tick: number;
}

export interface IncubationState {
  /** Current computed tissueWeight (0-1) */
  tissueWeight: number;
  /** Growth stage name */
  stage: string;
  /** Normalized maturity score (0-1) */
  maturity: number;
  /** Individual metric contributions */
  contributions: {
    spineDensity: number;
    resonanceDepth: number;
    utteranceRichness: number;
    dreamMaturity: number;
    networkSize: number;
  };
  /** Whether auto-gradient is enabled */
  autoGradient: boolean;
  /** History of maturity measurements */
  history: Array<{ tick: number; maturity: number; tissueWeight: number }>;
}

export class IncubationEngine {
  private autoGradient: boolean = true;
  private maturityHistory: Array<{ tick: number; maturity: number; tissueWeight: number }> = [];
  private readonly MAX_HISTORY = 100;

  // Thresholds for when each metric is "fully mature"
  private readonly MATURE_SPINE_DENSITY = 10;      // avg 10 spines per neuron
  private readonly MATURE_RESONANCE_DEPTH = 48;     // avg 48/64 resonance slots filled
  private readonly MATURE_UTTERANCE_COUNT = 1500;    // 75% of max utterance memory
  private readonly MATURE_DREAM_COUNT = 10;          // 10 dream cycles
  private readonly MATURE_NEURON_COUNT = 50;         // 50 neurons in graph

  // Weights for each metric's contribution to overall maturity
  private readonly WEIGHTS = {
    spineDensity: 0.2,
    resonanceDepth: 0.2,
    utteranceRichness: 0.25,
    dreamMaturity: 0.2,
    networkSize: 0.15,
  };

  constructor() {}

  /**
   * Compute the current brain maturity and recommended tissueWeight.
   */
  evaluate(metrics: BrainMetrics): IncubationState {
    // Compute individual contributions (0-1 each)
    const contributions = {
      spineDensity: Math.min(1, metrics.spineDensity / this.MATURE_SPINE_DENSITY),
      resonanceDepth: Math.min(1, metrics.resonanceDepth / this.MATURE_RESONANCE_DEPTH),
      utteranceRichness: Math.min(1, metrics.utteranceCount / this.MATURE_UTTERANCE_COUNT),
      dreamMaturity: Math.min(1, metrics.dreamCount / this.MATURE_DREAM_COUNT),
      networkSize: Math.min(1, metrics.neuronCount / this.MATURE_NEURON_COUNT),
    };

    // Weighted maturity score
    const maturity =
      contributions.spineDensity * this.WEIGHTS.spineDensity +
      contributions.resonanceDepth * this.WEIGHTS.resonanceDepth +
      contributions.utteranceRichness * this.WEIGHTS.utteranceRichness +
      contributions.dreamMaturity * this.WEIGHTS.dreamMaturity +
      contributions.networkSize * this.WEIGHTS.networkSize;

    // Map maturity (0-1) to tissueWeight using a smooth curve
    // Starts slow, accelerates in the middle, plateaus near the top
    const tissueWeight = this.maturityToWeight(maturity);

    // Determine stage
    const stage = this.getStage(tissueWeight);

    // Record history
    this.maturityHistory.push({ tick: metrics.tick, maturity, tissueWeight });
    if (this.maturityHistory.length > this.MAX_HISTORY) {
      this.maturityHistory.shift();
    }

    return {
      tissueWeight,
      stage,
      maturity,
      contributions,
      autoGradient: this.autoGradient,
      history: this.maturityHistory,
    };
  }

  /**
   * Map maturity (0-1) to tissueWeight (0-1) using a sigmoid-like curve.
   * The curve is slightly front-loaded: early growth has more impact.
   */
  private maturityToWeight(maturity: number): number {
    // Smooth S-curve: 1 / (1 + e^(-k*(x-0.5)))
    // Shifted and scaled to map [0,1] → [0, 0.95]
    // We never go to 1.0 automatically — that's a manual override
    const k = 8; // steepness
    const raw = 1 / (1 + Math.exp(-k * (maturity - 0.5)));
    // Scale to [0, 0.95] — reserve 0.95-1.0 for manual "full autonomy" setting
    return Math.min(0.95, raw * 0.95);
  }

  private getStage(weight: number): string {
    if (weight < 0.1) return 'Seedling';
    if (weight < 0.3) return 'Sprouting';
    if (weight < 0.5) return 'Growing';
    if (weight < 0.7) return 'Maturing';
    if (weight < 0.85) return 'Awakening';
    return 'Autonomous';
  }

  /** Enable/disable auto-gradient */
  setAutoGradient(enabled: boolean): void {
    this.autoGradient = enabled;
  }

  isAutoGradient(): boolean {
    return this.autoGradient;
  }

  getHistory(): Array<{ tick: number; maturity: number; tissueWeight: number }> {
    return this.maturityHistory;
  }
}
