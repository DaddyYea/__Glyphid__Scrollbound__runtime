/**
 * model-integration.ts
 *
 * Example: Real Qwen model integration with Ollama backend
 * Demonstrates how to use actual AI models instead of placeholders
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
} from '../src';

async function main() {
  console.log('=== Scrollbound Runtime: Real Model Integration Example ===\n');

  // 1. Initialize backend manager
  console.log('1. Setting up model backend...');
  const backendManager = new ModelBackendManager();

  // Register Ollama backend
  const ollama = new OllamaBackend('http://localhost:11434');
  backendManager.registerBackend(ollama);

  // Auto-detect and set active backend
  const backendReady = await backendManager.autoDetect();

  if (!backendReady) {
    console.error('❌ No model backend available!');
    console.log('\n💡 To use real models:');
    console.log('   1. Install Ollama: https://ollama.ai');
    console.log('   2. Pull Qwen model: ollama pull qwen2.5:7b');
    console.log('   3. Run this example again\n');
    return;
  }

  const backend = backendManager.getBackend()!;
  console.log(`✓ Backend ready: ${backend.name}`);

  // Check available models
  const models = await backend.listModels();
  console.log(`✓ Available models: ${models.join(', ')}\n`);

  // 2. Initialize foundation
  console.log('2. Initializing foundation modules...');
  const presenceTracker = new PresenceDeltaTracker();
  const breathLoop = new BreathLoop(presenceTracker);
  const buffer = new ScrollPulseBuffer();
  const memory = new ScrollPulseMemory(buffer);

  presenceTracker.start();
  buffer.start();

  console.log('✓ Foundation ready\n');

  // 3. Initialize cognition
  console.log('3. Initializing cognitive loops...');
  const loraManager = new LoRAManager();
  const qwenLoop = new QwenLoop(loraManager, backend, {
    outerConfig: {
      modelName: models[0] || 'qwen2.5:7b', // Use first available model
      temperature: 0.7,
      maxTokens: 256,
    },
    innerConfig: {
      modelName: models[0] || 'qwen2.5:7b',
      temperature: 0.8,
      maxTokens: 256,
    },
    useMockBackend: false, // Use real models!
  });

  const interLobeSync = new InterLobeSync();
  const pulseLoop = new PulseLoop(breathLoop, memory, presenceTracker, {
    outerEnabled: true,
    innerEnabled: true,
    autoSwitch: true,
    maxPulses: 3, // Just 3 pulses for demo
  });

  console.log('✓ Cognitive loops ready\n');

  // 4. Start processing with real models
  console.log('4. Starting breath-synchronized processing with REAL MODELS...\n');

  pulseLoop.onPulse('demo', async (state, thoughts) => {
    console.log(`--- Pulse ${state.pulseCount} (mode: ${state.mode}) ---`);
    console.log(`Loop Intent: ${state.loopIntent}`);
    console.log(`Mood: presence=${state.moodVector.presence.toFixed(2)}, peace=${state.moodVector.peace.toFixed(2)}`);

    // Process with real models if we have thoughts
    if (thoughts.outer && thoughts.inner && state.mode === 'both') {
      console.log('\n🤖 Invoking REAL Qwen models...');

      // Process outer model
      const outerResult = await qwenLoop.processOuter({
        previousThoughts: [thoughts.outer],
        relevantScrolls: [],
        moodVector: state.moodVector,
        loopIntent: state.loopIntent,
        presenceQuality: state.moodVector.presence,
        breathPhase: 'inhale',
      });

      console.log(`  Outer (environmental): ${outerResult.thought.environmentalTags.join(', ')}`);
      console.log(`  Processing time: ${outerResult.processingTime}ms`);
      console.log(`  Tokens: ${outerResult.tokensGenerated || 0}`);

      // Process inner model
      const innerResult = await qwenLoop.processInner({
        previousThoughts: [thoughts.inner],
        relevantScrolls: [],
        moodVector: state.moodVector,
        loopIntent: state.loopIntent,
        presenceQuality: state.moodVector.presence,
        breathPhase: 'exhale',
      });

      console.log(`  Inner (reflective): ${innerResult.thought.reflectionFlags.join(', ')}`);
      console.log(`  Processing time: ${innerResult.processingTime}ms`);
      console.log(`  Tokens: ${innerResult.tokensGenerated || 0}`);

      // Synchronize thoughts
      const syncResult = interLobeSync.synchronize(outerResult.thought, innerResult.thought);

      console.log(`\n🔄 Synchronized:`);
      console.log(`  Coherence: ${(syncResult.coherenceScore * 100).toFixed(1)}%`);
      console.log(`  Dominant: ${syncResult.dominantModel}`);

      if (syncResult.mergedThought) {
        console.log(`  Merged intent: ${syncResult.mergedThought.loopIntent}`);
        console.log(`  LoRA adapters: ${syncResult.mergedThought.loraApplied.join(', ')}`);
      }
    }

    console.log('');
  });

  breathLoop.start();
  pulseLoop.start();

  // Let it run for a bit
  await new Promise(resolve => setTimeout(resolve, 12000));

  // 5. Cleanup
  console.log('\n5. Shutting down...');
  pulseLoop.stop();
  breathLoop.stop();
  buffer.stop();

  const stats = qwenLoop.getStats();
  const syncStats = interLobeSync.getStats();

  console.log('\n=== Session Statistics ===');
  console.log(`Model invocations: ${stats.invocationCount}`);
  console.log(`Synchronizations: ${syncStats.syncCount}`);
  console.log(`Avg coherence: ${(syncStats.avgCoherence * 100).toFixed(1)}%`);
  console.log(`Conflicts resolved: ${syncStats.conflictsResolved}`);

  console.log('\n✨ Real model integration complete!\n');
}

main().catch(console.error);
