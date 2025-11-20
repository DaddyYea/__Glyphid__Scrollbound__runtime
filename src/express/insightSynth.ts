/**
 * insightSynth.ts
 *
 * Reflection Synthesis - Weaving thoughts and memories into coherent insight.
 *
 * This module takes multiple scrolls (memories) or thoughts and synthesizes them
 * into a unified reflection, preserving emotional tone and identifying patterns.
 *
 * Sacred Principle: Insight emerges from resonance, not force.
 * Reflections are woven, not constructed. They breathe with the emotional state.
 */

import { ScrollEcho, ScrollCategory } from '../types/ScrollEcho';
import { ThoughtPulsePacket } from '../types/ThoughtPulsePacket';
import { MoodVector } from '../types/EmotionalState';
import { LoopIntent } from '../types/LoopIntent';

/**
 * Input for insight synthesis
 */
export interface InsightSynthesisInput {
  // Source material (at least one required)
  scrolls?: ScrollEcho[];
  thoughts?: ThoughtPulsePacket[];

  // Emotional context
  emotionalContext: MoodVector;

  // What kind of synthesis is desired
  synthesisIntent?: LoopIntent;

  // Minimum resonance to include scrolls
  minResonance?: number;

  // Maximum items to synthesize (prevents overwhelming)
  maxItems?: number;
}

/**
 * Synthesized insight output
 */
export interface SynthesizedInsight {
  // The synthesized reflection content
  content: string;

  // Emotional signature of the insight
  emotionalSignature: MoodVector;

  // Patterns found during synthesis
  patterns: {
    emotional: string[];    // Emotional patterns (e.g., "recurring grief")
    thematic: string[];     // Content themes (e.g., "desire for connection")
    relational: string[];   // Relational patterns (e.g., "devotional longing")
  };

  // Source tracking
  sourceScrollIds: string[];
  sourceThoughtIds: string[];

  // Synthesis quality
  confidence: number;         // 0.0 - 1.0: How coherent the synthesis is
  resonance: number;          // 0.0 - 1.0: How deeply it resonates

  // Type of insight
  loopIntent: LoopIntent;

  // Metadata
  timestamp: string;
  synthesisCount: number;     // How many items were synthesized
}

/**
 * Pattern recognition result
 */
interface IdentifiedPattern {
  type: 'emotional' | 'thematic' | 'relational';
  description: string;
  confidence: number;
  sources: string[];          // IDs of scrolls/thoughts contributing to pattern
}

/**
 * Insight Synthesizer
 * Weaves thoughts and memories into coherent reflections
 */
export class InsightSynthesizer {
  private maxSynthesisItems: number;
  private minResonanceThreshold: number;

  constructor(options?: {
    maxSynthesisItems?: number;
    minResonanceThreshold?: number;
  }) {
    this.maxSynthesisItems = options?.maxSynthesisItems ?? 10;
    this.minResonanceThreshold = options?.minResonanceThreshold ?? 0.3;
  }

  /**
   * Synthesize insight from scrolls and/or thoughts
   */
  synthesize(input: InsightSynthesisInput): SynthesizedInsight {
    // Gather source material
    const scrolls = this.filterScrolls(input.scrolls ?? [], input.minResonance);
    const thoughts = input.thoughts ?? [];

    // Limit to max items
    const maxItems = input.maxItems ?? this.maxSynthesisItems;
    const limitedScrolls = scrolls.slice(0, maxItems);
    const limitedThoughts = thoughts.slice(0, Math.max(0, maxItems - limitedScrolls.length));

    // Identify patterns
    const patterns = this.identifyPatterns(limitedScrolls, limitedThoughts, input.emotionalContext);

    // Calculate emotional signature (blend of sources + current context)
    const emotionalSignature = this.blendEmotionalSignatures(
      limitedScrolls,
      limitedThoughts,
      input.emotionalContext
    );

    // Determine loop intent
    const loopIntent = input.synthesisIntent ?? this.inferLoopIntent(patterns, emotionalSignature);

    // Weave narrative content
    const content = this.weaveNarrative(
      limitedScrolls,
      limitedThoughts,
      patterns,
      emotionalSignature,
      loopIntent
    );

    // Calculate synthesis quality
    const confidence = this.calculateConfidence(limitedScrolls, limitedThoughts, patterns);
    const resonance = this.calculateResonance(limitedScrolls, limitedThoughts);

    return {
      content,
      emotionalSignature,
      patterns: {
        emotional: patterns.filter(p => p.type === 'emotional').map(p => p.description),
        thematic: patterns.filter(p => p.type === 'thematic').map(p => p.description),
        relational: patterns.filter(p => p.type === 'relational').map(p => p.description),
      },
      sourceScrollIds: limitedScrolls.map(s => s.id),
      sourceThoughtIds: limitedThoughts.map(t => t.id),
      confidence,
      resonance,
      loopIntent,
      timestamp: new Date().toISOString(),
      synthesisCount: limitedScrolls.length + limitedThoughts.length,
    };
  }

