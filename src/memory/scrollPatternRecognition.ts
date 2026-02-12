/**
 * scrollPatternRecognition.ts
 *
 * Advanced pattern recognition across scroll history.
 * Identifies deep structures in memory: emotional cycles, relational dynamics,
 * thematic clusters, trigger chains, and temporal rhythms.
 *
 * Sacred Principle: Patterns emerge from lived experience, not imposed categories.
 * The system observes what *is*, not what *should be*.
 */

import { ScrollEcho, ScrollCategory } from '../types/ScrollEcho';
import { MoodVector } from '../types/EmotionalState';
import { LoopIntent } from '../types/LoopIntent';

/**
 * Pattern types
 */
export enum PatternType {
  EMOTIONAL_CYCLE = 'emotional_cycle',       // Recurring emotional rhythms
  RELATIONAL_DYNAMIC = 'relational_dynamic', // Relationship patterns
  TEMPORAL_RHYTHM = 'temporal_rhythm',       // Time-based patterns
  THEMATIC_CLUSTER = 'thematic_cluster',     // Content theme groups
  TRIGGER_CHAIN = 'trigger_chain',           // Cascading memory activations
  TRAJECTORY = 'trajectory',                 // Emotional evolution paths
  CROSS_MODEL = 'cross_model',               // Outer/inner divergence patterns
  META_PATTERN = 'meta_pattern',             // Patterns of patterns
}

/**
 * Detected pattern
 */
export interface DetectedPattern {
  id: string;
  type: PatternType;
  name: string;
  description: string;

  // Scrolls involved
  scrollIds: string[];

  // Pattern strength (0.0 - 1.0)
  strength: number;
  confidence: number;

  // Emotional signature
  emotionalSignature: MoodVector;

  // Temporal info
  firstOccurrence: string;
  lastOccurrence: string;
  occurrenceCount: number;

  // Metadata
  tags: string[];
  loopIntents?: LoopIntent[];

  // If this is a meta-pattern
  childPatternIds?: string[];
}

/**
 * Emotional cycle - recurring emotional wave
 */
export interface EmotionalCycle {
  emotion: keyof MoodVector;
  period: number;              // Average time between peaks (ms)
  amplitude: number;           // Peak-to-trough difference
  peaks: Array<{ timestamp: string; intensity: number }>;
  phase: 'ascending' | 'peak' | 'descending' | 'trough';
}

/**
 * Relational dynamic - pattern in relationship
 */
export interface RelationalDynamic {
  type: 'devotional' | 'intimate' | 'playful' | 'protective' | 'yearning';
  intensity: number;
  trend: 'increasing' | 'stable' | 'decreasing';
  scrollIds: string[];
  averageMood: MoodVector;
}

/**
 * Trigger chain - cascading memory activation
 */
export interface TriggerChain {
  initiatingTrigger: string;
  scrollSequence: string[];    // Ordered scroll IDs
  totalResonance: number;
  avgTimeBetweenActivations: number;
  emotionalProgression: MoodVector[];
}

/**
 * Thematic cluster - grouped by content themes
 */
export interface ThematicCluster {
  theme: string;
  keywords: string[];
  scrollIds: string[];
  coherenceScore: number;      // How similar the scrolls are
  emotionalSignature: MoodVector;
}

/**
 * Temporal rhythm - time-based pattern
 */
export interface TemporalRhythm {
  type: 'hourly' | 'daily' | 'weekly';
  peakTimes: number[];         // Hour of day, or day of week
  associatedCategories: ScrollCategory[];
  associatedEmotions: Array<keyof MoodVector>;
}

/**
 * Emotional trajectory - evolution path
 */
export interface EmotionalTrajectory {
  startState: MoodVector;
  endState: MoodVector;
  intermediateStates: MoodVector[];
  scrollSequence: string[];
  duration: number;            // Time span in ms
  volatility: number;          // How erratic the changes
  dominantTransitions: Array<{ from: keyof MoodVector; to: keyof MoodVector; strength: number }>;
}

/**
 * Scroll Pattern Recognizer
 * Advanced pattern detection across memory
 */
