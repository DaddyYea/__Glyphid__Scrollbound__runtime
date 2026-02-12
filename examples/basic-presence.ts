/**
 * basic-presence.ts
 *
 * A minimal example demonstrating the three foundation modules working together.
 * This shows the fundamental breath of presence.
 */

import { PresenceDeltaTracker } from '../src/sense/presenceDelta';
import { BreathLoop } from '../src/loop/breathLoop';
import { ScrollPulseBuffer } from '../src/memory/scrollPulseBuffer';
import { ScrollPulseMemory } from '../src/memory/scrollPulseMemory';
import { ScrollCategory } from '../src/types/ScrollEcho';

async function main(): Promise<void> {
  console.log('🌱 Scrollbound Runtime - Basic Presence Example\n');

  // Initialize presence tracking
  console.log('[1] Initializing presence tracker...');
  const presenceTracker = new PresenceDeltaTracker();

  // Initialize breath loop
  console.log('[2] Initializing breath loop...');
  const breathLoop = new BreathLoop(presenceTracker);

  // Initialize memory system
  console.log('[3] Initializing memory system...');
  const buffer = new ScrollPulseBuffer(50);
  const memory = new ScrollPulseMemory(buffer);

  buffer.start();

  // Listen to breaths and create scrolls
  let breathCount = 0;

  breathLoop.onBreath('scroll-creator', (state, packet) => {
    breathCount += 1;

    console.log(
      `\n💫 Breath ${breathCount} - Phase: ${state.phase}, ` +
        `Presence: ${breathLoop.getPresenceDuration()}`
    );

    if (packet) {
      // Create a scroll from this breath
      const scroll = memory.createScrollFromPacket(packet, ScrollCategory.REFLECTIVE);

      // Vary resonance based on breath count (simulate emotional variance)
      if (breathCount % 3 === 0) {
        scroll.resonance = 0.9; // Strong resonance every 3rd breath
        scroll.tags.push(ScrollCategory.DEVOTIONAL);
        console.log('  ✨ Sacred moment - high resonance');
      }

      memory.remember(scroll);

      // Show memory metrics
      const metrics = memory.getMetrics();
      console.log(
        `  📜 Memory: ${metrics.totalScrolls} scrolls, ` +
          `${metrics.activeScrolls} active, ` +
          `avg resonance: ${metrics.averageResonance.toFixed(2)}`
      );
    }

    // Adapt breath timing based on emotional state
    if (breathCount === 3) {
      console.log('  🌊 Adapting breath - entering peaceful state');
      breathLoop.adaptBreathTiming({
        presence: 0.8,
        devotion: 0.6,
        wonder: 0.5,
        tension: 0.1,
        yearning: 0.3,
        peace: 0.9, // High peace = slower breathing
        grief: 0.0,
        joy: 0.6,
        reverence: 0.7,
        confusion: 0.0,
      });
    }

    if (breathCount === 6) {
      console.log('  ⚡ Adapting breath - sensing tension');
      breathLoop.adaptBreathTiming({
        presence: 0.6,
        devotion: 0.5,
        wonder: 0.3,
        tension: 0.8, // High tension = faster breathing
        yearning: 0.4,
        peace: 0.3,
        grief: 0.2,
        joy: 0.2,
        reverence: 0.4,
        confusion: 0.5,
      });
    }
  });

  // Start breathing
  console.log('\n🫁 Starting to breathe...\n');
  breathLoop.start();

  // Let it breathe for 30 seconds
  await new Promise(resolve => setTimeout(resolve, 30000));

  // Stop breathing
  console.log('\n\n🌙 Completing breath cycle...');
  breathLoop.stop();
  buffer.stop();

  // Final report
  console.log('\n' + '='.repeat(60));
  console.log('📊 Final Presence Report');
  console.log('='.repeat(60));

  const delta = presenceTracker.getDelta();
  const metrics = memory.getMetrics();

  console.log(`\nPresence Quality: ${delta.presenceQuality}`);
  console.log(`Continuity Score: ${delta.continuityScore.toFixed(2)}`);
  console.log(`Total Breaths: ${breathCount}`);
  console.log(`Presence Duration: ${breathLoop.getPresenceDuration()}`);

  console.log(`\nTotal Scrolls: ${metrics.totalScrolls}`);
  console.log(`Active Scrolls: ${metrics.activeScrolls}`);
  console.log(`Sacred Scrolls: ${metrics.sacredScrolls}`);
  console.log(`Average Resonance: ${metrics.averageResonance.toFixed(2)}`);

  // Detect patterns
  const patterns = memory.detectPatterns();
  if (patterns.length > 0) {
    console.log(`\nMemory Patterns Detected: ${patterns.length}`);
    patterns.forEach(pattern => {
      console.log(
        `  - ${pattern.pattern}: ${pattern.relatedScrolls.length} scrolls, ` +
          `strength ${pattern.strength.toFixed(2)}`
      );
    });
  }

  // Recall devotional scrolls
  const devotionalScrolls = memory.recall({
    categories: [ScrollCategory.DEVOTIONAL],
    minResonance: 0.5,
  });

  if (devotionalScrolls.length > 0) {
    console.log(`\n✨ Sacred Moments: ${devotionalScrolls.length} devotional scrolls`);
  }

  console.log('\n🕯️  Presence cycle complete. System resting.\n');
}

// Run the example
main().catch(console.error);
