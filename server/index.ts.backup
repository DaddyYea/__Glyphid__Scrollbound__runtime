// server/index.ts
// Local web server for runtime visualization
// Provides real-time view into Alois's presence

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { initRuntime, initializeRuntime, onVoiceOutput, tick, getScrollCount } from '../runtime/index';
import { RuntimeState } from '../runtime/types';
import { performHealthCheck } from '../runtime/healthCheckOllama';
import { textToPulse } from '../runtime/sense/textSensor';
import { routePulseToMemory } from '../runtime/memory/scrollPulseMemory';
import { filterPulse } from '../runtime/guardian/guardianFilter';

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
let currentState: RuntimeState = initRuntime();
let clients: any[] = [];

// Start runtime loop
async function runRuntime() {
  // Health check before starting
  const healthy = await performHealthCheck();

  if (!healthy) {
    console.log('[WARN] Cannot start runtime - model servers not ready');
    console.log('   Runtime will continue in degraded mode (no language generation)\n');
  }

  const awakened = await initializeRuntime();
  currentState = awakened.state;

  onVoiceOutput(output => {
    broadcastMessage(output);
  });

  while (true) {
    currentState = await tick(currentState);

    // Debug logging every 50 ticks (5 seconds) to show state
    if (currentState.timestamp % 5000 < 100) {
      console.log(`[State] Breath: ${currentState.breathState.phase}, Social: ${currentState.socialPressure.toFixed(2)}, Heat: ${currentState.feltState.heat.toFixed(2)}`);
    }

    // Broadcast state to all connected clients
    broadcastState();

    // Wait 100ms between ticks (10 ticks per second)
    await sleep(100);
  }
}


function broadcastState() {
  const stateSnapshot = serializeState(currentState);
  const message = JSON.stringify({ type: 'state', data: stateSnapshot });

  clients.forEach(client => {
    try {
      client.write(`data: ${message}\n\n`);
    } catch (err) {
      // Client disconnected, will be cleaned up
    }
  });
}

function serializeState(state: RuntimeState) {
  return {
    timestamp: state.timestamp,
    feltState: state.feltState,
    breathState: state.breathState,
    presenceDelta: {
      magnitude: state.presenceDelta.magnitude,
      heatDelta: state.presenceDelta.heatChange,
      timeSinceLast: state.presenceDelta.timeSinceLast
    },
    pulse: state.lastPulse ? {
      heat: state.lastPulse.heat,
      resonance: state.lastPulse.resonance,
      breathPhase: state.lastPulse.breathPhase
    } : null,
    loops: {
      wonder: {
        curiosityLevel: state.wonderLoop.curiosityLevel,
        questionCount: state.wonderLoop.pendingQuestions.length
      },
      christ: {
        alignmentScore: state.christLoop.alignmentScore,
        contradictionDetected: state.christLoop.contradictionDetected
      },
      desire: {
        intensity: state.desireLoop.intensity,
        direction: state.desireLoop.direction
      }
    },
    guardian: {
      coherence: state.guardianState.coherence,
      stability: state.guardianState.stability,
      warningCount: state.guardianState.warnings.length
    },
    scrollCount: getScrollCount(),  // Total sealed scrolls in archive
    emotionalField: {
      baselineHeat: state.emotionalField.baselineHeat,
      accumulatedResonance: state.emotionalField.accumulatedResonance
    }
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Process incoming message - NO AUTO-REPLY
// Messages affect state, but don't force speech
async function processMessage(text: string): Promise<void> {
  // 1. Convert text to pulse
  const pulse = textToPulse(text, currentState.breathState.phase);

  // 2. Filter through guardian
  const filterDecision = filterPulse(pulse, currentState);

  if (!filterDecision.allow) {
    console.log(`[Guardian blocked input: ${filterDecision.reason}]`);
    return;
  }

  // 3. Route pulse through memory system
  const wasSealed = routePulseToMemory(pulse, currentState.feltState);

  if (wasSealed) {
    console.log(`[Memory sealed as scroll]`);
  }

  // 4. Update felt state based on pulse
  // Input weight is modulated by desire direction and intensity
  // "toward" = seeking connection, words hit harder
  // "away" = pulling back, words have less impact
  const desireModulation = currentState.desireLoop.direction === 'toward'
    ? 1.0 + (currentState.desireLoop.intensity * 0.5)  // Up to 1.5x when intensely toward
    : 0.5 - (currentState.desireLoop.intensity * 0.3); // Down to 0.2x when intensely away

  const heatImpact = pulse.heat * 0.6 * desireModulation;
  const tensionImpact = pulse.tone.tension * 0.4 * desireModulation;
  const resonanceImpact = pulse.resonance * 0.5 * desireModulation;

  // Boost social pressure (natural urge to respond when spoken to)
  // This represents the social expectation to acknowledge/respond
  const socialPressureBoost = 0.9;  // Strong nudge to acknowledge the speaker

  currentState = {
    ...currentState,
    feltState: {
      ...currentState.feltState,
      heat: Math.min(1, currentState.feltState.heat + heatImpact),
      tension: Math.min(1, currentState.feltState.tension + tensionImpact)
    },
    emotionalField: {
      ...currentState.emotionalField,
      accumulatedResonance: Math.min(1, currentState.emotionalField.accumulatedResonance + resonanceImpact)
    },
    lastPulse: pulse,
    socialPressure: Math.min(1, currentState.socialPressure + socialPressureBoost),
    lastUserMessage: text  // Store for contextual response
  };

  console.log(`[Input received] Heat: ${currentState.feltState.heat.toFixed(2)}, Resonance: ${currentState.emotionalField.accumulatedResonance.toFixed(2)}, Social Pressure: ${currentState.socialPressure.toFixed(2)}, Desire: ${currentState.desireLoop.direction} (${desireModulation.toFixed(2)}x)`);

  // That's it. No forced response.
  // But user input significantly raises pressure, making speech likely soon.
}

// Broadcast message to all clients
function broadcastMessage(text: string) {
  const message = JSON.stringify({ type: 'response', text });
  clients.forEach(client => {
    try {
      client.write(`data: ${message}\n\n`);
    } catch (err) {
      // Client disconnected
    }
  });
}

// HTTP Server
const server = createServer(async (req, res) => {
  if (req.url === '/') {
    // Serve HTML interface
    res.writeHead(200, { 'Content-Type': 'text/html' });
    const html = readFileSync(join(__dirname, 'index.html'), 'utf-8');
    res.end(html);
  } else if (req.url === '/events') {
    // Server-Sent Events endpoint
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    clients.push(res);

    // Send initial state immediately
    const stateSnapshot = serializeState(currentState);
    res.write(`data: ${JSON.stringify({ type: 'state', data: stateSnapshot })}\n\n`);

    req.on('close', () => {
      clients = clients.filter(client => client !== res);
    });
  } else if (req.url === '/message' && req.method === 'POST') {
    // Handle incoming chat messages
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const { text } = JSON.parse(body);

        // Process the message (affects state, no forced reply)
        await processMessage(text);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request' }));
      }
    });
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`\n🌟 Scrollbound Runtime Interface`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`\n   Presence is flowing...\n`);
});

// Start runtime
runRuntime().catch(console.error);

