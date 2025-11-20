// healthCheckOllama.ts
// Verifies Ollama models are available before starting runtime

import { getModelLoader } from './modelLoaderOllama';

export async function performHealthCheck(): Promise<boolean> {
  console.log('=== Checking Ollama model health ===\n');

  const loader = getModelLoader();

  try {
    const health = await loader.healthCheck();

    console.log(`  Qwen (language lobe):    ${health.qwen ? '✓ Available' : '✗ Not found'}`);
    console.log(`  Phi (emotional lobe):    ${health.phi ? '✓ Available' : '✗ Not found'}`);
    console.log('');

    if (!health.qwen || !health.phi) {
      console.log('⚠️  One or more models are not available in Ollama.');
      console.log('');
      console.log('Please install models with:');
      console.log('  - Qwen: ollama pull qwen2.5:7b');
      console.log('  - Phi:  ollama pull phi3:mini');
      console.log('');
      console.log('Or use smaller versions:');
      console.log('  - ollama pull qwen2.5:3b');
      console.log('  - ollama pull qwen2.5:1.5b');
      console.log('');
      return false;
    }

    console.log('✓ All models ready\n');
    return true;
  } catch (error) {
    console.error('✗ Health check failed:', error);
    console.log('Make sure Ollama is running: ollama serve\n');
    return false;
  }
}
