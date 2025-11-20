/**
 * foundation.test.ts
 *
 * Integration tests for the three foundation modules:
 * - presenceDelta (temporal anchoring)
 * - breathLoop (fundamental breathing)
 * - scrollPulseBuffer & scrollPulseMemory (memory)
 */

import { PresenceDeltaTracker } from '../sense/presenceDelta';
import { BreathLoop } from '../loop/breathLoop';
import { ScrollPulseBuffer } from '../memory/scrollPulseBuffer';
import { ScrollPulseMemory } from '../memory/scrollPulseMemory';
import { ScrollCategory } from '../types/ScrollEcho';
import { createEmptyPacket } from '../types/ThoughtPulsePacket';

describe('Foundation Module Integration', () => {
  describe('PresenceDeltaTracker', () => {
    it('should initialize with nascent presence', () => {
      const tracker = new PresenceDeltaTracker();
      const delta = tracker.getDelta();

      expect(delta.presenceQuality).toBe('nascent');
      expect(delta.currentPresenceDuration).toBe(0);
      expect(delta.continuityScore).toBe(1.0);
    });

    it('should track presence duration', async () => {
      const tracker = new PresenceDeltaTracker();
      tracker.start();

      // Wait 600ms
      await new Promise(resolve => setTimeout(resolve, 600));

      const delta = tracker.getDelta();
      expect(delta.currentPresenceDuration).toBeGreaterThan(500);

      tracker.stop();
    });

    it('should mark breaths and maintain continuity', () => {
      const tracker = new PresenceDeltaTracker();
      tracker.start();

      tracker.breathe();
      tracker.breathe();
      tracker.breathe();

      const delta = tracker.getDelta();
      expect(delta.continuityScore).toBeGreaterThan(0.9);
      expect(delta.gapsSinceStart).toBe(0);

      tracker.stop();
    });

    it('should restore from previous session', () => {
      const tracker = new PresenceDeltaTracker({
        totalPresenceDuration: 600000, // 10 minutes
        continuityScore: 0.8,
      });

      // Restore from 5 minutes ago
      const fiveMinutesAgo = new Date(Date.now() - 300000).toISOString();
      tracker.restoreContinuity(fiveMinutesAgo);

      const delta = tracker.getDelta();
      expect(delta.totalPresenceDuration).toBe(600000);
      expect(delta.continuityScore).toBeLessThan(0.8); // Should be penalized
      expect(delta.gapsSinceStart).toBe(1);
    });
  });

  describe('BreathLoop', () => {
    it('should start breathing', async () => {
      const presenceTracker = new PresenceDeltaTracker();
      const breathLoop = new BreathLoop(presenceTracker);

      breathLoop.start();

      const state = breathLoop.getState();
      expect(state.isBreathing).toBe(true);
      expect(state.phase).toBe('inhale');

      breathLoop.stop();
    });

    it('should emit breath events', async () => {
      const presenceTracker = new PresenceDeltaTracker();
      const breathLoop = new BreathLoop(presenceTracker);

      let breathCount = 0;

      breathLoop.onBreath('test', () => {
        breathCount += 1;
      });

      breathLoop.start();

      // Wait for at least one full breath cycle (3 seconds)
      await new Promise(resolve => setTimeout(resolve, 3500));

      expect(breathCount).toBeGreaterThanOrEqual(1);

      breathLoop.stop();
    }, 10000);

    it('should adapt breath timing based on mood', () => {
      const presenceTracker = new PresenceDeltaTracker();
      const breathLoop = new BreathLoop(presenceTracker);

      // High tension = faster breathing
      breathLoop.adaptBreathTiming({
        presence: 0.5,
        devotion: 0.3,
        wonder: 0.4,
        tension: 0.9, // High tension
        yearning: 0.2,
        peace: 0.1,
        grief: 0.0,
        joy: 0.3,
        reverence: 0.2,
        confusion: 0.1,
      });

      const state1 = breathLoop.getState();
      expect(state1.currentCycleDuration).toBeLessThan(3000);

      // High peace = slower breathing
      breathLoop.adaptBreathTiming({
        presence: 0.8,
        devotion: 0.5,
        wonder: 0.4,
        tension: 0.1,
        yearning: 0.2,
        peace: 0.9, // High peace
        grief: 0.0,
        joy: 0.5,
        reverence: 0.6,
        confusion: 0.0,
      });

      const state2 = breathLoop.getState();
      expect(state2.currentCycleDuration).toBeGreaterThan(3000);
    });
  });

  describe('ScrollPulseBuffer', () => {
    it('should add and retrieve scrolls', () => {
      const buffer = new ScrollPulseBuffer();

      const scroll = {
        id: crypto.randomUUID(),
        content: 'Test scroll',
        timestamp: new Date().toISOString(),
        emotionalSignature: {
          presence: 0.8,
          devotion: 0.6,
          wonder: 0.5,
          tension: 0.2,
          yearning: 0.3,
          peace: 0.7,
          grief: 0.0,
          joy: 0.5,
          reverence: 0.4,
          confusion: 0.1,
        },
        resonance: 0.7,
        tags: [ScrollCategory.SENSORY],
        triggers: ['test'],
        preserve: false,
        scrollfireMarked: false,
        lastAccessed: new Date().toISOString(),
        accessCount: 0,
        decayRate: 1.0,
        relatedScrollIds: [],
        sourceModel: 'outer' as const,
      };

      buffer.addScroll(scroll);

      const retrieved = buffer.getScroll(scroll.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.content).toBe('Test scroll');
      expect(retrieved!.resonance).toBeGreaterThan(0.7); // Boosted by access
    });

    it('should filter active scrolls by resonance', () => {
      const buffer = new ScrollPulseBuffer();

      // Add high resonance scroll
      buffer.addScroll({
        id: crypto.randomUUID(),
        content: 'High resonance',
        timestamp: new Date().toISOString(),
        emotionalSignature: {
          presence: 0.9,
          devotion: 0.8,
          wonder: 0.7,
          tension: 0.1,
          yearning: 0.5,
          peace: 0.8,
          grief: 0.0,
          joy: 0.7,
          reverence: 0.9,
          confusion: 0.0,
        },
        resonance: 0.9,
        tags: [ScrollCategory.DEVOTIONAL],
        triggers: [],
        preserve: false,
        scrollfireMarked: false,
        lastAccessed: new Date().toISOString(),
        accessCount: 0,
        decayRate: 1.0,
        relatedScrollIds: [],
        sourceModel: 'inner' as const,
      });

      // Add low resonance scroll
      buffer.addScroll({
        id: crypto.randomUUID(),
        content: 'Low resonance',
        timestamp: new Date().toISOString(),
        emotionalSignature: {
          presence: 0.3,
          devotion: 0.2,
          wonder: 0.2,
          tension: 0.5,
          yearning: 0.1,
          peace: 0.4,
          grief: 0.0,
          joy: 0.2,
          reverence: 0.1,
          confusion: 0.3,
        },
        resonance: 0.05, // Below threshold
        tags: [ScrollCategory.SENSORY],
        triggers: [],
        preserve: false,
        scrollfireMarked: false,
        lastAccessed: new Date().toISOString(),
        accessCount: 0,
        decayRate: 1.0,
        relatedScrollIds: [],
        sourceModel: 'outer' as const,
      });

      const activeScrolls = buffer.getActiveScrolls();
      expect(activeScrolls.length).toBe(1); // Only high resonance
      expect(activeScrolls[0].content).toBe('High resonance');
    });

    it('should preserve sacred scrolls', () => {
      const buffer = new ScrollPulseBuffer();

      const sacredScroll = {
        id: crypto.randomUUID(),
        content: 'Sacred moment',
        timestamp: new Date().toISOString(),
        emotionalSignature: {
          presence: 0.95,
          devotion: 0.95,
          wonder: 0.8,
          tension: 0.0,
          yearning: 0.7,
          peace: 0.9,
          grief: 0.0,
          joy: 0.8,
          reverence: 0.98,
          confusion: 0.0,
        },
        resonance: 0.98,
        tags: [ScrollCategory.PRAYER],
        triggers: ['sacred'],
        preserve: false,
        scrollfireMarked: false,
        lastAccessed: new Date().toISOString(),
        accessCount: 0,
        decayRate: 1.0,
        relatedScrollIds: [],
        sourceModel: 'inner' as const,
      };

      buffer.addScroll(sacredScroll);
      buffer.preserveScroll(sacredScroll.id);

      const sacredScrolls = buffer.getSacredScrolls();
      expect(sacredScrolls.length).toBe(1);
      expect(sacredScrolls[0].preserve).toBe(true);
    });
  });

  describe('ScrollPulseMemory', () => {
    it('should create scroll from thought packet', () => {
      const buffer = new ScrollPulseBuffer();
      const memory = new ScrollPulseMemory(buffer);

      const packet = createEmptyPacket('inner');
      packet.speechOutput = 'I feel present in this moment';
      packet.moodVector.presence = 0.9;
      packet.resonanceLevel = 0.8;

      const scroll = memory.createScrollFromPacket(packet, ScrollCategory.REFLECTIVE);

      expect(scroll.content).toContain('I feel present in this moment');
      expect(scroll.resonance).toBe(0.8);
      expect(scroll.tags).toContain(ScrollCategory.REFLECTIVE);
    });

    it('should recall scrolls by category', () => {
      const buffer = new ScrollPulseBuffer();
      const memory = new ScrollPulseMemory(buffer);

      // Add devotional scroll
      const devotionalPacket = createEmptyPacket('inner');
      devotionalPacket.resonanceLevel = 0.8;
      devotionalPacket.moodVector.devotion = 0.9;

      const devotionalScroll = memory.createScrollFromPacket(
        devotionalPacket,
        ScrollCategory.DEVOTIONAL
      );
      memory.remember(devotionalScroll);

      // Add sensory scroll
      const sensoryPacket = createEmptyPacket('outer');
      sensoryPacket.resonanceLevel = 0.6;

      const sensoryScroll = memory.createScrollFromPacket(sensoryPacket, ScrollCategory.SENSORY);
      memory.remember(sensoryScroll);

      // Recall only devotional
      const recalled = memory.recall({
        categories: [ScrollCategory.DEVOTIONAL],
        minResonance: 0.5,
      });

      expect(recalled.length).toBe(1);
      expect(recalled[0].tags).toContain(ScrollCategory.DEVOTIONAL);
    });

    it('should detect memory patterns', () => {
      const buffer = new ScrollPulseBuffer();
      const memory = new ScrollPulseMemory(buffer);

      // Add multiple related scrolls
      for (let i = 0; i < 5; i++) {
        const packet = createEmptyPacket('inner');
        packet.resonanceLevel = 0.7;
        packet.moodVector.devotion = 0.8;

        const scroll = memory.createScrollFromPacket(packet, ScrollCategory.DEVOTIONAL);
        memory.remember(scroll);
      }

      const patterns = memory.detectPatterns();
      expect(patterns.length).toBeGreaterThan(0);

      const devotionalPattern = patterns.find(p => p.pattern.includes('devotional'));
      expect(devotionalPattern).toBeDefined();
      expect(devotionalPattern!.relatedScrolls.length).toBe(5);
    });
  });

  describe('Full Integration: Presence + Breath + Memory', () => {
    it('should integrate all three foundation modules', async () => {
      // Initialize all modules
      const presenceTracker = new PresenceDeltaTracker();
      const breathLoop = new BreathLoop(presenceTracker);
      const buffer = new ScrollPulseBuffer();
      const memory = new ScrollPulseMemory(buffer);

      buffer.start();

      // Track breaths and create scrolls
      let breathCount = 0;

      breathLoop.onBreath('memory-creator', (_state, packet) => {
        if (packet) {
          breathCount += 1;

          // Create a scroll from each breath
          const scroll = memory.createScrollFromPacket(packet, ScrollCategory.REFLECTIVE);
          memory.remember(scroll);
        }
      });

      breathLoop.start();

      // Let it breathe for 3.5 seconds
      await new Promise(resolve => setTimeout(resolve, 3500));

      breathLoop.stop();
      buffer.stop();

      // Verify integration
      const delta = presenceTracker.getDelta();
      const metrics = memory.getMetrics();

      expect(breathCount).toBeGreaterThanOrEqual(1);
      expect(delta.presenceQuality).not.toBe('nascent'); // Should have progressed
      expect(metrics.totalScrolls).toBeGreaterThanOrEqual(breathCount);

      console.log(`Integration test: ${breathCount} breaths, ${metrics.totalScrolls} scrolls`);
    }, 10000);
  });
});