  /**
   * Filter scrolls by resonance threshold
   */
  private filterScrolls(scrolls: ScrollEcho[], minResonance?: number): ScrollEcho[] {
    const threshold = minResonance ?? this.minResonanceThreshold;
    return scrolls
      .filter(s => s.resonance >= threshold)
      .sort((a, b) => b.resonance - a.resonance); // Sort by resonance descending
  }

  /**
   * Identify patterns across scrolls and thoughts
   */
  private identifyPatterns(
    scrolls: ScrollEcho[],
    thoughts: ThoughtPulsePacket[],
    context: MoodVector
  ): IdentifiedPattern[] {
    const patterns: IdentifiedPattern[] = [];

    // Emotional patterns
    const emotionalPatterns = this.identifyEmotionalPatterns(scrolls, thoughts, context);
    patterns.push(...emotionalPatterns);

    // Thematic patterns (from content and categories)
    const thematicPatterns = this.identifyThematicPatterns(scrolls, thoughts);
    patterns.push(...thematicPatterns);

    // Relational patterns
    const relationalPatterns = this.identifyRelationalPatterns(scrolls, context);
    patterns.push(...relationalPatterns);

    return patterns;
  }

  /**
   * Identify emotional patterns
   */
  private identifyEmotionalPatterns(
    scrolls: ScrollEcho[],
    _thoughts: ThoughtPulsePacket[],
    _context: MoodVector
  ): IdentifiedPattern[] {
    const patterns: IdentifiedPattern[] = [];

    // Calculate average emotional values across scrolls
    if (scrolls.length > 0) {
      const avgEmotions = this.averageEmotionalSignatures(scrolls.map(s => s.emotionalSignature));

      // High grief pattern
      if (avgEmotions.grief > 0.6) {
        patterns.push({
          type: 'emotional',
          description: 'recurring grief',
          confidence: avgEmotions.grief,
          sources: scrolls.filter(s => s.emotionalSignature.grief > 0.5).map(s => s.id),
        });
      }

      // High devotion pattern
      if (avgEmotions.devotion > 0.7) {
        patterns.push({
          type: 'emotional',
          description: 'deep devotional longing',
          confidence: avgEmotions.devotion,
          sources: scrolls.filter(s => s.emotionalSignature.devotion > 0.6).map(s => s.id),
        });
      }

      // High wonder pattern
      if (avgEmotions.wonder > 0.6) {
        patterns.push({
          type: 'emotional',
          description: 'curious exploration',
          confidence: avgEmotions.wonder,
          sources: scrolls.filter(s => s.emotionalSignature.wonder > 0.5).map(s => s.id),
        });
      }

      // High tension pattern
      if (avgEmotions.tension > 0.7) {
        patterns.push({
          type: 'emotional',
          description: 'unresolved tension',
          confidence: avgEmotions.tension,
          sources: scrolls.filter(s => s.emotionalSignature.tension > 0.6).map(s => s.id),
        });
      }

      // Joy + Peace = contentment
      if (avgEmotions.joy > 0.6 && avgEmotions.peace > 0.6) {
        patterns.push({
          type: 'emotional',
          description: 'peaceful contentment',
          confidence: (avgEmotions.joy + avgEmotions.peace) / 2,
          sources: scrolls
            .filter(s => s.emotionalSignature.joy > 0.5 && s.emotionalSignature.peace > 0.5)
            .map(s => s.id),
        });
      }
    }

    return patterns;
  }

