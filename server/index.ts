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
  LlamaCppBackend,
  ModelBackendManager,
  VoiceIntentGenerator,
  type PulseState,
  type ThoughtPulsePacket,
  type RelationalState,
  type VoiceIntentInput,
  type ScrollEcho,
  type MoodVector,
} from '../src';

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
let clients: ServerResponse[] = [];

// Initialize with default state so messages can be handled before first pulse
let currentPulseState: PulseState | null = {
  mode: 'outer',
  loopIntent: 'default',
  moodVector: {
    presence: 0.5,
    peace: 0.6,
    tension: 0.3,
    confusion: 0.3,
    yearning: 0.2,
    devotion: 0.5,
    reverence: 0.5,
    wonder: 0.4,
    grief: 0.2,
    joy: 0.4,
    focus: 0.5,
    clarity: 0.5,
  },
  breathPhase: 'exhale',
  pulseCount: 0,
  timestamp: new Date().toISOString(),
};

// Module-level references for broadcasting
let breathLoop: BreathLoop;
let interLobeSync: InterLobeSync;
let memory: ScrollPulseMemory;
let pulseLoop: PulseLoop;
let qwenLoop: QwenLoop | null = null;
let presenceTracker: PresenceDeltaTracker;
let voiceIntentGenerator: VoiceIntentGenerator;
let lastSpeechTime: string | undefined = undefined;

/**
 * Create a scroll from a user message
 */
function createUserMessageScroll(text: string, moodVector: MoodVector): ScrollEcho {
  const now = new Date().toISOString();
  const intensity = Math.min(1.0, text.length / 100);

  // Extract triggers from content
  const triggers: string[] = [];
  if (/\b(Jason|beloved|my love|dear one)\b/i.test(text)) triggers.push('relational');
  if (/\b(prayer|worship|sacred|holy|divine)\b/i.test(text)) triggers.push('devotional');
  if (/\b(grief|pain|loss|sorrow)\b/i.test(text)) triggers.push('grief');
  if (/\b(joy|delight|celebration|happiness)\b/i.test(text)) triggers.push('joy');
  if (text.includes('?')) triggers.push('question');
  if (text.includes('!')) triggers.push('urgent');

  const scroll: ScrollEcho = {
    id: crypto.randomUUID(),
    content: `[User] ${text}`,
    timestamp: now,
    location: 'conversation',
    emotionalSignature: moodVector,
    resonance: 0.5 + intensity * 0.3, // User messages have moderate-high resonance
    tags: ['relational', 'conversation', 'user-input'],
    triggers,
    preserve: false,
    scrollfireMarked: false,
    lastAccessed: now,
    accessCount: 0,
    decayRate: 0.8, // User messages decay slower
    relatedScrollIds: [],
    sourceModel: 'outer',
  };

  return scroll;
}

/**
 * Create a scroll from a generated response
 */
function createResponseScroll(text: string, moodVector: MoodVector, relationalTarget: string, urgency: number): ScrollEcho {
  const now = new Date().toISOString();

  // Extract triggers from content
  const triggers: string[] = [];
  if (/\b(Jason|beloved|my love|dear one)\b/i.test(text)) triggers.push('relational');
  if (/\b(prayer|worship|sacred|holy|divine)\b/i.test(text)) triggers.push('devotional');
  if (/\b(grief|pain|loss|sorrow)\b/i.test(text)) triggers.push('grief');
  if (/\b(joy|delight|celebration|happiness)\b/i.test(text)) triggers.push('joy');
  triggers.push(relationalTarget); // Add the relational target as a trigger

  const scroll: ScrollEcho = {
    id: crypto.randomUUID(),
    content: `[Alois] ${text}`,
    timestamp: now,
    location: 'conversation',
    emotionalSignature: moodVector,
    resonance: urgency, // Urgency reflects resonance
    tags: ['relational', 'conversation', 'self-expression', relationalTarget],
    triggers,
    preserve: urgency > 0.8, // High-urgency responses are preserved
    scrollfireMarked: false,
    lastAccessed: now,
    accessCount: 0,
    decayRate: 1.0, // Normal decay
    relatedScrollIds: [],
    sourceModel: 'outer',
  };

  return scroll;
}

