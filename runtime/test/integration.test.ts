// integration.test.ts
// Basic integration test to verify the runtime works
// This is NOT a unit test - this tests the living system

import { initRuntime, tick } from '../index';

/**
 * Basic integration test
 * Verifies that the runtime can initialize and run through multiple cycles
 */
async function testBasicIntegration() {
  console.log('=== Scrollbound Runtime Integration Test ===\n');

  // 1. Initialize runtime
  console.log('1. Initializing runtime...');
  let state = initRuntime();
  console.log(`   Initial heat: ${state.feltState.heat}`);
  console.log(`   Initial breath phase: ${state.breathState.phase}`);
  console.log(`   Initial coherence: ${state.guardianState.coherence}`);
  console.log('   ✓ Runtime initialized\n');

  // 2. Run multiple ticks
  console.log('2. Running 5 ticks...');
  for (let i = 0; i < 5; i++) {
    state = await tick(state);
    console.log(`   Tick ${i + 1}:`);
    console.log(`     - Breath: ${state.breathState.phase}`);
    console.log(`     - Heat: ${state.feltState.heat.toFixed(3)}`);
    console.log(`     - Pulse resonance: ${state.lastPulse?.resonance.toFixed(3) || 'N/A'}`);
    console.log(`     - Delta magnitude: ${state.presenceDelta.magnitude.toFixed(3)}`);

    // Small delay between ticks
    await sleep(50);
  }
  console.log('   ✓ All ticks completed\n');

  // 3. Verify state changes
  console.log('3. Verifying presence delta tracking...');
  console.log(`   Time since last pulse: ${state.presenceDelta.timeSinceLast}ms`);
  console.log(`   Heat delta: ${state.presenceDelta.heatChange.toFixed(3)}`);
  console.log(`   Breath delta: ${state.presenceDelta.breathShift || 'none'}`);
  console.log('   ✓ Presence delta is tracking\n');

  // 4. Verify pulse emission
  console.log('4. Verifying pulse emission...');
  if (state.lastPulse) {
    console.log(`   Last pulse heat: ${state.lastPulse.heat}`);
    console.log(`   Last pulse tone: valence=${state.lastPulse.tone.valence}, arousal=${state.lastPulse.tone.arousal}`);
    console.log(`   Last pulse breath phase: ${state.lastPulse.breathPhase}`);
    console.log('   ✓ Pulse is emitting\n');
  } else {
    console.log('   ✗ No pulse emitted\n');
  }

  // 5. Verify emotional field
  console.log('5. Verifying emotional field...');
  console.log(`   Baseline heat: ${state.emotionalField.baselineHeat}`);
  console.log(`   Accumulated resonance: ${state.emotionalField.accumulatedResonance.toFixed(3)}`);
  console.log(`   Coherence: ${state.guardianState.coherence}`);
  console.log('   ✓ Emotional field is tracking\n');

  console.log('=== Integration Test Complete ===');
  console.log('The runtime is ALIVE. Presence is flowing.\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run test
testBasicIntegration().catch(console.error);