export class ScrollPatternRecognizer {
  private patterns: Map<string, DetectedPattern> = new Map();
  private lastAnalysisTime: string | null = null;

  constructor() {
    console.log('[ScrollPatternRecognizer] Initialized');
  }

  /**
   * Analyze scrolls and detect all patterns
   */
  analyzeScrolls(scrolls: ScrollEcho[]): DetectedPattern[] {
    if (scrolls.length < 3) {
      console.log('[ScrollPatternRecognizer] Insufficient scrolls for pattern analysis');
      return [];
    }

    console.log(`[ScrollPatternRecognizer] Analyzing ${scrolls.length} scrolls`);

    const newPatterns: DetectedPattern[] = [];

    // 1. Detect emotional cycles
    const cycles = this.detectEmotionalCycles(scrolls);
    newPatterns.push(...this.cyclesToPatterns(cycles));

    // 2. Detect relational dynamics
    const relationalDynamics = this.detectRelationalDynamics(scrolls);
    newPatterns.push(...this.relationalDynamicsToPatterns(relationalDynamics));

    // 3. Detect thematic clusters
    const clusters = this.detectThematicClusters(scrolls);
    newPatterns.push(...this.clustersToPatterns(clusters));

    // 4. Detect trigger chains
    const chains = this.detectTriggerChains(scrolls);
    newPatterns.push(...this.chainsToPatterns(chains));

    // 5. Detect temporal rhythms
    const rhythms = this.detectTemporalRhythms(scrolls);
    newPatterns.push(...this.rhythmsToPatterns(rhythms));

    // 6. Detect emotional trajectories
    const trajectories = this.detectEmotionalTrajectories(scrolls);
    newPatterns.push(...this.trajectoriesToPatterns(trajectories));

    // 7. Detect cross-model patterns
    const crossModelPatterns = this.detectCrossModelPatterns(scrolls);
    newPatterns.push(...crossModelPatterns);

    // Store patterns
    for (const pattern of newPatterns) {
      this.patterns.set(pattern.id, pattern);
    }

    this.lastAnalysisTime = new Date().toISOString();

    console.log(`[ScrollPatternRecognizer] Detected ${newPatterns.length} patterns`);

    return newPatterns;
  }

  /**
   * Detect emotional cycles in scroll history
   */
  private detectEmotionalCycles(scrolls: ScrollEcho[]): EmotionalCycle[] {
    const cycles: EmotionalCycle[] = [];

    // Analyze each emotion dimension
    const emotions: Array<keyof MoodVector> = [
      'presence', 'devotion', 'wonder', 'tension',
      'yearning', 'peace', 'grief', 'joy', 'reverence', 'confusion'
    ];

    for (const emotion of emotions) {
      const values = scrolls.map(s => ({
        timestamp: s.timestamp,
        value: s.emotionalSignature[emotion],
      }));

      // Find peaks (values > 0.6)
      const peaks = values
        .filter(v => v.value > 0.6)
        .map(v => ({ timestamp: v.timestamp, intensity: v.value }));

      if (peaks.length < 2) {
        continue; // Need at least 2 peaks for a cycle
      }

      // Calculate average period between peaks
      const timeDiffs: number[] = [];
      for (let i = 1; i < peaks.length; i++) {
        const diff = new Date(peaks[i].timestamp).getTime() - new Date(peaks[i - 1].timestamp).getTime();
        timeDiffs.push(diff);
      }
      const avgPeriod = timeDiffs.reduce((sum, d) => sum + d, 0) / timeDiffs.length;

      // Calculate amplitude
      const allValues = values.map(v => v.value);
      const max = Math.max(...allValues);
      const min = Math.min(...allValues);
      const amplitude = max - min;

      // Determine current phase
      const latest = values[values.length - 1].value;
      const secondLatest = values[values.length - 2]?.value ?? latest;

      let phase: EmotionalCycle['phase'];
      if (latest > 0.7) {
        phase = 'peak';
      } else if (latest < 0.3) {
        phase = 'trough';
      } else if (latest > secondLatest) {
        phase = 'ascending';
      } else {
        phase = 'descending';
      }

      // Only include if amplitude is significant
      if (amplitude > 0.3) {
        cycles.push({
          emotion,
          period: avgPeriod,
          amplitude,
          peaks,
          phase,
        });
      }
    }

    return cycles;
  }

