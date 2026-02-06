/**
 * outputConductor.test.ts
 *
 * Tests for Output Conductor - final routing and formatting.
 * Ensures output respects voice intent, guardian state, and volitional silence.
 */

import { OutputConductor } from '../express/outputConductor';
import { VoiceIntent } from '../express/voiceIntent';
import { SynthesizedInsight } from '../express/insightSynth';
import { MoodVector } from '../types/EmotionalState';

describe('Output Conductor', () => {
  let conductor: OutputConductor;

  beforeEach(() => {
    conductor = new OutputConductor();
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

  const createBasicIntent = (overrides?: Partial<VoiceIntent>): VoiceIntent => ({
    shouldSpeak: true,
    relationalTarget: 'jason',
    targetConfidence: 0.8,
    emotionalTone: createNeutralMood(),
    urgency: 0.5,
    loopIntent: 'speak',
    reasoning: 'Test intent',
    guardianAllowed: true,
    guardianMode: 'allow',
    timestamp: new Date().toISOString(),
    silenceValid: false,
    ...overrides,
  });

  const createTestInsight = (): SynthesizedInsight => ({
    content: 'This is a synthesized insight about patterns.',
    emotionalSignature: createNeutralMood(),
    patterns: {
      emotional: ['peaceful contentment'],
      thematic: ['wonder and curiosity'],
      relational: [],
    },
    sourceScrollIds: ['scroll-1'],
    sourceThoughtIds: [],
    confidence: 0.8,
    resonance: 0.7,
    loopIntent: 'reflect',
    timestamp: new Date().toISOString(),
    synthesisCount: 1,
  });

  describe('Basic Output Conduction', () => {
    it('should conduct speech output when intent allows', () => {
      const intent = createBasicIntent();
      const output = conductor.conduct(intent);

      expect(output.type).toBe('speech');
      expect(output.channel).toBe('external');
      expect(output.content).toBeDefined();
      expect(output.guardianAllowed).toBe(true);
    });

    it('should conduct silence when shouldSpeak is false', () => {
      const intent = createBasicIntent({ shouldSpeak: false });
      const output = conductor.conduct(intent);

      expect(output.type).toBe('silence');
      expect(output.channel).toBe('none');
      expect(output.content).toBeUndefined();
    });

    it('should conduct blocked output when guardian disallows', () => {
      const intent = createBasicIntent({
        guardianAllowed: false,
        guardianMode: 'hardblock',
        guardianExpression: 'I need a moment to breathe.',
      });

      const output = conductor.conduct(intent);

      expect(output.type).toBe('blocked');
      expect(output.guardianAllowed).toBe(false);
      expect(output.content).toBe('I need a moment to breathe.');
    });

    it('should use insight content when provided', () => {
      const intent = createBasicIntent();
      const insight = createTestInsight();

      const output = conductor.conduct(intent, insight);

      expect(output.content).toContain('synthesized insight');
    });

    it('should use intent content when provided', () => {
      const intent = createBasicIntent({
        content: 'Custom voice content',
      });

      const output = conductor.conduct(intent);

      expect(output.content).toBe('Custom voice content');
    });
  });

  describe('Channel Routing', () => {
    it('should route to external channel for jason target', () => {
      const intent = createBasicIntent({ relationalTarget: 'jason' });
      const output = conductor.conduct(intent);

      expect(output.channel).toBe('external');
      expect(output.relationalTarget).toBe('jason');
    });

    it('should route to internal channel for self target', () => {
      const intent = createBasicIntent({ relationalTarget: 'self' });
      const output = conductor.conduct(intent);

      expect(output.channel).toBe('internal');
      expect(output.type).toBe('internal-reflection');
      expect(output.relationalTarget).toBe('self');
    });

    it('should route to external channel for broadcast target', () => {
      const intent = createBasicIntent({ relationalTarget: 'broadcast' });
      const output = conductor.conduct(intent);

      expect(output.channel).toBe('external');
      expect(output.relationalTarget).toBe('broadcast');
    });

    it('should use none channel for silence', () => {
      const intent = createBasicIntent({ shouldSpeak: false });
      const output = conductor.conduct(intent);

      expect(output.channel).toBe('none');
    });
  });

  describe('Guardian Blocking', () => {
    it('should handle hardblock with guardian expression', () => {
      const intent = createBasicIntent({
        guardianAllowed: false,
        guardianMode: 'hardblock',
        guardianExpression: 'My thoughts are too scattered right now.',
      });

      const output = conductor.conduct(intent);

      expect(output.type).toBe('blocked');
      expect(output.guardianMode).toBe('hardblock');
      expect(output.content).toBe('My thoughts are too scattered right now.');
      expect(output.silenceValid).toBe(true);
    });

    it('should handle softblock with guardian expression', () => {
      const intent = createBasicIntent({
        guardianAllowed: false,
        guardianMode: 'softblock',
        guardianExpression: 'I need to process this internally first.',
      });

      const output = conductor.conduct(intent);

      expect(output.type).toBe('blocked');
      expect(output.guardianMode).toBe('softblock');
      expect(output.content).toBe('I need to process this internally first.');
    });

    it('should use default expression if guardian provides none', () => {
      const intent = createBasicIntent({
        guardianAllowed: false,
        guardianMode: 'hardblock',
      });

      const output = conductor.conduct(intent);

      expect(output.content).toBe('I need a moment.');
    });

    it('should set urgency to 0 when blocked', () => {
      const intent = createBasicIntent({
        guardianAllowed: false,
        guardianMode: 'hardblock',
        urgency: 0.9,
      });

      const output = conductor.conduct(intent);

      expect(output.urgency).toBe(0);
    });

    it('should route hardblock to none channel', () => {
      const intent = createBasicIntent({
        guardianAllowed: false,
        guardianMode: 'hardblock',
      });

      const output = conductor.conduct(intent);

      expect(output.channel).toBe('none');
    });

    it('should route softblock to external channel', () => {
      const intent = createBasicIntent({
        guardianAllowed: false,
        guardianMode: 'softblock',
        guardianExpression: 'Gentle hold...',
      });

      const output = conductor.conduct(intent);

      expect(output.channel).toBe('external');
    });
  });

  describe('Silence Validation', () => {
    it('should mark guardian-enforced silence as valid', () => {
      const intent = createBasicIntent({
        guardianAllowed: false,
        guardianMode: 'hardblock',
      });

      const output = conductor.conduct(intent);

      expect(output.silenceValid).toBe(true);
    });

    it('should preserve silenceValid from intent', () => {
      const intent = createBasicIntent({
        shouldSpeak: false,
        silenceValid: true,
      });

      const output = conductor.conduct(intent);

      expect(output.silenceValid).toBe(true);
    });

    it('should mark speech as not silence', () => {
      const intent = createBasicIntent({ shouldSpeak: true });
      const output = conductor.conduct(intent);

      expect(output.silenceValid).toBe(false);
    });
  });

  describe('Content Generation', () => {
    it('should generate placeholder for express intent', () => {
      const intent = createBasicIntent({ loopIntent: 'express' });
      const output = conductor.conduct(intent);

      expect(output.content).toContain('express');
    });

    it('should generate placeholder for reflect intent', () => {
      const intent = createBasicIntent({ loopIntent: 'reflect' });
      const output = conductor.conduct(intent);

      expect(output.content).toContain('reflect');
    });

    it('should generate placeholder for wonder intent', () => {
      const intent = createBasicIntent({ loopIntent: 'wonder' });
      const output = conductor.conduct(intent);

      expect(output.content).toContain('wonder');
    });

    it('should prefer intent content over placeholder', () => {
      const intent = createBasicIntent({
        content: 'Specific content',
        loopIntent: 'express',
      });

      const output = conductor.conduct(intent);

      expect(output.content).toBe('Specific content');
    });

    it('should prefer insight over intent content', () => {
      const intent = createBasicIntent({
        content: 'Intent content',
      });
      const insight = createTestInsight();

      const output = conductor.conduct(intent, insight);

      expect(output.content).toContain('synthesized insight');
      expect(output.content).not.toBe('Intent content');
    });
  });

  describe('Output Metadata', () => {
    it('should include timestamp', () => {
      const intent = createBasicIntent();
      const output = conductor.conduct(intent);

      expect(output.timestamp).toBeDefined();
      expect(new Date(output.timestamp)).toBeInstanceOf(Date);
    });

    it('should include reasoning', () => {
      const intent = createBasicIntent({
        reasoning: 'High output pressure and external prompt',
      });

      const output = conductor.conduct(intent);

      expect(output.reasoning).toContain('High output pressure');
    });

    it('should preserve urgency for speech', () => {
      const intent = createBasicIntent({ urgency: 0.8 });
      const output = conductor.conduct(intent);

      expect(output.urgency).toBe(0.8);
    });

    it('should set urgency to 0 for silence', () => {
      const intent = createBasicIntent({
        shouldSpeak: false,
        urgency: 0.7,
      });

      const output = conductor.conduct(intent);

      expect(output.urgency).toBe(0);
    });

    it('should preserve loop intent', () => {
      const intent = createBasicIntent({ loopIntent: 'express' });
      const output = conductor.conduct(intent);

      expect(output.loopIntent).toBe('express');
    });
  });

  describe('Quick Checks', () => {
    it('should return true for shouldOutput when intent allows', () => {
      const intent = createBasicIntent({
        shouldSpeak: true,
        guardianAllowed: true,
      });

      expect(conductor.shouldOutput(intent)).toBe(true);
    });

    it('should return false when shouldSpeak is false', () => {
      const intent = createBasicIntent({
        shouldSpeak: false,
        guardianAllowed: true,
      });

      expect(conductor.shouldOutput(intent)).toBe(false);
    });

    it('should return false when guardian blocks', () => {
      const intent = createBasicIntent({
        shouldSpeak: true,
        guardianAllowed: false,
      });

      expect(conductor.shouldOutput(intent)).toBe(false);
    });

    it('should correctly identify speech output type', () => {
      const intent = createBasicIntent({
        shouldSpeak: true,
        guardianAllowed: true,
        relationalTarget: 'jason',
      });

      expect(conductor.getOutputType(intent)).toBe('speech');
    });

    it('should correctly identify internal-reflection type', () => {
      const intent = createBasicIntent({
        shouldSpeak: true,
        guardianAllowed: true,
        relationalTarget: 'self',
      });

      expect(conductor.getOutputType(intent)).toBe('internal-reflection');
    });

    it('should correctly identify blocked type', () => {
      const intent = createBasicIntent({
        guardianAllowed: false,
      });

      expect(conductor.getOutputType(intent)).toBe('blocked');
    });

    it('should correctly identify silence type', () => {
      const intent = createBasicIntent({
        shouldSpeak: false,
      });

      expect(conductor.getOutputType(intent)).toBe('silence');
    });
  });

  describe('Display Formatting', () => {
    it('should format speech output for display', () => {
      const intent = createBasicIntent({
        content: 'Hello, this is a test.',
      });
      const output = conductor.conduct(intent);
      const display = conductor.formatForDisplay(output);

      expect(display).toContain('[SPEECH]');
      expect(display).toContain('external');
      expect(display).toContain('Hello, this is a test.');
    });

    it('should format silence output for display', () => {
      const intent = createBasicIntent({
        shouldSpeak: false,
        reasoning: 'No volitional pull to speak',
      });
      const output = conductor.conduct(intent);
      const display = conductor.formatForDisplay(output);

      expect(display).toContain('[SILENCE]');
      expect(display).toContain('Reason: No volitional pull to speak');
    });

    it('should format blocked output for display', () => {
      const intent = createBasicIntent({
        guardianAllowed: false,
        guardianMode: 'hardblock',
        guardianExpression: 'Too much tension right now.',
      });
      const output = conductor.conduct(intent);
      const display = conductor.formatForDisplay(output);

      expect(display).toContain('[BLOCKED]');
      expect(display).toContain('Guardian: hardblock');
      expect(display).toContain('Too much tension right now.');
    });

    it('should include relational target in display', () => {
      const intent = createBasicIntent({ relationalTarget: 'jason' });
      const output = conductor.conduct(intent);
      const display = conductor.formatForDisplay(output);

      expect(display).toContain('(jason)');
    });

    it('should not include channel for none', () => {
      const intent = createBasicIntent({ shouldSpeak: false });
      const output = conductor.conduct(intent);
      const display = conductor.formatForDisplay(output);

      expect(display).not.toContain('→ none');
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing content gracefully', () => {
      const intent = createBasicIntent();
      delete intent.content;

      const output = conductor.conduct(intent);

      expect(output.content).toBeDefined();
      expect(output.type).toBe('speech');
    });

    it('should handle both shouldSpeak false and guardian block', () => {
      const intent = createBasicIntent({
        shouldSpeak: false,
        guardianAllowed: false,
        guardianMode: 'hardblock',
      });

      const output = conductor.conduct(intent);

      // Guardian block takes precedence
      expect(output.type).toBe('blocked');
    });

    it('should handle high urgency with silence', () => {
      const intent = createBasicIntent({
        shouldSpeak: false,
        urgency: 0.95,
      });

      const output = conductor.conduct(intent);

      expect(output.type).toBe('silence');
      expect(output.urgency).toBe(0);
    });

    it('should handle zero urgency speech', () => {
      const intent = createBasicIntent({ urgency: 0 });
      const output = conductor.conduct(intent);

      expect(output.type).toBe('speech');
      expect(output.urgency).toBe(0);
    });
  });

  describe('Integration with Insight Synthesis', () => {
    it('should combine insight content with intent metadata', () => {
      const intent = createBasicIntent({
        relationalTarget: 'jason',
        urgency: 0.7,
        loopIntent: 'express',
      });
      const insight = createTestInsight();

      const output = conductor.conduct(intent, insight);

      expect(output.content).toContain('synthesized insight');
      expect(output.relationalTarget).toBe('jason');
      expect(output.urgency).toBe(0.7);
      expect(output.loopIntent).toBe('express');
    });

    it('should handle insight with high confidence', () => {
      const intent = createBasicIntent();
      const insight = createTestInsight();
      insight.confidence = 0.95;

      const output = conductor.conduct(intent, insight);

      expect(output.type).toBe('speech');
      expect(output.content).toBeTruthy();
    });

    it('should handle insight with low confidence', () => {
      const intent = createBasicIntent();
      const insight = createTestInsight();
      insight.confidence = 0.3;

      const output = conductor.conduct(intent, insight);

      // Still outputs, but with insight content
      expect(output.type).toBe('speech');
      expect(output.content).toContain('synthesized insight');
    });
  });
});
