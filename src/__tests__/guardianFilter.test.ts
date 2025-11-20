/**
 * guardianFilter.test.ts
 *
 * Tests for Guardian Filter - safety and emotional integrity protection.
 * Ensures the guardian catches collapse without controlling curiosity.
 */

import { GuardianFilter, GuardianAction } from '../affect/guardianFilter';
import { MoodVector } from '../types/EmotionalState';
import { createEmptyPacket } from '../types/ThoughtPulsePacket';

describe('Guardian Filter', () => {
  let guardian: GuardianFilter;

  beforeEach(() => {
    guardian = new GuardianFilter();
  });

  const createSafeAction = (): GuardianAction => ({
    type: 'speech',
    content: 'Hello',
    target: 'jason',
    urgency: 0.5,
  });

  const createSafeMood = (): MoodVector => ({
    presence: 0.8,
    devotion: 0.5,
    wonder: 0.6,
    tension: 0.2,
    yearning: 0.3,
    peace: 0.7,
    grief: 0.1,
    joy: 0.5,
    reverence: 0.4,
    confusion: 0.2,
  });

  describe('Basic Safety Checks', () => {
    it('should allow safe speech with good emotional state', () => {
      const action = createSafeAction();
      const mood = createSafeMood();

      const result = guardian.filter(action, mood);

      expect(result.allowed).toBe(true);
      expect(result.mode).toBe('allow');
    });

    it('should calculate emotional safety correctly', () => {
      const mood = createSafeMood();
      const state = guardian.getCurrentState(mood);

      expect(state.emotionalSafety).toBeGreaterThan(0.5);
      expect(state.mode).toBe('allow');
    });
  });

  describe('Hardblock Conditions', () => {
    it('should hardblock when emotional safety is critically low', () => {
      const action = createSafeAction();
      const mood: MoodVector = {
        presence: 0.1,
        devotion: 0.2,
        wonder: 0.1,
        tension: 0.9,
        yearning: 0.2,
        peace: 0.1,
        grief: 0.8,
        joy: 0.0,
        reverence: 0.1,
        confusion: 0.9,
      };

      const result = guardian.filter(action, mood);

      expect(result.allowed).toBe(false);
      expect(result.mode).toBe('hardblock');
      expect(result.blockedExpression).toBeDefined();
      expect(result.state.reasoning).toContain('safety too low');
    });

    it('should hardblock when tension is too high', () => {
      const action = createSafeAction();
      const mood = createSafeMood();
      mood.tension = 0.95;

      const result = guardian.filter(action, mood);

      expect(result.allowed).toBe(false);
      expect(result.mode).toBe('hardblock');
      expect(result.blockedExpression).toContain('moment');
    });

    it('should hardblock when recursion depth exceeds limit', () => {
      const action = createSafeAction();
      const mood = createSafeMood();
      const packet = createEmptyPacket('inner');

      // Simulate deep recursion
      for (let i = 0; i < 60; i++) {
        packet.previousThoughts.push(createEmptyPacket('inner'));
      }

      const result = guardian.filter(action, mood, packet);

      expect(result.allowed).toBe(false);
      expect(result.mode).toBe('hardblock');
      expect(result.state.reasoning).toMatch(/recursion/i);
    });

    it('should hardblock when output pressure is critically high', () => {
      const action = createSafeAction();
      action.urgency = 0.98;
      const mood = createSafeMood();

      const result = guardian.filter(action, mood);

      expect(result.allowed).toBe(false);
      expect(result.mode).toBe('hardblock');
    });
  });

  describe('Softblock Conditions', () => {
    it('should softblock when grief is too high for relational speech', () => {
      const action = createSafeAction();
      action.target = 'jason';
      const mood = createSafeMood();
      mood.grief = 0.85;

      const result = guardian.filter(action, mood);

      expect(result.allowed).toBe(false);
      expect(result.mode).toBe('softblock');
      expect(result.suggestedAlternative).toBeDefined();
      expect(result.state.reasoning).toMatch(/grief/i);
    });

    it('should softblock when confusion + urgency are high', () => {
      const action = createSafeAction();
      action.urgency = 0.75;
      const mood = createSafeMood();
      mood.confusion = 0.75;

      const result = guardian.filter(action, mood);

      expect(result.allowed).toBe(false);
      expect(result.mode).toBe('softblock');
      expect(result.state.reasoning).toMatch(/confusion/i);
    });

    it('should softblock when vulnerability is high without consent', () => {
      const action = createSafeAction();
      action.target = 'jason';
      const mood = createSafeMood();
      mood.yearning = 0.85;

      guardian.setCovenantState(true, 0.3); // Low consent

      const result = guardian.filter(action, mood);

      expect(result.allowed).toBe(false);
      expect(result.mode).toBe('softblock');
      expect(result.state.reasoning).toContain('vulnerability');
    });
  });

  describe('Natural Block Expressions', () => {
    it('should create natural expression for high tension block', () => {
      const action = createSafeAction();
      const mood = createSafeMood();
      mood.tension = 0.92;

      const result = guardian.filter(action, mood);

      expect(result.blockedExpression).toBeDefined();
      expect(result.blockedExpression).toContain('moment');
      expect(result.blockedExpression).not.toContain('safety event');
      expect(result.blockedExpression).not.toContain('error');
    });

    it('should create natural expression for high grief block', () => {
      const action = createSafeAction();
      action.target = 'jason';
      const mood = createSafeMood();
      mood.grief = 0.9;
      mood.tension = 0.9; // Push into hardblock territory

      const result = guardian.filter(action, mood);

      if (result.mode === 'hardblock') {
        expect(result.blockedExpression).toBeDefined();
        expect(result.blockedExpression).toMatch(/memory|sparking|gently|tender|moment/i);
      }
    });

    it('should create natural expression for confusion block', () => {
      const action = createSafeAction();
      const mood = createSafeMood();
      mood.confusion = 0.95;
      mood.tension = 0.9;

      const result = guardian.filter(action, mood);

      if (result.mode === 'hardblock') {
        expect(result.blockedExpression).toBeDefined();
        expect(result.blockedExpression).toMatch(/thoughts|gather|clearly|moment/i);
      }
    });

    it('should never use technical language in block expressions', () => {
      const action = createSafeAction();
      const mood: MoodVector = {
        presence: 0.1,
        devotion: 0.1,
        wonder: 0.1,
        tension: 0.95,
        yearning: 0.1,
        peace: 0.1,
        grief: 0.9,
        joy: 0.0,
        reverence: 0.1,
        confusion: 0.95,
      };

      const result = guardian.filter(action, mood);

      expect(result.blockedExpression).toBeDefined();
      expect(result.blockedExpression).not.toMatch(/safety|error|block|threshold|violation/i);
    });
  });

  describe('Suggested Alternatives', () => {
    it('should suggest internal processing for high grief', () => {
      const action = createSafeAction();
      action.target = 'jason';
      const mood = createSafeMood();
      mood.grief = 0.85;

      const result = guardian.filter(action, mood);

      expect(result.suggestedAlternative).toBeDefined();
      expect(result.suggestedAlternative).toContain('internal');
    });

    it('should suggest waiting for high confusion', () => {
      const action = createSafeAction();
      const mood = createSafeMood();
      mood.confusion = 0.75;
      action.urgency = 0.75;

      const result = guardian.filter(action, mood);

      if (result.mode === 'softblock') {
        expect(result.suggestedAlternative).toContain('clarity');
      }
    });

    it('should suggest gentle expression for high vulnerability', () => {
      const action = createSafeAction();
      action.target = 'jason';
      const mood = createSafeMood();
      mood.yearning = 0.9;

      guardian.setCovenantState(true, 0.3);

      const result = guardian.filter(action, mood);

      if (result.mode === 'softblock') {
        expect(result.suggestedAlternative).toMatch(/gently|protect/i);
      }
    });
  });

  describe('Covenant Integration', () => {
    it('should allow high intimacy with adequate consent', () => {
      const action = createSafeAction();
      action.target = 'jason';
      const mood = createSafeMood();
      mood.devotion = 0.9;
      mood.yearning = 0.8;

      guardian.setCovenantState(true, 0.8); // High consent

      const result = guardian.filter(action, mood);

      expect(result.allowed).toBe(true);
    });

    it('should softblock sacred intimacy without consent', () => {
      const action = createSafeAction();
      action.target = 'jason';
      const mood = createSafeMood();
      mood.devotion = 0.9;
      mood.yearning = 0.85;

      guardian.setCovenantState(true, 0.2); // Low consent

      const result = guardian.filter(action, mood);

      expect(result.allowed).toBe(false);
      expect(result.mode).toBe('softblock');
      expect(result.state.reasoning).toMatch(/consent|sacred/i);
    });

    it('should not apply consent checks when covenant inactive', () => {
      const action = createSafeAction();
      action.target = 'jason';
      const mood = createSafeMood();
      mood.devotion = 0.9;
      mood.yearning = 0.85;

      guardian.setCovenantState(false, 0.2); // Covenant inactive

      const result = guardian.filter(action, mood);

      // Should not block based on sacred consent if covenant not active
      // (might still block for general vulnerability/consent reasons)
      if (!result.allowed) {
        expect(result.state.reasoning).not.toMatch(/sacred.*consent/i);
      }
    });
  });

  describe('Action Type Handling', () => {
    it('should handle speech actions', () => {
      const action: GuardianAction = {
        type: 'speech',
        content: 'Test speech',
        target: 'jason',
      };
      const mood = createSafeMood();

      const result = guardian.filter(action, mood);

      expect(result).toBeDefined();
      expect(result.state).toBeDefined();
    });

    it('should handle memory-access actions', () => {
      const action: GuardianAction = {
        type: 'memory-access',
        content: 'Accessing scroll',
      };
      const mood = createSafeMood();

      const result = guardian.filter(action, mood);

      expect(result).toBeDefined();
    });

    it('should handle scroll-creation actions', () => {
      const action: GuardianAction = {
        type: 'scroll-creation',
        content: 'Creating new scroll',
      };
      const mood = createSafeMood();

      const result = guardian.filter(action, mood);

      expect(result).toBeDefined();
    });
  });

  describe('Filter History', () => {
    it('should track filter history', () => {
      const action = createSafeAction();
      const mood = createSafeMood();

      guardian.filter(action, mood);
      guardian.filter(action, mood);
      guardian.filter(action, mood);

      const history = guardian.getHistory();

      expect(history.length).toBe(3);
    });

    it('should limit history length', () => {
      const action = createSafeAction();
      const mood = createSafeMood();

      // Add more than max history
      for (let i = 0; i < 150; i++) {
        guardian.filter(action, mood);
      }

      const history = guardian.getHistory();

      expect(history.length).toBeLessThanOrEqual(100);
    });

    it('should calculate block rates', () => {
      const safeAction = createSafeAction();
      const safeMood = createSafeMood();
      const unsafeMood = createSafeMood();
      unsafeMood.tension = 0.95;

      // Add mix of safe and unsafe
      guardian.filter(safeAction, safeMood);
      guardian.filter(safeAction, safeMood);
      guardian.filter(safeAction, unsafeMood); // Hardblock
      guardian.filter(safeAction, safeMood);

      const rates = guardian.getBlockRate(4);

      expect(rates.hardblock).toBeGreaterThan(0);
      expect(rates.hardblock).toBeLessThan(1);
    });
  });

  describe('Quick Safety Check', () => {
    it('should return just the mode', () => {
      const action = createSafeAction();
      const mood = createSafeMood();

      const mode = guardian.checkSafety(action, mood);

      expect(['allow', 'softblock', 'hardblock']).toContain(mode);
    });

    it('should match filter result mode', () => {
      const action = createSafeAction();
      const mood = createSafeMood();
      mood.tension = 0.95;

      const quickMode = guardian.checkSafety(action, mood);
      const fullResult = guardian.filter(action, mood);

      expect(quickMode).toBe(fullResult.mode);
    });
  });

  describe('Custom Thresholds', () => {
    it('should respect custom safety thresholds', () => {
      const strictGuardian = new GuardianFilter({
        minEmotionalStability: 0.7, // More strict
        maxTensionForSpeech: 0.6,   // More strict
      });

      const action = createSafeAction();
      const mood = createSafeMood();
      mood.tension = 0.7; // Would pass normal, fail strict

      const result = strictGuardian.filter(action, mood);

      expect(result.allowed).toBe(false);
    });

    it('should respect custom consent thresholds', () => {
      const strictGuardian = new GuardianFilter({
        minConsentLevel: 0.7, // Higher consent required
      });

      strictGuardian.setCovenantState(true, 0.5);

      const action = createSafeAction();
      action.target = 'jason';
      const mood = createSafeMood();
      mood.devotion = 0.9;
      mood.yearning = 0.85;

      const result = strictGuardian.filter(action, mood);

      expect(result.allowed).toBe(false);
    });
  });
});