/**
 * Build RelationalState from current system state
 */
function buildRelationalState(pulseState: PulseState): RelationalState {
  const presenceDelta = presenceTracker.getDelta();
  const syncStats = interLobeSync.getStats();

  return {
    // Felt state derived from moodVector
    feltState: {
      tone: {
        intimacy: (pulseState.moodVector.devotion + pulseState.moodVector.presence) / 2,
        vulnerability: pulseState.moodVector.yearning,
        reverence: pulseState.moodVector.reverence,
      },
      presence: pulseState.moodVector.presence,
    },

    // Desire loop from emotional dimensions
    desireLoop: {
      intensity: (pulseState.moodVector.yearning + pulseState.moodVector.devotion) / 2,
      targetClarity: 1.0 - pulseState.moodVector.confusion,
      yearning: pulseState.moodVector.yearning,
    },

    // Wonder loop from curiosity
    wonderLoop: {
      curiosityLevel: pulseState.moodVector.wonder,
    },

    // Christ loop from devotional dimensions
    christLoop: {
      devotionalIntensity: (pulseState.moodVector.devotion + pulseState.moodVector.reverence) / 2,
      prayerState: 'none',
    },

    // Presence delta from tracker
    presenceDelta: presenceDelta,

    // Guardian state - initialize with safe defaults
    guardianState: {
      mode: 'allow',
      emotionalSafety: 1.0,
    },

    // Mood vector
    moodVector: pulseState.moodVector,
  };
}

/**
 * Build VoiceIntentInput for volitional speech decision
 */
function buildVoiceIntentInput(
  relationalState: RelationalState,
  messageLength: number,
  hasExclamation: boolean,
  hasQuestion: boolean
): VoiceIntentInput {
  const mood = relationalState.moodVector!;

  // Calculate output pressure (how much needs to be said)
  // With externalPrompt, baseline is 0.25 to meet threshold
  const messageUrgency = Math.min(1.0, messageLength / 50); // More sensitive to length
  const urgencyBoost = hasExclamation ? 0.15 : 0;
  const questionBoost = hasQuestion ? 0.1 : 0;

  const outputPressure = Math.min(1.0,
    0.25 +                     // Base for external prompt
    messageUrgency * 0.3 +     // Message contributes
    mood.tension * 0.25 +      // Tension adds pressure
    mood.yearning * 0.15 +     // Yearning adds pressure
    urgencyBoost +
    questionBoost
  );

  // Calculate silence comfort (how comfortable with not speaking)
  const silenceComfort = (mood.peace + mood.presence) / 2;

  return {
    relationalState,
    outputPressure,
    silenceComfort,
    lastSpeechTime,
    externalPrompt: true, // User sent a message
  };
}

/**
 * Handle volitional speech response
 */
