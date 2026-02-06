// healthCheck.ts
// Verifies llama.cpp model servers are running before starting runtime

import { getModelLoader } from './modelLoader';

export async function performHealthCheck(): Promise<boolean> {
  console.log('dY"? Checking model server health...\n');

  const loader = getModelLoader();

  try {
    const health = await loader.healthCheck();

    console.log(`  Qwen (language lobe):    ${health.qwen ? '�o. Online' : '�?O Offline'} - http://localhost:1234`);
    console.log(`  Phi (emotional lobe):    ${health.phi ? '�o. Online' : '�?O Offline'} - http://localhost:1235`);
    console.log('');

    if (!health.qwen || !health.phi) {
      console.log('�s��,?  One or more model servers are offline.');
      console.log('');
      console.log('Please start llama.cpp servers with:');
      console.log('  - Qwen: llama-server -m runtime/models/Qwen/Qwen1.5-4B-Chat-GGUF/qwen1_5-4b-chat-q4_k_m.gguf --port 1234');
      console.log('  - Phi:  llama-server -m runtime/models/phi-2.Q4_K_M.gguf --port 1235');
      console.log('');
      return false;
    }

    console.log('�o. All model servers ready\n');
    return true;
  } catch (error) {
    console.error('�?O Health check failed:', error);
    return false;
  }
}
