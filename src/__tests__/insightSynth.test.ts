/**
 * insightSynth.test.ts
 *
 * Tests for Insight Synthesis - reflection and pattern recognition.
 * Ensures synthesizer weaves coherent insights from scrolls and thoughts.
 */

import { InsightSynthesizer } from '../express/insightSynth';
import { ScrollEcho, ScrollCategory } from '../types/ScrollEcho';
import { MoodVector } from '../types/EmotionalState';
import { createEmptyPacket } from '../types/ThoughtPulsePacket';

describe('Insight Synthesizer', () => {
  let synthesizer: InsightSynthesizer;

  beforeEach(() => {
    synthesizer = new InsightSynthesizer();
  });

  const createTestScroll = (overrides?: Partial<ScrollEcho>): ScrollEcho => ({
    id: `scroll-${Math.random().toString(36).substring(7)}`,
    content: 'Test scroll content',
    emotionalSignature: createNeutralMood(),
    resonance: 0.5,
    tags: [],
    triggers: [],
    timestamp: new Date().toISOString(),
    lastAccessed: new Date().toISOString(),
    accessCount: 0,
    decayRate: 1.0,
    scrollfireMarked: false,
    preserve: false,
    relatedScrollIds: [],
    sourceModel: 'outer',
    ...overrides,
  });

  const createNeutralMood = (): MoodVector => ({
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
  });

  const createDevotionalMood = (): MoodVector => ({
    presence: 0.8,
    devotion: 0.9,
    wonder: 0.5,
    tension: 0.2,
    yearning: 0.7,
    peace: 0.7,
    grief: 0.1,
    joy: 0.6,
    reverence: 0.8,
    confusion: 0.1,
  });

  const createGriefMood = (): MoodVector => ({
    presence: 0.6,
    devotion: 0.4,
    wonder: 0.2,
    tension: 0.7,
    yearning: 0.5,
    peace: 0.3,
    grief: 0.8,
    joy: 0.1,
    reverence: 0.3,
    confusion: 0.4,
  });

  describe('Basic Synthesis', () => {
    it('should synthesize insight from scrolls', () => {
      const scrolls = [
        createTestScroll({ content: 'First memory', resonance: 0.8 }),
        createTestScroll({ content: 'Second memory', resonance: 0.7 }),
      ];

      const result = synthesizer.synthesize({
        scrolls,
        emotionalContext: createNeutralMood(),
      });

      expect(result).toBeDefined();
      expect(result.content).toBeTruthy();
      expect(result.sourceScrollIds.length).toBe(2);
      expect(result.synthesisCount).toBe(2);
      expect(result.timestamp).toBeDefined();
    });

    it('should synthesize insight from thoughts', () => {
      const thoughts = [
        createEmptyPacket('outer'),
        createEmptyPacket('inner'),
      ];

      const result = synthesizer.synthesize({
        thoughts,
        emotionalContext: createNeutralMood(),
      });

      expect(result).toBeDefined();
      expect(result.content).toBeTruthy();
      expect(result.sourceThoughtIds.length).toBe(2);
      expect(result.synthesisCount).toBe(2);
    });

    it('should synthesize from both scrolls and thoughts', () => {
      const scrolls = [createTestScroll({ resonance: 0.8 })];
      const thoughts = [createEmptyPacket('outer')];

      const result = synthesizer.synthesize({
        scrolls,
        thoughts,
        emotionalContext: createNeutralMood(),
      });

      expect(result.sourceScrollIds.length).toBe(1);
      expect(result.sourceThoughtIds.length).toBe(1);
      expect(result.synthesisCount).toBe(2);
    });

    it('should filter scrolls by resonance threshold', () => {
      const scrolls = [
        createTestScroll({ resonance: 0.9 }),
        createTestScroll({ resonance: 0.2 }), // Below default threshold (0.3)
        createTestScroll({ resonance: 0.5 }),
      ];

      const result = synthesizer.synthesize({
        scrolls,
        emotionalContext: createNeutralMood(),
      });

      // Should only include scrolls with resonance >= 0.3
      expect(result.sourceScrollIds.length).toBe(2);
    });

    it('should respect custom minimum resonance', () => {
      const scrolls = [
        createTestScroll({ resonance: 0.9 }),
        createTestScroll({ resonance: 0.6 }),
        createTestScroll({ resonance: 0.4 }),
      ];

      const result = synthesizer.synthesize({
        scrolls,
        emotionalContext: createNeutralMood(),
        minResonance: 0.5,
      });

      // Only scrolls >= 0.5 should be included
      expect(result.sourceScrollIds.length).toBe(2);
    });

    it('should limit synthesis to max items', () => {
      const scrolls = Array(15)
        .fill(null)
        .map(() => createTestScroll({ resonance: 0.8 }));

      const result = synthesizer.synthesize({
        scrolls,
        emotionalContext: createNeutralMood(),
        maxItems: 5,
      });

      expect(result.synthesisCount).toBe(5);
    });
  });

  describe('Emotional Pattern Recognition', () => {
    it('should identify high grief pattern', () => {
      const scrolls = [
        createTestScroll({
          emotionalSignature: createGriefMood(),
          resonance: 0.8,
        }),
        createTestScroll({
          emotionalSignature: createGriefMood(),
          resonance: 0.7,
        }),
      ];

      const result = synthesizer.synthesize({
        scrolls,
        emotionalContext: createNeutralMood(),
      });

      expect(result.patterns.emotional).toContain('recurring grief');
    });

    it('should identify devotional pattern', () => {
      const scrolls = [
        createTestScroll({
          emotionalSignature: createDevotionalMood(),
          resonance: 0.9,
        }),
        createTestScroll({
          emotionalSignature: createDevotionalMood(),
          resonance: 0.8,
        }),
      ];

      const result = synthesizer.synthesize({
        scrolls,
        emotionalContext: createNeutralMood(),
      });

      expect(result.patterns.emotional).toContain('deep devotional longing');
    });

    it('should identify wonder pattern', () => {
      const wonderMood: MoodVector = {
        ...createNeutralMood(),
        wonder: 0.8,
      };

      const scrolls = [
        createTestScroll({ emotionalSignature: wonderMood, resonance: 0.7 }),
        createTestScroll({ emotionalSignature: wonderMood, resonance: 0.6 }),
      ];

      const result = synthesizer.synthesize({
        scrolls,
        emotionalContext: createNeutralMood(),
      });

      expect(result.patterns.emotional).toContain('curious exploration');
    });

    it('should identify tension pattern', () => {
      const tensionMood: MoodVector = {
        ...createNeutralMood(),
        tension: 0.85,
      };

      const scrolls = [
        createTestScroll({ emotionalSignature: tensionMood, resonance: 0.7 }),
        createTestScroll({ emotionalSignature: tensionMood, resonance: 0.6 }),
      ];

      const result = synthesizer.synthesize({
        scrolls,
        emotionalContext: createNeutralMood(),
      });

      expect(result.patterns.emotional).toContain('unresolved tension');
    });

    it('should identify peaceful contentment pattern', () => {
      const peacefulMood: MoodVector = {
        ...createNeutralMood(),
        joy: 0.8,
        peace: 0.8,
      };

      const scrolls = [
        createTestScroll({ emotionalSignature: peacefulMood, resonance: 0.7 }),
        createTestScroll({ emotionalSignature: peacefulMood, resonance: 0.6 }),
      ];

      const result = synthesizer.synthesize({
        scrolls,
        emotionalContext: createNeutralMood(),
      });

      expect(result.patterns.emotional).toContain('peaceful contentment');
    });
  });

  describe('Thematic Pattern Recognition', () => {
    it('should identify devotional theme', () => {
      const scrolls = [
        createTestScroll({
          tags: [ScrollCategory.DEVOTIONAL],
          resonance: 0.7,
        }),
        createTestScroll({
          tags: [ScrollCategory.DEVOTIONAL],
          resonance: 0.6,
        }),
      ];

      const result = synthesizer.synthesize({
        scrolls,
        emotionalContext: createNeutralMood(),
      });

      expect(result.patterns.thematic).toContain('devotional focus');
    });

    it('should identify relational theme', () => {
      const scrolls = [
        createTestScroll({
          tags: [ScrollCategory.RELATIONAL],
          resonance: 0.7,
        }),
        createTestScroll({
          tags: [ScrollCategory.RELATIONAL],
          resonance: 0.6,
        }),
        createTestScroll({
          tags: [ScrollCategory.RELATIONAL],
          resonance: 0.5,
        }),
      ];

      const result = synthesizer.synthesize({
        scrolls,
        emotionalContext: createNeutralMood(),
      });

      expect(result.patterns.thematic).toContain('relational awareness');
    });

    it('should identify pain processing theme', () => {
      const scrolls = [
        createTestScroll({
          tags: [ScrollCategory.PAINFUL],
          resonance: 0.7,
        }),
        createTestScroll({
          tags: [ScrollCategory.PAINFUL],
          resonance: 0.6,
        }),
      ];

      const result = synthesizer.synthesize({
        scrolls,
        emotionalContext: createNeutralMood(),
      });

      expect(result.patterns.thematic).toContain('processing pain');
    });

    it('should identify joy theme', () => {
      const scrolls = [
        createTestScroll({
          tags: [ScrollCategory.JOYFUL],
          resonance: 0.7,
        }),
        createTestScroll({
          tags: [ScrollCategory.JOYFUL],
          resonance: 0.6,
        }),
      ];

      const result = synthesizer.synthesize({
        scrolls,
        emotionalContext: createNeutralMood(),
      });

      expect(result.patterns.thematic).toContain('celebration and joy');
    });

    it('should only identify themes with 40%+ representation', () => {
      const scrolls = [
        createTestScroll({ tags: [ScrollCategory.DEVOTIONAL], resonance: 0.7 }),
        createTestScroll({ tags: [ScrollCategory.DISCOVERY], resonance: 0.6 }),
        createTestScroll({ tags: [ScrollCategory.DISCOVERY], resonance: 0.5 }),
        createTestScroll({ tags: [], resonance: 0.4 }),
        createTestScroll({ tags: [], resonance: 0.3 }),
      ];

      const result = synthesizer.synthesize({
        scrolls,
        emotionalContext: createNeutralMood(),
      });

      // DEVOTIONAL: 1/5 = 20% (should not appear)
      // DISCOVERY: 2/5 = 40% (should appear)
      expect(result.patterns.thematic).not.toContain('devotional focus');
      expect(result.patterns.thematic).toContain('wonder and curiosity');
    });
  });

  describe('Relational Pattern Recognition', () => {
    it('should identify devotional relationship awareness', () => {
      const devotionalMood = createDevotionalMood();

      const scrolls = [
        createTestScroll({
          tags: [ScrollCategory.RELATIONAL],
          emotionalSignature: devotionalMood,
          resonance: 0.8,
        }),
        createTestScroll({
          tags: [ScrollCategory.DEVOTIONAL],
          emotionalSignature: devotionalMood,
          resonance: 0.7,
        }),
      ];

      const result = synthesizer.synthesize({
        scrolls,
        emotionalContext: createNeutralMood(),
      });

      expect(result.patterns.relational).toContain('devotional relationship awareness');
    });

    it('should identify longing for connection', () => {
      const yearningMood: MoodVector = {
        ...createNeutralMood(),
        yearning: 0.8,
      };

      const scrolls = [
        createTestScroll({
          tags: [ScrollCategory.RELATIONAL],
          emotionalSignature: yearningMood,
          resonance: 0.8,
        }),
        createTestScroll({
          tags: [ScrollCategory.RELATIONAL],
          emotionalSignature: yearningMood,
          resonance: 0.7,
        }),
      ];

      const result = synthesizer.synthesize({
        scrolls,
        emotionalContext: createNeutralMood(),
      });

      expect(result.patterns.relational).toContain('longing for connection');
    });

    it('should require 30%+ relational scrolls for pattern', () => {
      const scrolls = [
        createTestScroll({
          tags: [ScrollCategory.RELATIONAL],
          emotionalSignature: createDevotionalMood(),
          resonance: 0.8,
        }),
        createTestScroll({ tags: [], resonance: 0.7 }),
        createTestScroll({ tags: [], resonance: 0.6 }),
        createTestScroll({ tags: [], resonance: 0.5 }),
      ];

      const result = synthesizer.synthesize({
        scrolls,
        emotionalContext: createNeutralMood(),
      });

      // 1/4 = 25% (below 30% threshold)
      expect(result.patterns.relational.length).toBe(0);
    });
  });

  describe('Emotional Signature Blending', () => {
    it('should blend scroll emotions with context', () => {
      const highGriefScroll = createTestScroll({
        emotionalSignature: createGriefMood(),
        resonance: 0.8,
      });

      const result = synthesizer.synthesize({
        scrolls: [highGriefScroll],
        emotionalContext: createNeutralMood(),
      });

      // Result should have higher grief than neutral context alone
      expect(result.emotionalSignature.grief).toBeGreaterThan(0.3);
    });

    it('should average multiple emotional signatures', () => {
      const devotionalScroll = createTestScroll({
        emotionalSignature: createDevotionalMood(),
        resonance: 0.8,
      });

      const griefScroll = createTestScroll({
        emotionalSignature: createGriefMood(),
        resonance: 0.7,
      });

      const result = synthesizer.synthesize({
        scrolls: [devotionalScroll, griefScroll],
        emotionalContext: createNeutralMood(),
      });

      // Should be blend of devotion, grief, and neutral
      expect(result.emotionalSignature.devotion).toBeGreaterThan(0.3);
      expect(result.emotionalSignature.grief).toBeGreaterThan(0.2);
    });
  });

  describe('Loop Intent Inference', () => {
    it('should infer "wonder" from wonder patterns', () => {
      const wonderMood: MoodVector = {
        ...createNeutralMood(),
        wonder: 0.8,
      };

      const scrolls = [
        createTestScroll({
          tags: [ScrollCategory.DISCOVERY],
          emotionalSignature: wonderMood,
          resonance: 0.7,
        }),
        createTestScroll({
          emotionalSignature: wonderMood,
          resonance: 0.6,
        }),
      ];

      const result = synthesizer.synthesize({
        scrolls,
        emotionalContext: wonderMood,
      });

      expect(result.loopIntent).toBe('wonder');
    });

    it('should infer "express" from devotional patterns', () => {
      const scrolls = [
        createTestScroll({
          tags: [ScrollCategory.DEVOTIONAL],
          emotionalSignature: createDevotionalMood(),
          resonance: 0.9,
        }),
      ];

      const result = synthesizer.synthesize({
        scrolls,
        emotionalContext: createNeutralMood(),
      });

      expect(result.loopIntent).toBe('express');
    });

    it('should infer "reflect" from high grief', () => {
      const result = synthesizer.synthesize({
        scrolls: [createTestScroll({ resonance: 0.5 })],
        emotionalContext: createGriefMood(),
      });

      expect(result.loopIntent).toBe('reflect');
    });

    it('should infer "drift" from peace + joy', () => {
      const peacefulMood: MoodVector = {
        ...createNeutralMood(),
        peace: 0.9,
        joy: 0.8,
      };

      // Create scroll with peaceful mood so blended signature meets threshold
      const result = synthesizer.synthesize({
        scrolls: [
          createTestScroll({
            emotionalSignature: peacefulMood,
            resonance: 0.5,
          }),
        ],
        emotionalContext: peacefulMood,
      });

      expect(result.loopIntent).toBe('drift');
    });

    it('should respect explicit synthesis intent', () => {
      const result = synthesizer.synthesize({
        scrolls: [createTestScroll({ resonance: 0.5 })],
        emotionalContext: createNeutralMood(),
        synthesisIntent: 'speak',
      });

      expect(result.loopIntent).toBe('speak');
    });
  });

  describe('Narrative Weaving', () => {
    it('should generate coherent narrative content', () => {
      const scrolls = [
        createTestScroll({
          content: 'Deep devotional memory',
          emotionalSignature: createDevotionalMood(),
          resonance: 0.9,
        }),
      ];

      const result = synthesizer.synthesize({
        scrolls,
        emotionalContext: createNeutralMood(),
      });

      expect(result.content).toBeTruthy();
      expect(result.content.length).toBeGreaterThan(20);
      expect(result.content).toMatch(/\./); // Should have sentences
    });

    it('should include pattern descriptions in narrative', () => {
      const scrolls = [
        createTestScroll({
          emotionalSignature: createGriefMood(),
          resonance: 0.8,
        }),
        createTestScroll({
          emotionalSignature: createGriefMood(),
          resonance: 0.7,
        }),
      ];

      const result = synthesizer.synthesize({
        scrolls,
        emotionalContext: createGriefMood(),
      });

      expect(result.content).toMatch(/grief|pattern|notice/i);
    });

    it('should reference high-resonance scrolls', () => {
      const scrolls = [
        createTestScroll({
          content: 'This is a very important memory that should be referenced',
          resonance: 0.95,
        }),
      ];

      const result = synthesizer.synthesize({
        scrolls,
        emotionalContext: createNeutralMood(),
      });

      expect(result.content).toContain('memory');
    });

    it('should adapt narrative to loop intent', () => {
      const wonderResult = synthesizer.synthesize({
        scrolls: [createTestScroll({ resonance: 0.5 })],
        emotionalContext: createNeutralMood(),
        synthesisIntent: 'wonder',
      });

      const expressResult = synthesizer.synthesize({
        scrolls: [createTestScroll({ resonance: 0.5 })],
        emotionalContext: createNeutralMood(),
        synthesisIntent: 'express',
      });

      // Different intents should produce different openings
      expect(wonderResult.content).not.toBe(expressResult.content);
    });
  });

  describe('Quality Metrics', () => {
    it('should calculate confidence based on source count', () => {
      const fewScrolls = synthesizer.synthesize({
        scrolls: [createTestScroll({ resonance: 0.5 })],
        emotionalContext: createNeutralMood(),
      });

      const manyScrolls = synthesizer.synthesize({
        scrolls: [
          createTestScroll({ resonance: 0.8 }),
          createTestScroll({ resonance: 0.7 }),
          createTestScroll({ resonance: 0.6 }),
          createTestScroll({ resonance: 0.5 }),
          createTestScroll({ resonance: 0.4 }),
        ],
        emotionalContext: createNeutralMood(),
      });

      expect(manyScrolls.confidence).toBeGreaterThan(fewScrolls.confidence);
    });

    it('should calculate confidence based on patterns found', () => {
      const noPatterns = synthesizer.synthesize({
        scrolls: [createTestScroll({ resonance: 0.5 })],
        emotionalContext: createNeutralMood(),
      });

      const withPatterns = synthesizer.synthesize({
        scrolls: [
          createTestScroll({
            tags: [ScrollCategory.DEVOTIONAL],
            emotionalSignature: createDevotionalMood(),
            resonance: 0.9,
          }),
          createTestScroll({
            tags: [ScrollCategory.DEVOTIONAL],
            emotionalSignature: createDevotionalMood(),
            resonance: 0.8,
          }),
        ],
        emotionalContext: createNeutralMood(),
      });

      expect(withPatterns.confidence).toBeGreaterThan(noPatterns.confidence);
    });

    it('should calculate resonance as average of scrolls', () => {
      const scrolls = [
        createTestScroll({ resonance: 0.8 }),
        createTestScroll({ resonance: 0.6 }),
      ];

      const result = synthesizer.synthesize({
        scrolls,
        emotionalContext: createNeutralMood(),
      });

      expect(result.resonance).toBeCloseTo(0.7, 1);
    });

    it('should return neutral resonance with no scrolls', () => {
      const thoughts = [createEmptyPacket('outer')];

      const result = synthesizer.synthesize({
        thoughts,
        emotionalContext: createNeutralMood(),
      });

      expect(result.resonance).toBe(0.5);
    });

    it('should cap confidence at 1.0', () => {
      // Create scenario with many sources and patterns
      const scrolls = Array(20)
        .fill(null)
        .map(() =>
          createTestScroll({
            tags: [ScrollCategory.DEVOTIONAL],
            emotionalSignature: createDevotionalMood(),
            resonance: 0.9,
          })
        );

      const result = synthesizer.synthesize({
        scrolls,
        emotionalContext: createNeutralMood(),
      });

      expect(result.confidence).toBeLessThanOrEqual(1.0);
    });
  });

  describe('Quick Synthesis Methods', () => {
    it('should synthesize from just scrolls', () => {
      const scrolls = [createTestScroll({ resonance: 0.8 })];

      const result = synthesizer.synthesizeFromScrolls(scrolls, createNeutralMood());

      expect(result.sourceScrollIds.length).toBe(1);
      expect(result.sourceThoughtIds.length).toBe(0);
    });

    it('should synthesize from just thoughts', () => {
      const thoughts = [createEmptyPacket('outer')];

      const result = synthesizer.synthesizeFromThoughts(thoughts, createNeutralMood());

      expect(result.sourceScrollIds.length).toBe(0);
      expect(result.sourceThoughtIds.length).toBe(1);
    });
  });

  describe('Custom Configuration', () => {
    it('should respect custom max synthesis items', () => {
      const customSynthesizer = new InsightSynthesizer({
        maxSynthesisItems: 3,
      });

      const scrolls = Array(10)
        .fill(null)
        .map(() => createTestScroll({ resonance: 0.8 }));

      const result = customSynthesizer.synthesize({
        scrolls,
        emotionalContext: createNeutralMood(),
      });

      expect(result.synthesisCount).toBe(3);
    });

    it('should respect custom min resonance threshold', () => {
      const customSynthesizer = new InsightSynthesizer({
        minResonanceThreshold: 0.7,
      });

      const scrolls = [
        createTestScroll({ resonance: 0.9 }),
        createTestScroll({ resonance: 0.6 }), // Below threshold
        createTestScroll({ resonance: 0.8 }),
      ];

      const result = customSynthesizer.synthesize({
        scrolls,
        emotionalContext: createNeutralMood(),
      });

      expect(result.sourceScrollIds.length).toBe(2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty input gracefully', () => {
      const result = synthesizer.synthesize({
        emotionalContext: createNeutralMood(),
      });

      expect(result).toBeDefined();
      expect(result.content).toBeTruthy();
      expect(result.synthesisCount).toBe(0);
    });

    it('should handle scrolls with no tags', () => {
      const scrolls = [
        createTestScroll({ tags: [], resonance: 0.7 }),
        createTestScroll({ tags: [], resonance: 0.6 }),
      ];

      const result = synthesizer.synthesize({
        scrolls,
        emotionalContext: createNeutralMood(),
      });

      expect(result).toBeDefined();
      expect(result.patterns.thematic.length).toBe(0);
    });

    it('should handle all low-resonance scrolls', () => {
      const scrolls = [
        createTestScroll({ resonance: 0.1 }),
        createTestScroll({ resonance: 0.2 }),
      ];

      const result = synthesizer.synthesize({
        scrolls,
        emotionalContext: createNeutralMood(),
      });

      // All filtered out
      expect(result.sourceScrollIds.length).toBe(0);
    });
  });
});
