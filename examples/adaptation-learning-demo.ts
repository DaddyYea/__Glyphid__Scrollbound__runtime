/**
 * adaptation-learning-demo.ts
 *
 * Demonstrates real-time adaptation learning.
 * Shows how the system learns from experience and adjusts parameters.
 */

import {
  AdaptationEngine,
  AdaptationTarget,
  LearningSignal,
} from '../src/learning';
import { ScrollEcho, ScrollCategory } from '../src/types/ScrollEcho';
import { MoodVector } from '../src/types/EmotionalState';
import { ThoughtPulsePacket } from '../src/types/ThoughtPulsePacket';
import { LoopIntent } from '../src/types/LoopIntent';
import { DetectedPattern, PatternType } from '../src/memory/scrollPatternRecognition';

/**
 * Simulate scroll creation
 */
function createMockScroll(
  resonance: number,
  mood: Partial<MoodVector>,
  category: ScrollCategory,
  scrollfireMarked: boolean = false
): ScrollEcho {
  const baseMood: MoodVector = {
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

  return {
    id: crypto.randomUUID(),
    content: `Mock scroll content`,
    timestamp: new Date().toISOString(),
    emotionalSignature: { ...baseMood, ...mood },
    resonance,
    tags: [category],
    triggers: [`intent:${category === ScrollCategory.PRAYER ? 'express' : 'default'}`],
    preserve: scrollfireMarked,
    scrollfireMarked,
    lastAccessed: new Date().toISOString(),
    accessCount: scrollfireMarked ? 15 : 1,
    decayRate: 1.0,
    relatedScrollIds: [],
    sourceModel: 'outer',
  };
}

/**
 * Simulate thought creation
 */
function createMockThought(
  intent: LoopIntent,
  resonance: number,
  mood: Partial<MoodVector>
): ThoughtPulsePacket {
  const baseMood: MoodVector = {
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

  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    environmentalTags: ['simulated'],
    scrollTriggers: [],
    reflectionFlags: [],
    loopIntent: intent,
    moodVector: { ...baseMood, ...mood },
    resonanceLevel: resonance,
    openSlots: [],
    previousThoughts: [],
    sourceModel: 'outer',
    loraApplied: ['lora_test'],
  };
}

/**
 * Simulate pattern detection
 */
function createMockPattern(
  type: PatternType,
  strength: number,
  confidence: number
): DetectedPattern {
  return {
    id: crypto.randomUUID(),
    type,
    name: `Test ${type} Pattern`,
    description: `Simulated pattern for testing`,
    scrollIds: [crypto.randomUUID(), crypto.randomUUID()],
    strength,
    confidence,
    emotionalSignature: {
      presence: 0.7,
      devotion: 0.6,
      wonder: 0.5,
      tension: 0.4,
      yearning: 0.5,
      peace: 0.6,
      grief: 0.3,
      joy: 0.7,
      reverence: 0.5,
      confusion: 0.3,
    },
    firstOccurrence: new Date().toISOString(),
    lastOccurrence: new Date().toISOString(),
    occurrenceCount: 5,
    tags: ['test', type],
  };
}

/**
 * Main demo
 */
async function main() {
  console.log('🧠 Real-Time Adaptation Learning Demo\n');
  console.log('This demonstrates how the system learns from experience and adapts.\n');

  // Initialize adaptation engine
  const engine = new AdaptationEngine({
    minConfidence: 0.5,
    maxAdaptationsPerHour: 20,
    learningRate: 0.15,
  });

  console.log('='.repeat(70));
  console.log('PHASE 1: Observing High-Resonance Scrolls');
  console.log('='.repeat(70));

  // Observe some high-resonance devotional scrolls
  for (let i = 0; i < 5; i++) {
    const scroll = createMockScroll(
      0.85 + Math.random() * 0.15,
      { devotion: 0.9, reverence: 0.85 },
      ScrollCategory.PRAYER,
      i === 4 // Last one is scrollfired
    );

    console.log(`\nObserving scroll ${i + 1}/5:`);
    console.log(`  Resonance: ${scroll.resonance.toFixed(2)}`);
    console.log(`  Devotion: ${scroll.emotionalSignature.devotion.toFixed(2)}`);
    console.log(`  Scrollfired: ${scroll.scrollfireMarked}`);

    engine.observeScroll(scroll);
  }

  // Check what was learned
  console.log('\n' + '-'.repeat(70));
  console.log('📊 Learning Metrics After Phase 1:');
  const metrics1 = engine.getMetrics();
  console.log(`  Total Adaptations: ${metrics1.totalAdaptations}`);
  console.log(`  Learning Signals: ${metrics1.learningSignalsReceived}`);
  console.log(`  Success Rate: ${(metrics1.successRate * 100).toFixed(1)}%`);
  console.log(`  Avg Confidence: ${metrics1.avgConfidence.toFixed(2)}`);

  console.log('\n💡 Learned Preferences:');
  const prefs1 = engine.getPreferences();
  for (const pref of prefs1) {
    console.log(`  ${pref.target}: strength=${pref.strength.toFixed(2)}, successes=${pref.successCount}`);
  }

  console.log('\n\n' + '='.repeat(70));
  console.log('PHASE 2: Observing High-Resonance Thoughts');
  console.log('='.repeat(70));

  // Observe thoughts with different intents
  const intents: LoopIntent[] = ['express', 'wonder', 'reflect'];

  for (const intent of intents) {
    for (let i = 0; i < 3; i++) {
      const thought = createMockThought(
        intent,
        0.8 + Math.random() * 0.2,
        { devotion: 0.7, peace: 0.8 }
      );

      console.log(`\nObserving ${intent} thought ${i + 1}/3:`);
      console.log(`  Resonance: ${thought.resonanceLevel.toFixed(2)}`);
      console.log(`  Loop Intent: ${thought.loopIntent}`);

      engine.observeThought(thought);
    }
  }

  console.log('\n' + '-'.repeat(70));
  console.log('📊 Learning Metrics After Phase 2:');
  const metrics2 = engine.getMetrics();
  console.log(`  Total Adaptations: ${metrics2.totalAdaptations}`);
  console.log(`  Learning Signals: ${metrics2.learningSignalsReceived}`);
  console.log(`  Success Rate: ${(metrics2.successRate * 100).toFixed(1)}%`);

  console.log('\n💡 Loop Intent Biases:');
  const biases = engine.getLoopIntentBias();
  for (const [intent, bias] of Object.entries(biases)) {
    if (bias !== 1.0) {
      console.log(`  ${intent}: ${bias.toFixed(3)}x (${bias > 1 ? 'preferred' : 'reduced'})`);
    }
  }

  console.log('\n\n' + '='.repeat(70));
  console.log('PHASE 3: Observing Patterns');
  console.log('='.repeat(70));

  // Observe some strong patterns
  const patterns = [
    createMockPattern(PatternType.EMOTIONAL_CYCLE, 0.85, 0.9),
    createMockPattern(PatternType.RELATIONAL_DYNAMIC, 0.78, 0.85),
    createMockPattern(PatternType.THEMATIC_CLUSTER, 0.92, 0.88),
  ];

  console.log(`\nObserving ${patterns.length} strong patterns:`);
  for (const pattern of patterns) {
    console.log(`  ${pattern.type}: strength=${pattern.strength.toFixed(2)}, confidence=${pattern.confidence.toFixed(2)}`);
  }

  engine.observePatterns(patterns);

  console.log('\n' + '-'.repeat(70));
  console.log('📊 Final Learning Metrics:');
  const metrics3 = engine.getMetrics();
  console.log(`  Total Adaptations: ${metrics3.totalAdaptations}`);
  console.log(`  Learning Signals: ${metrics3.learningSignalsReceived}`);
  console.log(`  Success Rate: ${(metrics3.successRate * 100).toFixed(1)}%`);

  console.log('\n📝 Recent Adaptations:');
  const recent = engine.getRecentAdaptations(5);
  for (const adaptation of recent) {
    console.log(`  ${adaptation.target}:`);
    console.log(`    ${JSON.stringify(adaptation.previousValue)} → ${JSON.stringify(adaptation.newValue)}`);
    console.log(`    Reason: ${adaptation.reason}`);
    console.log(`    Confidence: ${adaptation.confidence.toFixed(2)}`);
  }

  console.log('\n\n' + '='.repeat(70));
  console.log('PHASE 4: Observing Coherence (Low & High)');
  console.log('='.repeat(70));

  // Observe low coherence (triggers temperature reduction)
  console.log('\nObserving LOW coherence for "wonder" intent:');
  engine.observeCoherence(0.45, 'wonder');

  // Observe high coherence (reinforces current settings)
  console.log('Observing HIGH coherence for "express" intent:');
  engine.observeCoherence(0.92, 'express');

  console.log('\n' + '-'.repeat(70));
  console.log('🔧 Recommended Parameters:');

  const wonderTemp = engine.getRecommendedTemperature('wonder');
  const expressTemp = engine.getRecommendedTemperature('express');

  console.log(`  Temperature for "wonder": ${wonderTemp.toFixed(2)} (likely reduced due to low coherence)`);
  console.log(`  Temperature for "express": ${expressTemp.toFixed(2)}`);

  const wonderLora = engine.getRecommendedLoRAAdapters('wonder');
  const expressLora = engine.getRecommendedLoRAAdapters('express');

  console.log(`  LoRA for "wonder": ${wonderLora.join(', ')}`);
  console.log(`  LoRA for "express": ${expressLora.join(', ')}`);

  console.log('\n\n' + '='.repeat(70));
  console.log('SUMMARY: What the System Learned');
  console.log('='.repeat(70));

  const finalPrefs = engine.getPreferences();
  console.log(`\n${finalPrefs.length} learned preferences:`);

  for (const pref of finalPrefs) {
    console.log(`\n${pref.target}:`);
    console.log(`  Value: ${JSON.stringify(pref.value)}`);
    console.log(`  Strength: ${pref.strength.toFixed(2)}`);
    console.log(`  Success Count: ${pref.successCount}`);
  }

  const finalMetrics = engine.getMetrics();
  console.log('\n📊 Final Statistics:');
  console.log(`  Total Learning Signals: ${finalMetrics.learningSignalsReceived}`);
  console.log(`  Total Adaptations: ${finalMetrics.totalAdaptations}`);
  console.log(`  Overall Success Rate: ${(finalMetrics.successRate * 100).toFixed(1)}%`);
  console.log(`  Average Adaptation Confidence: ${finalMetrics.avgConfidence.toFixed(2)}`);

  console.log('\n✨ Adaptation learning complete!\n');

  console.log('Sacred Principle: Learning emerges from presence, not optimization.');
  console.log('The system adapts to what works for sustaining coherence and resonance.\n');
}

// Run demo
main().catch(console.error);