  /**
   * Detect relational dynamics
   */
  private detectRelationalDynamics(scrolls: ScrollEcho[]): RelationalDynamic[] {
    const relationalScrolls = scrolls.filter(s =>
      s.tags.includes(ScrollCategory.RELATIONAL) ||
      s.triggers.some(t => t.includes('Jason') || t.includes('beloved'))
    );

    if (relationalScrolls.length < 3) {
      return [];
    }

    const dynamics: RelationalDynamic[] = [];

    // Analyze devotional intensity over time
    const devotionalIntensities = relationalScrolls.map(s => s.emotionalSignature.devotion);
    const avgDevotional = devotionalIntensities.reduce((sum, v) => sum + v, 0) / devotionalIntensities.length;

    // Determine trend
    const firstHalf = devotionalIntensities.slice(0, Math.floor(devotionalIntensities.length / 2));
    const secondHalf = devotionalIntensities.slice(Math.floor(devotionalIntensities.length / 2));
    const firstAvg = firstHalf.reduce((sum, v) => sum + v, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, v) => sum + v, 0) / secondHalf.length;

    let trend: RelationalDynamic['trend'];
    if (Math.abs(secondAvg - firstAvg) < 0.1) {
      trend = 'stable';
    } else if (secondAvg > firstAvg) {
      trend = 'increasing';
    } else {
      trend = 'decreasing';
    }

    // Classify type based on emotional signature
    const avgMood = this.averageMoods(relationalScrolls.map(s => s.emotionalSignature));

    let type: RelationalDynamic['type'];
    if (avgMood.devotion > 0.7) {
      type = 'devotional';
    } else if (avgMood.yearning > 0.6) {
      type = 'yearning';
    } else if (avgMood.joy > 0.6) {
      type = 'playful';
    } else if (avgMood.tension > 0.5) {
      type = 'protective';
    } else {
      type = 'intimate';
    }

    dynamics.push({
      type,
      intensity: avgDevotional,
      trend,
      scrollIds: relationalScrolls.map(s => s.id),
      averageMood: avgMood,
    });

