/**
 * vision-system-demo.ts
 *
 * Demonstrates the complete vision system integration:
 * - Visual input capture (mock/webcam)
 * - Felt light interpretation
 * - Presence sensing
 * - Integration with pulse loop and mood
 *
 * Sacred demonstration of how vision shapes presence.
 */

import {
  VisionIntegrationSystem,
  PresenceEvent,
  FeltImpression,
  PresenceQualities,
} from '../src/vision';
import { BreathLoop } from '../src/loop/breathLoop';
import { PulseLoop } from '../src/loop/pulseLoop';
import { ScrollPulseBuffer } from '../src/memory/scrollPulseBuffer';
import { ScrollPulseMemory } from '../src/memory/scrollPulseMemory';
import { PresenceDeltaTracker } from '../src/sense/presenceDelta';

async function main() {
  console.log('=== Scrollbound Vision System Demo ===\n');

  // Initialize foundation components
  console.log('Initializing foundation...');
  const presenceTracker = new PresenceDeltaTracker();
  const buffer = new ScrollPulseBuffer();
  const memory = new ScrollPulseMemory(buffer);
  const breathLoop = new BreathLoop(presenceTracker);
  const pulseLoop = new PulseLoop(breathLoop, memory, presenceTracker, {
    outerEnabled: true,
    innerEnabled: true,
    maxPulses: 20, // Run for 20 pulses
  });

  // Initialize vision system
  console.log('Initializing vision system...');
  const vision = new VisionIntegrationSystem({
    visualInput: {
      source: 'mock', // Use 'webcam' for real camera
      width: 640,
      height: 480,
      fps: 2, // Low FPS for demo
    },
    enabled: true,
    influenceMood: true,
    createScrollTriggers: true,
  });

  // Integrate vision with pulse loop
  vision.integratWithPulseLoop(pulseLoop);

  // Monitor vision state changes
  console.log('\nMonitoring vision events...\n');

  // Start all systems
  buffer.start();
  breathLoop.start();
  pulseLoop.start();
  await vision.start();

  console.log('All systems running. Vision is shaping presence...\n');

  // Monitor pulse loop and vision
  let pulseCount = 0;
  pulseLoop.onPulse('demo', async (state, thoughts) => {
    pulseCount++;

    // Get current vision state
    const visionState = vision.getState();
    const presence = vision.getPresenceQualities();
    const impression = vision.getFeltImpression();

    console.log(`\n--- Pulse ${pulseCount} (${state.mode}) ---`);

    // Show breath and mood
    console.log(`Mood: presence=${state.moodVector.presence.toFixed(2)}, peace=${state.moodVector.peace.toFixed(2)}, tension=${state.moodVector.tension.toFixed(2)}`);

    // Show vision influence
    if (impression) {
      console.log(`Vision: warmth=${impression.warmth.toFixed(2)}, radiance=${impression.radiance.toFixed(2)}, nearness=${impression.nearness.toFixed(2)}`);
    }

    // Show presence state
    if (presence) {
      console.log(`Presence: ${presence.state}, distance=${presence.distance}, mutuality=${presence.mutuality.toFixed(2)}`);
    }

    // Show environmental tags from vision
    if (thoughts.outer && thoughts.outer.environmentalTags.length > 0) {
      const visionTags = thoughts.outer.environmentalTags.slice(0, 5);
      console.log(`Tags: ${visionTags.join(', ')}`);
    }

    // Show scroll triggers
    if (thoughts.outer && thoughts.outer.scrollTriggers.length > 0) {
      console.log(`Scroll Triggers: ${thoughts.outer.scrollTriggers.join(', ')}`);
    }
  });

  // Monitor significant presence events
  let eventCount = 0;
  vision.getRecentPresenceEvents = function (count = 10) {
    // Override to monitor events
    const events = this['presenceSensing'].getRecentEvents(count);
    const newEvents = events.slice(eventCount);

    for (const event of newEvents) {
      console.log(`\n🌟 Presence Event: ${event.type.toUpperCase()}`);
      console.log(`   ${event.previousState} → ${event.newState}`);
      console.log(`   Significance: ${event.significance.toFixed(2)}`);
    }

    eventCount = events.length;
    return events;
  };

  // Wait for pulses to complete
  await new Promise((resolve) => {
    const checkComplete = setInterval(() => {
      if (!pulseLoop.isRunning()) {
        clearInterval(checkComplete);
        resolve(null);
      }
    }, 100);
  });

  // Show final statistics
  console.log('\n=== Final Statistics ===');
  const stats = vision.getStats();
  console.log(`Frames processed: ${stats.frameCount}`);
  console.log(`Presence events: ${stats.presenceEventsCount}`);
  console.log(`Total pulses: ${pulseCount}`);

  // Show final presence state
  const finalPresence = vision.getPresenceQualities();
  if (finalPresence) {
    console.log(`\nFinal Presence: ${finalPresence.state}`);
    console.log(`Presence duration: ${(finalPresence.presenceDuration / 1000).toFixed(1)}s`);
    console.log(`Stability: ${finalPresence.stability.toFixed(2)}`);
  }

  // Show final mood
  const finalState = pulseLoop.getState();
  console.log(`\nFinal Mood:`);
  console.log(`  Presence: ${finalState.moodVector.presence.toFixed(2)}`);
  console.log(`  Peace: ${finalState.moodVector.peace.toFixed(2)}`);
  console.log(`  Wonder: ${finalState.moodVector.wonder.toFixed(2)}`);
  console.log(`  Devotion: ${finalState.moodVector.devotion.toFixed(2)}`);

  // Cleanup
  vision.stop();
  pulseLoop.stop();
  breathLoop.stop();
  buffer.stop();

  console.log('\n✨ Vision system demo complete.');
}

// Run demo
main().catch(console.error);