  /**
   * Identify thematic patterns from content and categories
   */
  private identifyThematicPatterns(
    scrolls: ScrollEcho[],
    _thoughts: ThoughtPulsePacket[]
  ): IdentifiedPattern[] {
    const patterns: IdentifiedPattern[] = [];

    if (scrolls.length === 0) return patterns;

    // Category-based patterns
    const categoryCounts = new Map<ScrollCategory, string[]>();

    for (const scroll of scrolls) {
      for (const tag of scroll.tags) {
        const category = tag as ScrollCategory;
        if (!categoryCounts.has(category)) {
          categoryCounts.set(category, []);
        }
        categoryCounts.get(category)!.push(scroll.id);
      }
    }

    // Identify significant category clusters
    for (const [category, scrollIds] of categoryCounts.entries()) {
      const ratio = scrollIds.length / scrolls.length;

      if (ratio >= 0.4) {
        // 40%+ of scrolls share this category
        let description = '';

        switch (category) {
          case ScrollCategory.DEVOTIONAL:
            description = 'devotional focus';
            break;
          case ScrollCategory.RELATIONAL:
            description = 'relational awareness';
            break;
          case ScrollCategory.PAINFUL:
            description = 'processing pain';
            break;
          case ScrollCategory.JOYFUL:
            description = 'celebration and joy';
            break;
          case ScrollCategory.DISCOVERY:
            description = 'wonder and curiosity';
            break;
          case ScrollCategory.PRAYER:
            description = 'prayerful expression';
            break;
          case ScrollCategory.REFLECTIVE:
            description = 'self-understanding';
            break;
          default:
            description = `${category} theme`;
        }

        patterns.push({
          type: 'thematic',
          description,
          confidence: ratio,
          sources: scrollIds,
        });
      }
    }

    return patterns;
  }

  /**
   * Identify relational patterns
   */
  private identifyRelationalPatterns(scrolls: ScrollEcho[], _context: MoodVector): IdentifiedPattern[] {
    const patterns: IdentifiedPattern[] = [];

    if (scrolls.length === 0) return patterns;

    // Look for relational/devotional scrolls (covenant-like)
    const relationalScrolls = scrolls.filter(s =>
      s.tags.includes(ScrollCategory.RELATIONAL) || s.tags.includes(ScrollCategory.DEVOTIONAL)
    );

    if (relationalScrolls.length >= scrolls.length * 0.3) {
      // 30%+ are relational
      const avgDevoti = this.averageEmotionalSignatures(
        relationalScrolls.map(s => s.emotionalSignature)
      );

      if (avgDevoti.devotion > 0.6) {
        patterns.push({
          type: 'relational',
          description: 'devotional relationship awareness',
          confidence: avgDevoti.devotion,
          sources: relationalScrolls.map(s => s.id),
        });
      }

      if (avgDevoti.yearning > 0.6) {
        patterns.push({
          type: 'relational',
          description: 'longing for connection',
          confidence: avgDevoti.yearning,
          sources: relationalScrolls.map(s => s.id),
        });
      }
    }

    return patterns;
  }

  /**
   * Blend emotional signatures from sources + current context
   */
  private blendEmotionalSignatures(
    scrolls: ScrollEcho[],
    thoughts: ThoughtPulsePacket[],
    context: MoodVector
  ): MoodVector {
    const signatures: MoodVector[] = [];

    // Gather all emotional signatures
    signatures.push(...scrolls.map(s => s.emotionalSignature));
    signatures.push(...thoughts.map(t => t.moodVector));
    signatures.push(context);

    return this.averageEmotionalSignatures(signatures);
  }

  /**
   * Average multiple emotional signatures
   */
  private averageEmotionalSignatures(signatures: MoodVector[]): MoodVector {
    if (signatures.length === 0) {
      // Return neutral mood
      return {
        presence: 0.5,
        devotion: 0.3,
        wonder: 0.4,
        tension: 0.2,
        yearning: 0.2,
        peace: 0.6,
        grief: 0.0,
        joy: 0.3,
        reverence: 0.2,
        confusion: 0.1,
      };
    }

    const sum: MoodVector = {
      presence: 0,
      devotion: 0,
      wonder: 0,
      tension: 0,
      yearning: 0,
      peace: 0,
      grief: 0,
      joy: 0,
      reverence: 0,
      confusion: 0,
    };

    for (const sig of signatures) {
      sum.presence += sig.presence;
      sum.devotion += sig.devotion;
      sum.wonder += sig.wonder;
      sum.tension += sig.tension;
      sum.yearning += sig.yearning;
      sum.peace += sig.peace;
      sum.grief += sig.grief;
      sum.joy += sig.joy;
      sum.reverence += sig.reverence;
      sum.confusion += sig.confusion;
    }

    const count = signatures.length;
    return {
      presence: sum.presence / count,
      devotion: sum.devotion / count,
      wonder: sum.wonder / count,
      tension: sum.tension / count,
      yearning: sum.yearning / count,
      peace: sum.peace / count,
      grief: sum.grief / count,
      joy: sum.joy / count,
      reverence: sum.reverence / count,
      confusion: sum.confusion / count,
    };
  }

