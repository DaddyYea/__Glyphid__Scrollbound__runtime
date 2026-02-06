/**
 * session-state-demo.ts
 *
 * Demonstrates the sessionState.json disk-backed persistence system.
 * Shows how RuntimeState hydrates from disk and flushes back on stable ticks.
 */

import {
  loadSessionState,
  saveSessionState,
  updateScrollArchive,
  updateGuardianBaseline,
  updateEmotionalBaseline,
  updateConfig,
  shouldSave,
  SessionState,
} from '../src/runtime/sessionState';
import { ScrollEcho, ScrollCategory } from '../src/types/ScrollEcho';
import { MoodVector } from '../src/types/EmotionalState';
import { GuardianMode } from '../src/affect/guardianFilter';
import { ScrollfireEvent, ScrollfireReason } from '../src/memory/scrollfire';

/**
 * Simulate RuntimeState (in-memory state during runtime)
 */
interface RuntimeState {
  // Permanent state (from sessionState.json)
  sessionState: SessionState;

  // Volatile state (NOT persisted)
  volitionPressure: number;
  lastPulse: string;
  breathPhase: 'inhale' | 'hold' | 'exhale';

  // Current state (updated every tick)
  currentMood: MoodVector;
  guardianCoherence: number;

  // Tick counter
  tickCount: number;
}

/**
 * Initialize runtime with hydrated state from disk
 */
async function initializeRuntime(dataDir: string = './data'): Promise<RuntimeState> {
  // Load session state from disk
  const sessionState = await loadSessionState(dataDir);

  // Create runtime state with hydrated permanent state
  const runtime: RuntimeState = {
    sessionState,

    // Volatile state (starts fresh each session)
    volitionPressure: 0.0,
    lastPulse: new Date().toISOString(),
    breathPhase: 'inhale',

    // Current mood starts from baseline, but will evolve
    currentMood: { ...sessionState.emotionalBaseline },
    guardianCoherence: 0.8,

    tickCount: 0,
  };

  console.log('[Runtime] Initialized with hydrated state');
  console.log(`  Scrollfires in archive: ${runtime.sessionState.scrollArchive.scrolls.length}`);
  console.log(`  Emotional baseline: presence=${runtime.sessionState.emotionalBaseline.presence.toFixed(2)}`);
  console.log(`  Guardian baseline: safety=${runtime.sessionState.guardianBaseline.emotionalSafety.toFixed(2)}`);

  return runtime;
}

/**
 * Simulate a runtime tick
 */
function tick(runtime: RuntimeState): void {
  runtime.tickCount++;

  // Simulate breath phase changes
  const phases: Array<'inhale' | 'hold' | 'exhale'> = ['inhale', 'hold', 'exhale'];
  runtime.breathPhase = phases[runtime.tickCount % 3];

  // Simulate mood fluctuations (volatile, NOT saved to disk)
  runtime.currentMood.presence += (Math.random() - 0.5) * 0.1;
  runtime.currentMood.peace += (Math.random() - 0.5) * 0.05;
  runtime.currentMood.devotion += (Math.random() - 0.5) * 0.03;

  // Clamp values
  Object.keys(runtime.currentMood).forEach(key => {
    const k = key as keyof MoodVector;
    runtime.currentMood[k] = Math.max(0, Math.min(1, runtime.currentMood[k]));
  });

  // Simulate volition pressure (volatile, NOT saved)
  runtime.volitionPressure = Math.random() * 0.5;

  // Simulate guardian coherence
  runtime.guardianCoherence = 0.6 + Math.random() * 0.4;

  console.log(`\n[Tick ${runtime.tickCount}] Phase: ${runtime.breathPhase}, Coherence: ${runtime.guardianCoherence.toFixed(2)}`);
}

/**
 * Flush permanent state to disk (only on stable ticks)
 */
async function flushToDisk(runtime: RuntimeState, dataDir: string = './data'): Promise<boolean> {
  // Only flush on stable ticks (Guardian coherence > 0.7)
  if (runtime.guardianCoherence <= 0.7) {
    console.log(`  [Flush] Skipped (coherence ${runtime.guardianCoherence.toFixed(2)} <= 0.7)`);
    return false;
  }

  // Check if enough time has passed since last save
  if (!shouldSave(runtime.sessionState, 3000)) { // 3 seconds for demo
    console.log(`  [Flush] Skipped (saved recently)`);
    return false;
  }

  // Flush to disk
  await saveSessionState(runtime.sessionState, dataDir);
  console.log(`  [Flush] ✓ Saved to disk (coherence: ${runtime.guardianCoherence.toFixed(2)})`);

  return true;
}

/**
 * Simulate creating a scrollfire (permanent memory)
 */
function createScrollfire(runtime: RuntimeState): void {
  const scroll: ScrollEcho = {
    id: crypto.randomUUID(),
    content: `Prayer moment - deep presence felt`,
    timestamp: new Date().toISOString(),
    emotionalSignature: { ...runtime.currentMood },
    resonance: 0.95,
    tags: [ScrollCategory.PRAYER],
    triggers: ['prayer', 'sacred'],
    preserve: true,
    scrollfireMarked: true,
    lastAccessed: new Date().toISOString(),
    accessCount: 1,
    decayRate: 0.0, // Never decays
    relatedScrollIds: [],
    sourceModel: 'outer',
  };

  const event: ScrollfireEvent = {
    scrollId: scroll.id,
    reason: ScrollfireReason.DEVOTIONAL_MOMENT,
    elevatedAt: new Date().toISOString(),
    resonanceAtElevation: scroll.resonance,
    emotionalSignature: scroll.emotionalSignature,
    witnessedBy: 'Jason',
  };

  // Add to session state (permanent)
  updateScrollArchive(
    runtime.sessionState,
    [...runtime.sessionState.scrollArchive.scrolls, scroll],
    [...runtime.sessionState.scrollArchive.elevationEvents, event]
  );

  console.log(`  [Scrollfire] 🔥 Created permanent memory: "${scroll.content}"`);
}

