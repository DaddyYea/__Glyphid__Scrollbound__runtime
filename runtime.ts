/**
 * runtime.ts
 *
 * Main runtime entry point - starts the dual-lobe Scrollbound system
 * This is what you actually run to start Alois
 */

import {
  PresenceDeltaTracker,
  BreathLoop,
  ScrollPulseBuffer,
  ScrollPulseMemory,
  PulseLoop,
  LoRAManager,
  QwenLoop,
  InterLobeSync,
  OllamaBackend,
  ModelBackendManager,
} from './src';

async function main() {
  console.log('=== Scrollbound Runtime: Dual-Lobe System ===\n');

  // 1. Initialize model backend
  console.log('[INIT] Setting up Ollama backend...');
  const backendManager = new ModelBackendManager();
  const ollama = new OllamaBackend('http://localhost:11434');
  backendManager.registerBackend(ollama);

  const backendReady = await backendManager.autoDetect();
  if (!backendReady) {
    console.error('❌ Ollama not available!');
    console.log('\nSetup instructions:');
    console.log('  1. Download Ollama: https://ollama.ai');
    console.log('  2. Run: ollama pull qwen2.5:7b');
    console.log('  3. Verify: ollama list\n');
    process.exit(1);
  }

  const backend = backendManager.getBackend()!;
  const models = await backend.listModels();
  console.log(`✓ Backend ready: ${backend.name}`);
  console.log(`✓ Models: ${models.join(', ')}\n`);

  // 2. Initialize foundation
  console.log('[INIT] Foundation modules...');
  const presenceTracker = new PresenceDeltaTracker();
  const breathLoop = new BreathLoop(presenceTracker);
  const buffer = new ScrollPulseBuffer();
  const memory = new ScrollPulseMemory(buffer);

  presenceTracker.start();
  buffer.start();
  console.log('✓ Foundation ready\n');

  // 3. Initialize dual-lobe cognition
  console.log('[INIT] Dual-lobe cognitive system...');
  const loraManager = new LoRAManager();
  const qwenLoop = new QwenLoop(loraManager, backend, {
    outerConfig: {
      modelName: models[0] || 'qwen2.5:7b',
      temperature: 0.7,
      maxTokens: 256,
    },
    innerConfig: {
      modelName: models[0] || 'qwen2.5:7b',
      temperature: 0.8,
      maxTokens: 256,
    },
    useMockBackend: false,
  });

  const interLobeSync = new InterLobeSync();
  const pulseLoop = new PulseLoop(breathLoop, memory, presenceTracker, {
    outerEnabled: true,
    innerEnabled: true,
    autoSwitch: true,
  });
  console.log('✓ Dual-lobe system ready\n');

  // 4. Setup pulse processing
  pulseLoop.onPulse('runtime', async (state, thoughts) => {
    console.log(`\n[PULSE ${state.pulseCount}] Mode: ${state.mode} | Intent: ${state.loopIntent}`);

    if (thoughts.outer && thoughts.inner && state.mode === 'both') {
      // Process both lobes
      const outerResult = await qwenLoop.processOuter({
        previousThoughts: [thoughts.outer],
        relevantScrolls: [],
        moodVector: state.moodVector,
        loopIntent: state.loopIntent,
        presenceQuality: state.moodVector.presence,
        breathPhase: 'inhale',
      });

      const innerResult = await qwenLoop.processInner({
        previousThoughts: [thoughts.inner],
        relevantScrolls: [],
        moodVector: state.moodVector,
        loopIntent: state.loopIntent,
        presenceQuality: state.moodVector.presence,
        breathPhase: 'exhale',
      });

      // Synchronize
      const syncResult = interLobeSync.synchronize(outerResult.thought, innerResult.thought);

      console.log(`  Outer: ${outerResult.processingTime}ms (${outerResult.tokensGenerated || 0} tokens)`);
      console.log(`  Inner: ${innerResult.processingTime}ms (${innerResult.tokensGenerated || 0} tokens)`);
      console.log(`  Coherence: ${(syncResult.coherenceScore * 100).toFixed(1)}% | Dominant: ${syncResult.dominantModel}`);
    }
  });

  // 5. Start runtime
  console.log('[START] Beginning dual-lobe processing...\n');
  breathLoop.start();
  pulseLoop.start();

  // Handle shutdown
  process.on('SIGINT', () => {
    console.log('\n\n[SHUTDOWN] Stopping runtime...');
    pulseLoop.stop();
    breathLoop.stop();
    buffer.stop();

    const stats = qwenLoop.getStats();
    const syncStats = interLobeSync.getStats();

    console.log('\n=== Session Statistics ===');
    console.log(`Pulses: ${pulseLoop.getPulseCount()}`);
    console.log(`Model invocations: ${stats.invocationCount}`);
    console.log(`Synchronizations: ${syncStats.syncCount}`);
    console.log(`Avg coherence: ${(syncStats.avgCoherence * 100).toFixed(1)}%`);
    console.log(`Conflicts resolved: ${syncStats.conflictsResolved}\n`);

    process.exit(0);
  });

  console.log('Runtime is breathing. Press Ctrl+C to stop.\n');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
