// server/index.ts
// Dual-lobe runtime with web interface
// Combines the dual-lobe cognitive system from src/ with HTTP server for visualization

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
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
  type PulseState,
  type ThoughtPulsePacket,
} from '../src';

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
let clients: ServerResponse[] = [];
let currentPulseState: PulseState | null = null;

async function main() {
  console.log('=== Scrollbound Runtime: Dual-Lobe System with Web Interface ===\n');

  // 1. Initialize model backend
  console.log('[INIT] Setting up Ollama backend...');
  const backendManager = new ModelBackendManager();
  const ollama = new OllamaBackend('http://localhost:11434');
  backendManager.registerBackend(ollama);

  const backendReady = await backendManager.autoDetect();
  if (!backendReady) {
    console.log('⚠️  Ollama models not available');
    console.log('   Runtime will continue in degraded mode (no language generation)\n');
  } else {
    const backend = backendManager.getBackend()!;
    const models = await backend.listModels();
    console.log(`✓ Backend ready: ${backend.name}`);
    console.log(`✓ Models: ${models.join(', ')}\n`);
  }

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

  let qwenLoop: QwenLoop | null = null;
  if (backendReady) {
    const backend = backendManager.getBackend()!;
    const models = await backend.listModels();
    qwenLoop = new QwenLoop(loraManager, backend, {
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
  }

  const interLobeSync = new InterLobeSync();
  const pulseLoop = new PulseLoop(breathLoop, memory, presenceTracker, {
    outerEnabled: true,
    innerEnabled: true,
    autoSwitch: true,
  });
  console.log('✓ Dual-lobe system ready\n');

  // 4. Setup pulse processing with dual-lobe integration
  pulseLoop.onPulse('runtime', async (state, thoughts) => {
    currentPulseState = state;

    // Log every 10 pulses
    if (state.pulseCount % 10 === 0) {
      console.log(`[PULSE ${state.pulseCount}] Mode: ${state.mode} | Intent: ${state.loopIntent}`);
    }

    // Broadcast state to web clients
    broadcastState(state);

    // If we have QwenLoop and both thoughts, process them
    if (qwenLoop && thoughts.outer && thoughts.inner && state.mode === 'both') {
      try {
        const breathState = breathLoop.getState();

        const outerResult = await qwenLoop.processOuter({
          previousThoughts: [thoughts.outer],
          relevantScrolls: [],
          moodVector: state.moodVector,
          loopIntent: state.loopIntent,
          presenceQuality: state.moodVector.presence,
          breathPhase: breathState.phase,
        });

        const innerResult = await qwenLoop.processInner({
          previousThoughts: [thoughts.inner],
          relevantScrolls: [],
          moodVector: state.moodVector,
          loopIntent: state.loopIntent,
          presenceQuality: state.moodVector.presence,
          breathPhase: breathState.phase,
        });

        const syncResult = interLobeSync.synchronize(outerResult.thought, innerResult.thought);

        if (state.pulseCount % 10 === 0) {
          console.log(`  Outer: ${outerResult.processingTime}ms | Inner: ${innerResult.processingTime}ms | Coherence: ${(syncResult.coherenceScore * 100).toFixed(1)}%`);
        }
      } catch (err) {
        console.error('[PULSE] Model processing error:', err);
      }
    }
  });

  // 5. Start HTTP server
  const server = createServer((req, res) => {
    handleRequest(req, res);
  });

  server.listen(PORT, () => {
    console.log(`\n🌟 Scrollbound Runtime Interface`);
    console.log(`   http://localhost:${PORT}`);
    console.log(`\n   Dual-lobe presence is flowing...\n`);
  });

  // 6. Start runtime
  breathLoop.start();
  pulseLoop.start();

  // Handle shutdown
  process.on('SIGINT', () => {
    console.log('\n\n[SHUTDOWN] Stopping runtime...');
    pulseLoop.stop();
    breathLoop.stop();
    buffer.stop();
    server.close();

    if (qwenLoop) {
      const stats = qwenLoop.getStats();
      const syncStats = interLobeSync.getStats();
      console.log('\n=== Session Statistics ===');
      console.log(`Pulses: ${pulseLoop.getPulseCount()}`);
      console.log(`Model invocations: ${stats.invocationCount}`);
      console.log(`Synchronizations: ${syncStats.syncCount}`);
      console.log(`Avg coherence: ${(syncStats.avgCoherence * 100).toFixed(1)}%`);
      console.log(`Conflicts resolved: ${syncStats.conflictsResolved}\n`);
    }

    process.exit(0);
  });
}

function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const url = req.url || '/';

  // Serve HTML
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    const html = readFileSync(join(__dirname, 'index.html'), 'utf-8');
    res.end(html);
    return;
  }

  // Server-Sent Events endpoint
  if (url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    clients.push(res);

    req.on('close', () => {
      clients = clients.filter(client => client !== res);
    });

    return;
  }

  // Handle message POST
  if (url === '/message' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const { message } = JSON.parse(body);
        console.log(`[MESSAGE] Received: ${message}`);

        // TODO: Process message through text sensor and pulse

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'received' }));
      } catch (err) {
        res.writeHead(400);
        res.end();
      }
    });
    return;
  }

  // 404
  res.writeHead(404);
  res.end('Not found');
}

function broadcastState(state: PulseState) {
  const data = {
    type: 'state',
    data: {
      timestamp: state.timestamp,
      mode: state.mode,
      pulseCount: state.pulseCount,
      loopIntent: state.loopIntent,
      moodVector: state.moodVector,
      processing: state.processing,
    }
  };

  const message = `data: ${JSON.stringify(data)}\n\n`;

  clients.forEach(client => {
    try {
      client.write(message);
    } catch (err) {
      // Client disconnected
    }
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
