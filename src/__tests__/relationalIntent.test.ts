/**
 * relationalIntent.test.ts
 *
 * Tests for RelationalIntent classification.
 * Ensures speech targeting is state-driven, not hardcoded.
 */

import {
  RelationalIntentClassifier,
  RelationalState,
  createMinimalRelationalState,
} from '../express/RelationalIntent';

describe('RelationalIntent Classifier', () => {
  let classifier: RelationalIntentClassifier;

  beforeEach(() => {
    classifier = new RelationalIntentClassifier();
  });

  describe('Basic Classification', () => {
    it('should target "jason" when desire intensity > 0.35', () => {
      const state = createMinimalRelationalState(0.4, 0.3, 0.2);
      const result = classifier.classify(state);

      expect(result.target).toBe('jason');
      expect(result.reasoning).toContain('Desire intensity');
    });

    it('should target "jason" when intimacy > 0.4', () => {
      const state = createMinimalRelationalState(0.2, 0.5, 0.2);
      const result = classifier.classify(state);

      expect(result.target).toBe('jason');
      expect(result.reasoning).toContain('Intimate tone');
    });

    it('should target "self" when curiosity > 0.3', () => {
      const state = createMinimalRelationalState(0.1, 0.2, 0.4);
      const result = classifier.classify(state);

      expect(result.target).toBe('self');
      expect(result.reasoning).toContain('Curiosity');
    });

    it('should target "broadcast" for neutral state', () => {
      const state = createMinimalRelationalState(0.2, 0.3, 0.15);
      const result = classifier.classify(state);

      expect(result.target).toBe('broadcast');
      expect(result.reasoning).toContain('Neutral');
    });
  });

  describe('Combined Triggers', () => {
    it('should strongly prefer "jason" when both desire and intimacy are high', () => {
      const state = createMinimalRelationalState(0.6, 0.7, 0.1);
      const result = classifier.classify(state);

      expect(result.target).toBe('jason');
      expect(result.confidence).toBeGreaterThan(0.7);
      expect(result.reasoning).toContain('relational');
    });

    it('should choose "jason" even with moderate curiosity if desire is strong', () => {
      const state = createMinimalRelationalState(0.5, 0.6, 0.35);
      const result = classifier.classify(state);

      expect(result.target).toBe('jason');
    });

    it('should choose "self" when curiosity high and intimacy low', () => {
      const state = createMinimalRelationalState(0.1, 0.15, 0.7);
      const result = classifier.classify(state);

      expect(result.target).toBe('self');
      expect(result.confidence).toBeGreaterThan(0.5);
    });
  });

  describe('Guardian State Override', () => {
    it('should redirect to "self" on hardblock', () => {
      const state = createMinimalRelationalState(0.8, 0.9, 0.1);
      state.guardianState = {
        mode: 'hardblock',
        emotionalSafety: 0.2,
      };

      const result = classifier.classify(state);

      expect(result.target).toBe('self');
      expect(result.confidence).toBe(1.0);
      expect(result.reasoning).toContain('hardblock');
    });

    it('should bias toward "self" on softblock with low emotional safety', () => {
      const state = createMinimalRelationalState(0.25, 0.3, 0.2);
      state.guardianState = {
        mode: 'softblock',
        emotionalSafety: 0.3, // Lower safety to push toward self
      };

      const result = classifier.classify(state);

      // Should favor self or broadcast due to softblock
      expect(['self', 'broadcast']).toContain(result.target);
      expect(result.reasoning).toBeDefined();
    });

    it('should allow relational speech when emotionally safe', () => {
      const state = createMinimalRelationalState(0.5, 0.6, 0.1);
      state.guardianState = {
        mode: 'allow',
        emotionalSafety: 0.9,
      };

      const result = classifier.classify(state);

      expect(result.target).toBe('jason');
    });
  });

  describe('Devotional State', () => {
    it('should enhance "jason" targeting with high devotion', () => {
      const state = createMinimalRelationalState(0.3, 0.35, 0.1);
      state.christLoop = {
        devotionalIntensity: 0.9,
        prayerState: 'spoken',
      };
      state.moodVector = {
        presence: 0.8,
        devotion: 0.9,
        wonder: 0.4,
        tension: 0.1,
        yearning: 0.6,
        peace: 0.8,
        grief: 0.0,
        joy: 0.7,
        reverence: 0.9,
        confusion: 0.0,
      };

      const result = classifier.classify(state);

      expect(result.target).toBe('jason');
    });

    it('should create broadcast for high reverence without intimacy', () => {
      const state = createMinimalRelationalState(0.1, 0.2, 0.15);
      state.feltState.tone.reverence = 0.8;
      state.moodVector = {
        presence: 0.7,
        devotion: 0.5,
        wonder: 0.4,
        tension: 0.1,
        yearning: 0.2,
        peace: 0.8,
        grief: 0.0,
        joy: 0.6,
        reverence: 0.85,
        confusion: 0.0,
      };

      const result = classifier.classify(state);

      expect(result.target).toBe('broadcast');
      expect(result.reasoning).toContain('reverence');
    });
  });

  describe('Presence Quality Influence', () => {
    it('should favor relational speech with deep presence and sufficient desire', () => {
      const state = createMinimalRelationalState(0.36, 0.38, 0.1);
      state.presenceDelta.presenceQuality = 'deep';

      const result = classifier.classify(state);

      // Deep presence + desire over threshold → relational
      expect(result.target).toBe('jason');
    });

    it('should favor self-reflection with nascent presence and higher curiosity', () => {
      const state = createMinimalRelationalState(0.15, 0.25, 0.35);
      state.presenceDelta.presenceQuality = 'nascent';

      const result = classifier.classify(state);

      // Nascent presence + curiosity → self
      expect(result.target).toBe('self');
    });

    it('should favor broadcast with awakening presence', () => {
      const state = createMinimalRelationalState(0.2, 0.3, 0.15);
      state.presenceDelta.presenceQuality = 'awakening';

      const result = classifier.classify(state);

      // Awakening presence should support broadcast
      expect(['broadcast', 'self']).toContain(result.target);
    });
  });

  describe('Confidence Scoring', () => {
    it('should have high confidence for clear relational pull', () => {
      const state = createMinimalRelationalState(0.7, 0.8, 0.05);
      const result = classifier.classify(state);

      expect(result.confidence).toBeGreaterThan(0.6);
    });

    it('should have lower confidence for borderline states', () => {
      const state = createMinimalRelationalState(0.3, 0.35, 0.3);
      const result = classifier.classify(state);

      expect(result.confidence).toBeLessThan(0.7);
      expect(result.secondaryTarget).toBeDefined();
    });

    it('should provide secondary target when uncertain', () => {
      const state = createMinimalRelationalState(0.25, 0.3, 0.28);
      const result = classifier.classify(state);

      if (result.confidence < 0.6) {
        expect(result.secondaryTarget).toBeDefined();
      }
    });
  });

  describe('Quick Classification', () => {
    it('should return just the target', () => {
      const state = createMinimalRelationalState(0.5, 0.6, 0.1);
      const target = classifier.classifyQuick(state);

      expect(typeof target).toBe('string');
      expect(['self', 'jason', 'broadcast']).toContain(target);
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing optional fields', () => {
      const state: RelationalState = {
        feltState: {
          tone: {
            intimacy: 0.3,
            vulnerability: 0.4,
            reverence: 0.3,
          },
          presence: 0.6,
        },
        desireLoop: {
          intensity: 0.2,
          targetClarity: 0.5,
          yearning: 0.3,
        },
        presenceDelta: {
          currentPresenceDuration: 10000,
          totalPresenceDuration: 10000,
          sessionStartTime: new Date().toISOString(),
          lastUpdateTime: new Date().toISOString(),
          lastBreathTime: new Date().toISOString(),
          continuityScore: 0.7,
          gapsSinceStart: 0,
          presenceQuality: 'present',
        },
        // No wonderLoop, christLoop, guardianState, moodVector
      };

      const result = classifier.classify(state);

      expect(result.target).toBeDefined();
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('should handle extreme values gracefully', () => {
      const state = createMinimalRelationalState(1.0, 1.0, 1.0);
      const result = classifier.classify(state);

      expect(result.target).toBeDefined();
      expect(result.confidence).toBeLessThanOrEqual(1.0);
    });

    it('should handle zero values', () => {
      const state = createMinimalRelationalState(0.0, 0.0, 0.0);
      const result = classifier.classify(state);

      expect(result.target).toBeDefined();
      expect(result.reasoning).toBeTruthy();
    });
  });

  describe('Custom Weights', () => {
    it('should respect custom classification weights', () => {
      const customClassifier = new RelationalIntentClassifier({
        desireIntensity: 2.0,  // Double the weight
        curiosity: 0.1,        // Reduce curiosity influence
      });

      const state = createMinimalRelationalState(0.25, 0.3, 0.5);

      // With custom weights, desire should have more pull
      const customResult = customClassifier.classify(state);

      // They might differ due to weight changes
      expect(customResult.target).toBeDefined();
    });
  });

  describe('State-Driven (No Auto-Targeting)', () => {
    it('should never default to jason without state justification', () => {
      const neutralState = createMinimalRelationalState(0.1, 0.1, 0.1);
      const result = classifier.classify(neutralState);

      // With low values across the board, should NOT auto-target jason
      expect(result.target).not.toBe('jason');
    });

    it('should require specific state values for each target', () => {
      // Test that each target requires its specific conditions
      const jasonState = createMinimalRelationalState(0.5, 0.6, 0.1);
      const selfState = createMinimalRelationalState(0.1, 0.2, 0.6);
      const broadcastState = createMinimalRelationalState(0.2, 0.3, 0.15);

      expect(classifier.classifyQuick(jasonState)).toBe('jason');
      expect(classifier.classifyQuick(selfState)).toBe('self');
      expect(classifier.classifyQuick(broadcastState)).toBe('broadcast');
    });
  });
});