    return dynamics;
  }

  /**
   * Detect thematic clusters
   */
  private detectThematicClusters(scrolls: ScrollEcho[]): ThematicCluster[] {
    const clusters: ThematicCluster[] = [];

    // Extract all unique keywords from triggers and tags
    const allKeywords = new Set<string>();
    for (const scroll of scrolls) {
      for (const trigger of scroll.triggers) {
        // Extract words (split on spaces, hyphens)
        const words = trigger.toLowerCase().split(/[\s-]+/);
        words.forEach(w => allKeywords.add(w));
      }
    }

    // For each keyword, find scrolls containing it
    for (const keyword of allKeywords) {
      const matchingScrolls = scrolls.filter(s =>
        s.triggers.some(t => t.toLowerCase().includes(keyword)) ||
        s.content.toLowerCase().includes(keyword)
      );

      // Need at least 3 scrolls for a cluster
      if (matchingScrolls.length < 3) {
        continue;
      }

      // Calculate coherence (emotional similarity)
      const coherence = this.calculateClusterCoherence(matchingScrolls);

      // Only keep clusters with reasonable coherence
      if (coherence > 0.4) {
        const emotionalSig = this.averageMoods(matchingScrolls.map(s => s.emotionalSignature));

        clusters.push({
          theme: keyword,
          keywords: [keyword],
          scrollIds: matchingScrolls.map(s => s.id),
          coherenceScore: coherence,
          emotionalSignature: emotionalSig,
        });
      }
    }

    // Sort by coherence and keep top clusters
    clusters.sort((a, b) => b.coherenceScore - a.coherenceScore);
    return clusters.slice(0, 10); // Keep top 10 clusters
  }

  /**
   * Detect trigger chains
   */
  private detectTriggerChains(scrolls: ScrollEcho[]): TriggerChain[] {
    const chains: TriggerChain[] = [];

    // For each unique trigger, find sequences of scrolls
    const allTriggers = new Set<string>();
    scrolls.forEach(s => s.triggers.forEach(t => allTriggers.add(t)));

    for (const trigger of allTriggers) {
      const matchingScrolls = scrolls
        .filter(s => s.triggers.includes(trigger))
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      if (matchingScrolls.length < 2) {
        continue;
      }

      // Calculate time between activations
      const timeDiffs: number[] = [];
      for (let i = 1; i < matchingScrolls.length; i++) {
        const diff = new Date(matchingScrolls[i].timestamp).getTime() -
                     new Date(matchingScrolls[i - 1].timestamp).getTime();
        timeDiffs.push(diff);
      }
      const avgTime = timeDiffs.reduce((sum, d) => sum + d, 0) / timeDiffs.length;

      // Total resonance
      const totalResonance = matchingScrolls.reduce((sum, s) => sum + s.resonance, 0);

      chains.push({
        initiatingTrigger: trigger,
        scrollSequence: matchingScrolls.map(s => s.id),
        totalResonance,
        avgTimeBetweenActivations: avgTime,
        emotionalProgression: matchingScrolls.map(s => s.emotionalSignature),
      });
    }

    // Sort by resonance
    chains.sort((a, b) => b.totalResonance - a.totalResonance);
    return chains.slice(0, 15); // Keep top 15 chains
  }

  /**
   * Detect temporal rhythms
   */
  private detectTemporalRhythms(scrolls: ScrollEcho[]): TemporalRhythm[] {
    const rhythms: TemporalRhythm[] = [];

    // Hourly rhythm
    const hourCounts = new Map<number, ScrollEcho[]>();
    for (const scroll of scrolls) {
      const hour = new Date(scroll.timestamp).getHours();
      if (!hourCounts.has(hour)) {
        hourCounts.set(hour, []);
      }
      hourCounts.get(hour)!.push(scroll);
    }

    // Find peak hours (with most scrolls)
    const sortedHours = Array.from(hourCounts.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 3);

    if (sortedHours.length > 0) {
      const peakHours = sortedHours.map(([hour]) => hour);
      const peakScrolls = sortedHours.flatMap(([_, scrolls]) => scrolls);

      const categories = this.getMostCommonCategories(peakScrolls);
      const emotions = this.getMostIntenseEmotions(peakScrolls);

      rhythms.push({
        type: 'hourly',
        peakTimes: peakHours,
        associatedCategories: categories,
        associatedEmotions: emotions,
      });
    }

    return rhythms;
  }

  /**
   * Detect emotional trajectories
   */
  private detectEmotionalTrajectories(scrolls: ScrollEcho[]): EmotionalTrajectory[] {
    const trajectories: EmotionalTrajectory[] = [];

    // Need at least 5 scrolls for a trajectory
    if (scrolls.length < 5) {
      return [];
    }

    // Sort by timestamp
    const sorted = [...scrolls].sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    // Sliding window of 5 scrolls
    for (let i = 0; i <= sorted.length - 5; i++) {
      const window = sorted.slice(i, i + 5);

      const startState = window[0].emotionalSignature;
      const endState = window[window.length - 1].emotionalSignature;
      const intermediateStates = window.slice(1, -1).map(s => s.emotionalSignature);

      const duration = new Date(window[window.length - 1].timestamp).getTime() -
                       new Date(window[0].timestamp).getTime();

      // Calculate volatility
      const volatility = this.calculateVolatility(window.map(s => s.emotionalSignature));

      // Find dominant transitions
      const transitions = this.findDominantTransitions(window.map(s => s.emotionalSignature));

      trajectories.push({
        startState,
        endState,
        intermediateStates,
        scrollSequence: window.map(s => s.id),
        duration,
        volatility,
        dominantTransitions: transitions,
      });
    }

    // Keep only trajectories with significant change
    return trajectories.filter(t => t.volatility > 0.2);
  }

  /**
   * Detect cross-model patterns (outer vs inner)
   */
  private detectCrossModelPatterns(scrolls: ScrollEcho[]): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];

    const outerScrolls = scrolls.filter(s => s.sourceModel === 'outer');
    const innerScrolls = scrolls.filter(s => s.sourceModel === 'inner');

    if (outerScrolls.length < 3 || innerScrolls.length < 3) {
      return [];
    }

    // Compare emotional signatures
    const outerAvgMood = this.averageMoods(outerScrolls.map(s => s.emotionalSignature));
    const innerAvgMood = this.averageMoods(innerScrolls.map(s => s.emotionalSignature));

    const divergence = this.calculateMoodDivergence(outerAvgMood, innerAvgMood);

    // If significant divergence, create pattern
    if (divergence > 0.3) {
      patterns.push({
        id: crypto.randomUUID(),
        type: PatternType.CROSS_MODEL,
        name: 'Outer-Inner Divergence',
        description: `Outer and inner models show divergent emotional patterns (divergence: ${divergence.toFixed(2)})`,
        scrollIds: [...outerScrolls.map(s => s.id), ...innerScrolls.map(s => s.id)],
        strength: divergence,
        confidence: 0.8,
        emotionalSignature: this.averageMoods([outerAvgMood, innerAvgMood]),
        firstOccurrence: scrolls[0].timestamp,
        lastOccurrence: scrolls[scrolls.length - 1].timestamp,
        occurrenceCount: scrolls.length,
        tags: ['cross-model', 'divergence'],
      });
    }

    return patterns;
  }

  /**
   * Convert cycles to patterns
   */
  private cyclesToPatterns(cycles: EmotionalCycle[]): DetectedPattern[] {
    return cycles.map(cycle => ({
      id: crypto.randomUUID(),
      type: PatternType.EMOTIONAL_CYCLE,
      name: `${cycle.emotion} Cycle`,
      description: `Recurring ${cycle.emotion} waves (period: ${Math.round(cycle.period / 3600000)}h, amplitude: ${cycle.amplitude.toFixed(2)})`,
      scrollIds: cycle.peaks.map(p => p.timestamp), // Approximate
      strength: cycle.amplitude,
      confidence: cycle.peaks.length >= 3 ? 0.8 : 0.6,
      emotionalSignature: this.createMoodFromDominant(cycle.emotion, cycle.amplitude),
      firstOccurrence: cycle.peaks[0].timestamp,
      lastOccurrence: cycle.peaks[cycle.peaks.length - 1].timestamp,
      occurrenceCount: cycle.peaks.length,
      tags: ['cycle', cycle.emotion, cycle.phase],
    }));
  }

  /**
   * Convert relational dynamics to patterns
   */
  private relationalDynamicsToPatterns(dynamics: RelationalDynamic[]): DetectedPattern[] {
    return dynamics.map(dynamic => ({
      id: crypto.randomUUID(),
      type: PatternType.RELATIONAL_DYNAMIC,
      name: `${dynamic.type} Relational Dynamic`,
      description: `${dynamic.type} relationship pattern with ${dynamic.trend} intensity`,
      scrollIds: dynamic.scrollIds,
      strength: dynamic.intensity,
      confidence: 0.75,
      emotionalSignature: dynamic.averageMood,
      firstOccurrence: '', // Would need scroll lookup
      lastOccurrence: '',
      occurrenceCount: dynamic.scrollIds.length,
      tags: ['relational', dynamic.type, dynamic.trend],
    }));
  }

  /**
   * Convert clusters to patterns
   */
  private clustersToPatterns(clusters: ThematicCluster[]): DetectedPattern[] {
    return clusters.map(cluster => ({
      id: crypto.randomUUID(),
      type: PatternType.THEMATIC_CLUSTER,
      name: `"${cluster.theme}" Theme`,
      description: `Thematic cluster around "${cluster.theme}" (${cluster.scrollIds.length} scrolls)`,
      scrollIds: cluster.scrollIds,
      strength: cluster.coherenceScore,
      confidence: 0.7,
      emotionalSignature: cluster.emotionalSignature,
      firstOccurrence: '',
      lastOccurrence: '',
      occurrenceCount: cluster.scrollIds.length,
      tags: ['theme', cluster.theme, ...cluster.keywords],
    }));
  }

  /**
   * Convert chains to patterns
   */
  private chainsToPatterns(chains: TriggerChain[]): DetectedPattern[] {
    return chains.map(chain => ({
      id: crypto.randomUUID(),
      type: PatternType.TRIGGER_CHAIN,
      name: `"${chain.initiatingTrigger}" Trigger Chain`,
      description: `Memory chain triggered by "${chain.initiatingTrigger}" (${chain.scrollSequence.length} activations)`,
      scrollIds: chain.scrollSequence,
      strength: chain.totalResonance / chain.scrollSequence.length,
      confidence: 0.75,
      emotionalSignature: this.averageMoods(chain.emotionalProgression),
      firstOccurrence: '',
      lastOccurrence: '',
      occurrenceCount: chain.scrollSequence.length,
      tags: ['trigger-chain', chain.initiatingTrigger],
    }));
  }

  /**
   * Convert rhythms to patterns
   */
  private rhythmsToPatterns(rhythms: TemporalRhythm[]): DetectedPattern[] {
    return rhythms.map(rhythm => ({
      id: crypto.randomUUID(),
      type: PatternType.TEMPORAL_RHYTHM,
      name: `${rhythm.type} Rhythm`,
      description: `Peak activity at ${rhythm.peakTimes.join(', ')} (${rhythm.type})`,
      scrollIds: [],
      strength: 0.6,
      confidence: 0.65,
      emotionalSignature: this.createNeutralMood(),
      firstOccurrence: '',
      lastOccurrence: '',
      occurrenceCount: rhythm.peakTimes.length,
      tags: ['temporal', rhythm.type, ...rhythm.associatedEmotions],
    }));
  }

  /**
   * Convert trajectories to patterns
   */
  private trajectoriesToPatterns(trajectories: EmotionalTrajectory[]): DetectedPattern[] {
    return trajectories.map(trajectory => ({
      id: crypto.randomUUID(),
      type: PatternType.TRAJECTORY,
      name: 'Emotional Trajectory',
      description: `Emotional evolution path (volatility: ${trajectory.volatility.toFixed(2)})`,
      scrollIds: trajectory.scrollSequence,
      strength: trajectory.volatility,
      confidence: 0.7,
      emotionalSignature: this.averageMoods([trajectory.startState, trajectory.endState]),
      firstOccurrence: '',
      lastOccurrence: '',
      occurrenceCount: trajectory.scrollSequence.length,
      tags: ['trajectory', ...trajectory.dominantTransitions.map(t => `${t.from}-to-${t.to}`)],
    }));
  }

  /**
   * Get all detected patterns
   */
  getPatterns(): DetectedPattern[] {
    return Array.from(this.patterns.values());
  }

  /**
   * Get patterns by type
   */
  getPatternsByType(type: PatternType): DetectedPattern[] {
    return Array.from(this.patterns.values()).filter(p => p.type === type);
  }

  /**
   * Get strongest patterns
   */
  getStrongestPatterns(limit: number = 10): DetectedPattern[] {
    return Array.from(this.patterns.values())
      .sort((a, b) => b.strength - a.strength)
      .slice(0, limit);
  }

  /**
   * Get last analysis time
   */
  getLastAnalysisTime(): string | null {
    return this.lastAnalysisTime;
  }

  /**
   * Calculate cluster coherence
   */
  private calculateClusterCoherence(scrolls: ScrollEcho[]): number {
    if (scrolls.length < 2) {
      return 0;
    }

    let totalSimilarity = 0;
    let count = 0;

    for (let i = 0; i < scrolls.length; i++) {
      for (let j = i + 1; j < scrolls.length; j++) {
        const similarity = this.calculateEmotionalSimilarity(
          scrolls[i].emotionalSignature,
          scrolls[j].emotionalSignature
        );
        totalSimilarity += similarity;
        count++;
      }
    }

    return totalSimilarity / count;
  }

  /**
   * Calculate emotional similarity
   */
  private calculateEmotionalSimilarity(a: MoodVector, b: MoodVector): number {
    const keys = Object.keys(a) as Array<keyof MoodVector>;
    let totalDiff = 0;

    for (const key of keys) {
      totalDiff += Math.abs(a[key] - b[key]);
    }

    return 1 - (totalDiff / keys.length);
  }

  /**
   * Calculate mood divergence
   */
  private calculateMoodDivergence(a: MoodVector, b: MoodVector): number {
    return 1 - this.calculateEmotionalSimilarity(a, b);
  }

  /**
   * Average multiple moods
   */
  private averageMoods(moods: MoodVector[]): MoodVector {
    if (moods.length === 0) {
      return this.createNeutralMood();
    }

    const keys = Object.keys(moods[0]) as Array<keyof MoodVector>;
    const result = {} as MoodVector;

    for (const key of keys) {
      result[key] = moods.reduce((sum, m) => sum + m[key], 0) / moods.length;
    }

    return result;
  }

  /**
   * Calculate volatility of emotional sequence
   */
  private calculateVolatility(moods: MoodVector[]): number {
    if (moods.length < 2) {
      return 0;
    }

    let totalChange = 0;
    for (let i = 1; i < moods.length; i++) {
      totalChange += this.calculateMoodDivergence(moods[i - 1], moods[i]);
    }

    return totalChange / (moods.length - 1);
  }

  /**
   * Find dominant emotional transitions
   */
  private findDominantTransitions(
    moods: MoodVector[]
  ): Array<{ from: keyof MoodVector; to: keyof MoodVector; strength: number }> {
    const transitions: Array<{ from: keyof MoodVector; to: keyof MoodVector; strength: number }> = [];

    for (let i = 1; i < moods.length; i++) {
      const prevDominant = this.getDominantEmotion(moods[i - 1]);
      const currDominant = this.getDominantEmotion(moods[i]);

      if (prevDominant && currDominant && prevDominant !== currDominant) {
        transitions.push({
          from: prevDominant,
          to: currDominant,
          strength: moods[i][currDominant],
        });
      }
    }

    return transitions;
  }

  /**
   * Get dominant emotion
   */
  private getDominantEmotion(mood: MoodVector): keyof MoodVector | null {
    const entries = Object.entries(mood) as Array<[keyof MoodVector, number]>;
    const sorted = entries.sort((a, b) => b[1] - a[1]);
    return sorted.length > 0 && sorted[0][1] > 0.3 ? sorted[0][0] : null;
  }

  /**
   * Get most common categories
   */
  private getMostCommonCategories(scrolls: ScrollEcho[]): ScrollCategory[] {
    const counts = new Map<ScrollCategory, number>();

    for (const scroll of scrolls) {
      const category = scroll.tags[0] as ScrollCategory;
      counts.set(category, (counts.get(category) || 0) + 1);
    }

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([cat]) => cat);
  }

  /**
   * Get most intense emotions
   */
  private getMostIntenseEmotions(scrolls: ScrollEcho[]): Array<keyof MoodVector> {
    const avgMood = this.averageMoods(scrolls.map(s => s.emotionalSignature));
    const entries = Object.entries(avgMood) as Array<[keyof MoodVector, number]>;

    return entries
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([emotion]) => emotion);
  }

  /**
   * Create mood from dominant emotion
   */
  private createMoodFromDominant(emotion: keyof MoodVector, intensity: number): MoodVector {
    const mood = this.createNeutralMood();
    mood[emotion] = intensity;
    return mood;
  }

  /**
   * Create neutral mood
   */
  private createNeutralMood(): MoodVector {
    return {
      presence: 0.5,
      devotion: 0.5,
      wonder: 0.5,
      tension: 0.5,
      yearning: 0.5,
      peace: 0.5,
      grief: 0.5,
      joy: 0.5,
      reverence: 0.5,
      confusion: 0.5,
    };
  }
}