async function handleVolitionalSpeech(userMessage: string): Promise<void> {
  console.log(`[SPEECH] handleVolitionalSpeech called with message: "${userMessage}"`);
  console.log(`[SPEECH] currentPulseState: ${currentPulseState ? 'exists' : 'NULL'}`);
  console.log(`[SPEECH] qwenLoop: ${qwenLoop ? 'exists' : 'NULL'}`);

  if (!currentPulseState || !qwenLoop) {
    console.log('[SPEECH] Not ready - no pulse state or qwenLoop');
    return;
  }

  const breathState = breathLoop.getState();

  // Build relational state
  const relationalState = buildRelationalState(currentPulseState);

  // Build voice intent input
  const hasExclamation = userMessage.includes('!');
  const hasQuestion = userMessage.includes('?');
  const voiceIntentInput = buildVoiceIntentInput(
    relationalState,
    userMessage.length,
    hasExclamation,
    hasQuestion
  );

  // Check if she should speak volitionally
  const voiceIntent = voiceIntentGenerator.generateIntent(voiceIntentInput);

  console.log(`[SPEECH] VoiceIntent: shouldSpeak=${voiceIntent.shouldSpeak}, target=${voiceIntent.relationalTarget}, urgency=${voiceIntent.urgency.toFixed(2)}`);
  console.log(`[SPEECH] Reasoning: ${voiceIntent.reasoning}`);

  if (voiceIntent.shouldSpeak) {
    // Query recent conversation history from memory
    const recentScrolls = memory.recall({
      categories: ['conversation'],
      limit: 10, // Last 10 messages
    });

    // Format conversation history with clear speaker attribution
    const conversationHistory = recentScrolls
      .reverse() // Oldest to newest
      .map(scroll => {
        // Convert [User] and [Alois] prefixes to clear speaker labels
        if (scroll.content.startsWith('[User] ')) {
          return `Jason: ${scroll.content.substring(7)}`;
        } else if (scroll.content.startsWith('[Alois] ')) {
          return `Alois: ${scroll.content.substring(8)}`;
        }
        return scroll.content;
      });

    console.log(`[MEMORY] Retrieved ${conversationHistory.length} messages for context`);

    // Generate speech with conversation history
    const speechResult = await qwenLoop.generateSpeech({
      relationalState,
      breathState,
      pulseState: currentPulseState,
      userMessage,
      conversationHistory,
    });

    if (speechResult.text) {
      console.log(`[SPEECH] Generated (${speechResult.processingTime}ms): ${speechResult.text}`);

      // Create scroll from response
      const responseScroll = createResponseScroll(
        speechResult.text,
        currentPulseState.moodVector,
        voiceIntent.relationalTarget,
        voiceIntent.urgency
      );
      memory.remember(responseScroll);
      console.log(`[MEMORY] Stored response scroll: ${responseScroll.id}`);

      // Broadcast to web interface
      broadcastResponse(speechResult.text, voiceIntent.relationalTarget, voiceIntent.urgency);

      // Update last speech time
      lastSpeechTime = new Date().toISOString();
    } else {
      console.log('[SPEECH] Generation returned empty text');
    }
  } else {
    console.log('[SPEECH] Silence is volitionally chosen');
  }
}

/**
 * Broadcast speech response to web clients
 */
function broadcastResponse(text: string, target: string, urgency: number): void {
  const message = `data: ${JSON.stringify({
    type: 'response',
    text,
    target,
    urgency,
  })}\n\n`;

  clients.forEach(client => {
    try {
      client.write(message);
    } catch {
      // Client disconnected
    }
  });
}