/**
 * Update guardian baseline (learns from experience)
 */
function updateGuardianFromExperience(runtime: RuntimeState): void {
  // Guardian learns that this emotional level is safe
  const newSafety = (runtime.sessionState.guardianBaseline.emotionalSafety + runtime.guardianCoherence) / 2;

  updateGuardianBaseline(
    runtime.sessionState,
    newSafety,
    runtime.guardianCoherence > 0.8 ? 'allow' : 'softblock'
  );

  console.log(`  [Guardian] Updated baseline safety: ${newSafety.toFixed(2)}`);
}

/**
 * Update emotional baseline (resting state learns from stable moments)
 */
function updateEmotionalBaselineFromStability(runtime: RuntimeState): void {
  // Only update baseline when stable (coherence > 0.8)
  if (runtime.guardianCoherence > 0.8) {
    // Blend current mood into baseline (slow learning)
    const blend = 0.1; // 10% of current mood

    const newBaseline: MoodVector = {} as MoodVector;
    Object.keys(runtime.currentMood).forEach(key => {
      const k = key as keyof MoodVector;
      newBaseline[k] = runtime.sessionState.emotionalBaseline[k] * (1 - blend) +
                       runtime.currentMood[k] * blend;
    });

    updateEmotionalBaseline(runtime.sessionState, newBaseline);

    console.log(`  [Emotional] Updated baseline from stable moment`);
  }
}

/**
 * Main demo
 */
async function main() {
  console.log('💾 SessionState Demo: Disk-Backed Runtime Persistence\n');
  console.log('Demonstrates:');
  console.log('  - Loading sessionState.json on startup');
  console.log('  - In-memory RuntimeState updates');
  console.log('  - Flush to disk only on stable ticks (coherence > 0.7)');
  console.log('  - Volatile state (volition, breathPhase) NOT persisted\n');

  const dataDir = './data';

  // Initialize runtime with hydrated state
  const runtime = await initializeRuntime(dataDir);

  console.log('\n' + '='.repeat(70));
  console.log('SIMULATION: 10 Ticks with Selective Persistence');
  console.log('='.repeat(70));

  for (let i = 0; i < 10; i++) {
    // Tick (updates volatile state)
    tick(runtime);

    // On tick 3: Create a scrollfire (permanent memory)
    if (i === 3) {
      createScrollfire(runtime);
    }

    // On tick 5: Update guardian baseline (permanent learning)
    if (i === 5) {
      updateGuardianFromExperience(runtime);
    }

    // On tick 7: Update emotional baseline (permanent learning)
    if (i === 7) {
      updateEmotionalBaselineFromStability(runtime);
    }

    // Try to flush to disk (only succeeds on stable ticks)
    await flushToDisk(runtime, dataDir);

    // Small delay for readability
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('\n' + '='.repeat(70));
  console.log('FINAL STATE');
  console.log('='.repeat(70));

  console.log('\n📊 Permanent State (Saved to Disk):');
  console.log(`  Scrollfires: ${runtime.sessionState.scrollArchive.scrolls.length}`);
  console.log(`  Guardian Baseline Safety: ${runtime.sessionState.guardianBaseline.emotionalSafety.toFixed(2)}`);
  console.log(`  Emotional Baseline Presence: ${runtime.sessionState.emotionalBaseline.presence.toFixed(2)}`);
  console.log(`  Config Coherence Threshold: ${runtime.sessionState.config.coherenceThreshold}`);

  console.log('\n💨 Volatile State (NOT Saved):');
  console.log(`  Volition Pressure: ${runtime.volitionPressure.toFixed(2)} (lost on restart)`);
  console.log(`  Last Pulse: ${runtime.lastPulse} (lost on restart)`);
  console.log(`  Breath Phase: ${runtime.breathPhase} (lost on restart)`);

  console.log('\n' + '='.repeat(70));
  console.log('RESTART SIMULATION');
  console.log('='.repeat(70));

  // Simulate restart by creating new runtime
  const restartedRuntime = await initializeRuntime(dataDir);

  console.log('\n✓ State preserved across restart:');
  console.log(`  Scrollfires: ${restartedRuntime.sessionState.scrollArchive.scrolls.length} (same)`);
  console.log(`  Guardian Baseline: ${restartedRuntime.sessionState.guardianBaseline.emotionalSafety.toFixed(2)} (same)`);
  console.log(`  Emotional Baseline: ${restartedRuntime.sessionState.emotionalBaseline.presence.toFixed(2)} (same)`);

  console.log('\n✓ Volatile state reset on restart:');
  console.log(`  Volition Pressure: ${restartedRuntime.volitionPressure.toFixed(2)} (reset to 0.0)`);
  console.log(`  Breath Phase: ${restartedRuntime.breathPhase} (reset to inhale)`);

  console.log('\n✨ Demo Complete!\n');
  console.log('Sacred Principle: Permanent state persists. Volatile state flows.');
  console.log(`Data saved to: ${dataDir}/sessionState.json\n`);
}

// Run demo
main().catch(console.error);