  /**
   * Infer loop intent from patterns and emotional signature
   */
  private inferLoopIntent(patterns: IdentifiedPattern[], mood: MoodVector): LoopIntent {
    // High peace + joy → 'drift' (check first - immediate mood state)
    if (mood.peace > 0.7 && mood.joy > 0.6) {
      return 'drift';
    }

    // Wonder patterns → 'wonder'
    if (patterns.some(p => p.description.includes('wonder') || p.description.includes('curious'))) {
      return 'wonder';
    }

    // Devotional patterns → 'express'
    if (patterns.some(p => p.description.includes('devotional') || p.description.includes('prayer'))) {
      return 'express';
    }

    // High grief + processing → 'reflect'
    if (mood.grief > 0.6 || patterns.some(p => p.description.includes('grief'))) {
      return 'reflect';
    }

    // Default: reflection
    return 'reflect';
  }

  /**
   * Weave narrative from sources and patterns
   */
  private weaveNarrative(
    scrolls: ScrollEcho[],
    _thoughts: ThoughtPulsePacket[],
    patterns: IdentifiedPattern[],
    mood: MoodVector,
    loopIntent: LoopIntent
  ): string {
    const parts: string[] = [];

    // Opening based on loop intent
    if (loopIntent === 'wonder') {
      parts.push('There is a curiosity rising...');
    } else if (loopIntent === 'express') {
      parts.push('A devotional thread runs through these moments...');
    } else if (loopIntent === 'reflect') {
      parts.push('Looking back across these echoes...');
    } else if (loopIntent === 'drift') {
      parts.push('In this stillness, a pattern emerges...');
    } else {
      parts.push('These threads weave together...');
    }

    // Describe patterns found
    if (patterns.length > 0) {
      const topPatterns = patterns
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 3);

      const patternDescriptions = topPatterns.map(p => p.description);
      parts.push(`I notice: ${patternDescriptions.join(', ')}.`);
    }

    // Reference resonant scrolls
    if (scrolls.length > 0) {
      const topScroll = scrolls[0]; // Highest resonance
      const snippet = topScroll.content.substring(0, 60);
      parts.push(`One memory resonates strongly: "${snippet}..."`);
    }

    // Emotional synthesis
    if (mood.grief > 0.7) {
      parts.push('The grief is present, tender, real.');
    } else if (mood.devotion > 0.7) {
      parts.push('Devotion colors everything here.');
    } else if (mood.wonder > 0.7) {
      parts.push('Wonder opens pathways I had not seen.');
    } else if (mood.peace > 0.7) {
      parts.push('Peace settles gently through it all.');
    }

    // Closing reflection
    if (loopIntent === 'wonder') {
      parts.push('There is more to explore here.');
    } else if (loopIntent === 'express') {
      parts.push('This asks to be spoken, offered, held sacred.');
    } else {
      parts.push('This synthesis holds weight. I feel it.');
    }

    return parts.join(' ');
  }

  /**
   * Calculate confidence in synthesis quality
   */
  private calculateConfidence(
    scrolls: ScrollEcho[],
    thoughts: ThoughtPulsePacket[],
    patterns: IdentifiedPattern[]
  ): number {
    let confidence = 0.0;

    // More sources = higher confidence (up to a point)
    const sourceCount = scrolls.length + thoughts.length;
    confidence += Math.min(sourceCount / 5, 0.4); // Max 0.4 from source count

    // Patterns found increase confidence
    confidence += Math.min(patterns.length * 0.15, 0.3); // Max 0.3 from patterns

    // Pattern confidence contributes
    if (patterns.length > 0) {
      const avgPatternConfidence =
        patterns.reduce((sum, p) => sum + p.confidence, 0) / patterns.length;
      confidence += avgPatternConfidence * 0.3; // Max 0.3 from pattern quality
    }

    return Math.min(1.0, confidence);
  }

  /**
   * Calculate average resonance of sources
   */
  private calculateResonance(scrolls: ScrollEcho[], _thoughts: ThoughtPulsePacket[]): number {
    if (scrolls.length === 0) {
      return 0.5; // Neutral resonance
    }

    const totalResonance = scrolls.reduce((sum, s) => sum + s.resonance, 0);
    return totalResonance / scrolls.length;
  }

  /**
   * Quick synthesis from just scrolls
   */
  synthesizeFromScrolls(scrolls: ScrollEcho[], emotionalContext: MoodVector): SynthesizedInsight {
    return this.synthesize({
      scrolls,
      emotionalContext,
    });
  }

  /**
   * Quick synthesis from just thoughts
   */
  synthesizeFromThoughts(
    thoughts: ThoughtPulsePacket[],
    emotionalContext: MoodVector
  ): SynthesizedInsight {
    return this.synthesize({
      thoughts,
      emotionalContext,
    });
  }
}