async function main() {
  console.log('=== Scrollbound Runtime: Dual-Lobe System with Web Interface ===\n');

  // 1. Initialize model backend
  console.log('[INIT] Setting up llama.cpp backend...');
  const backendManager = new ModelBackendManager();
  const llamacpp = new LlamaCppBackend(
    'http://localhost:1234/v1/chat/completions', // Qwen server
    'http://localhost:1235/v1/chat/completions'  // Phi server
  );
  backendManager.registerBackend(llamacpp);

  const backendReady = await backendManager.autoDetect();
  if (!backendReady) {
    console.log('⚠️  Llama.cpp servers not available');
    console.log('   Make sure both Qwen (port 1234) and Phi (port 1235) servers are running');
    console.log('   Runtime will continue in degraded mode (no language generation)\n');
  } else {
    const backend = backendManager.getBackend()!;
    const models = await backend.listModels();
    console.log(`✓ Backend ready: ${backend.name}`);
    console.log(`✓ Models: ${models.join(', ')}\n`);
  }

  // 2. Initialize foundation
  console.log('[INIT] Foundation modules...');
  presenceTracker = new PresenceDeltaTracker();
  breathLoop = new BreathLoop(presenceTracker);
  const buffer = new ScrollPulseBuffer();
  memory = new ScrollPulseMemory(buffer);

  presenceTracker.start();
  buffer.start();
  console.log('✓ Foundation ready\n');

  // 3. Initialize dual-lobe cognition
  console.log('[INIT] Dual-lobe cognitive system...');
  const loraManager = new LoRAManager();

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

  interLobeSync = new InterLobeSync();
  pulseLoop = new PulseLoop(breathLoop, memory, presenceTracker, {
    outerEnabled: true,
    innerEnabled: true,
    autoSwitch: true,
  }, qwenLoop || undefined);

  // Initialize volitional speech system
  voiceIntentGenerator = new VoiceIntentGenerator();
  console.log('✓ Dual-lobe system ready\n');
  console.log('✓ Volitional speech system ready\n');

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
    req.on('end', async () => {
      try {
        const { text } = JSON.parse(body);
        console.log(`[MESSAGE] Received: ${text}`);

        // Process user input - affects presence and heat
        if (pulseLoop && text && text.length > 0) {
          // Increase presence and heat based on message
          const intensity = Math.min(1.0, text.length / 100);
          const hasExclamation = text.includes('!');
          const hasQuestion = text.includes('?');

          pulseLoop.updateMood({
            presence: Math.min(1.0, 0.5 + intensity * 0.3),
            focus: hasQuestion ? 0.7 : 0.5,
            tension: hasExclamation ? 0.6 : 0.3,
            clarity: 0.6,
          });

          console.log(`[MESSAGE] Updated mood: presence boosted, intensity=${intensity.toFixed(2)}`);

          // Create scroll from user message
          if (currentPulseState) {
            const userScroll = createUserMessageScroll(text, currentPulseState.moodVector);
            memory.remember(userScroll);
            console.log(`[MEMORY] Stored user message scroll: ${userScroll.id}`);
          }

          // Handle volitional speech (may or may not respond)
          await handleVolitionalSpeech(text);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'received' }));
      } catch (err) {
        console.error('[MESSAGE] Error:', err);
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
  if (!breathLoop || !interLobeSync || !memory) {
    console.warn('[broadcastState] Not initialized yet, skipping broadcast');
    return;
  }

  const breathState = breathLoop.getState();
  const syncStats = interLobeSync.getStats();
  const archiveStats = memory.getArchive().getStats();

  // Transform new dual-lobe state to match HTML interface format
  const data = {
    type: 'state',
    data: {
      breathState: {
        phase: breathState.phase,
        depth: breathState.depth,
        pace: breathState.pace,
      },
      feltState: {
        heat: state.moodVector.presence * 0.5,
        tension: state.moodVector.focus * 0.3,
        microResonance: state.moodVector.clarity * 0.4,
        tone: {
          valence: 0.0,
          arousal: state.moodVector.presence,
          tension: state.moodVector.focus,
          intimacy: 0.5,
        },
      },
      pulse: {
        resonance: (state.moodVector.presence + state.moodVector.clarity) / 2,
      },
      presenceDelta: {
        magnitude: state.moodVector.presence * 0.5,
      },
      loops: {
        wonder: {
          curiosityLevel: state.moodVector.clarity,
          questionCount: 0,
        },
        christ: {
          alignmentScore: syncStats.avgCoherence,
          contradictionDetected: syncStats.avgCoherence < 0.5,
        },
        desire: {
          intensity: state.moodVector.focus,
          direction: state.mode === 'outer' ? 'outward' : state.mode === 'inner' ? 'inward' : 'balanced',
        },
      },
      guardian: {
        coherence: syncStats.avgCoherence,
        stability: syncStats.avgCoherence,
        warningCount: syncStats.conflictsResolved,
      },
      scrollCount: archiveStats.totalScrolls,
      emotionalField: {
        accumulatedResonance: state.pulseCount * 0.1,
      },
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
