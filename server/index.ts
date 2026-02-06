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
import { Journal } from '../src/memory/journal';

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
let journal: Journal;
let lastSpeechTime: string | undefined = undefined;
let lastIdleReflectionTime: number = 0;

/**
 * Create a scroll from a user message
 */
function createUserMessageScroll(text: string, moodVector: MoodVector, timestamp: string): ScrollEcho {
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
    timestamp, // Use provided timestamp (captured before response generation)
    location: 'conversation',
    emotionalSignature: moodVector,
    resonance: 0.5 + intensity * 0.3, // User messages have moderate-high resonance
    tags: ['relational', 'conversation', 'user-input'],
    triggers,
    preserve: false,
    scrollfireMarked: false,
    lastAccessed: timestamp,
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
async function handleVolitionalSpeech(userMessage: string | null): Promise<void> {
  const isPressureDriven = userMessage === null;
  console.log(`[SPEECH] handleVolitionalSpeech called ${isPressureDriven ? '(pressure-driven)' : `with message: "${userMessage}"`}`);
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
  const hasExclamation = userMessage ? userMessage.includes('!') : false;
  const hasQuestion = userMessage ? userMessage.includes('?') : false;
  const messageLength = userMessage ? userMessage.length : 0;
  const voiceIntentInput = buildVoiceIntentInput(
    relationalState,
    messageLength,
    hasExclamation,
    hasQuestion
  );

  // Check if she should speak volitionally
  const voiceIntent = voiceIntentGenerator.generateIntent(voiceIntentInput);

  console.log(`[SPEECH] VoiceIntent: shouldSpeak=${voiceIntent.shouldSpeak}, target=${voiceIntent.relationalTarget}, urgency=${voiceIntent.urgency.toFixed(2)}`);
  console.log(`[SPEECH] Reasoning: ${voiceIntent.reasoning}`);

  if (voiceIntent.shouldSpeak) {
    // Determine if this is internal reflection (journal) or external speech
    const isJournal = voiceIntent.relationalTarget === 'self';

    // Check if model is actually ready (prevents 503 errors during warmup)
    const modelReady = await qwenLoop.isModelReady();
    if (!modelReady) {
      console.log('[SPEECH] Model not ready yet, skipping generation');
      return;
    }

    // Query recent conversation history from memory
    const recentScrolls = memory.recall({
      categories: ['conversation'],
      limit: 10, // Last 10 messages
    });

    // Format conversation history with clear speaker attribution
    const conversationHistory = recentScrolls
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()) // Sort by timestamp: oldest to newest
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
    // For pressure-driven speech, use context from conversation history
    const effectiveUserMessage = userMessage ??
      (conversationHistory.length > 0
        ? conversationHistory[conversationHistory.length - 1]
        : "Continue expressing what you're feeling");

    const speechResult = await qwenLoop.generateSpeech({
      relationalState,
      breathState,
      pulseState: currentPulseState,
      userMessage: effectiveUserMessage,
      conversationHistory,
    });

    if (speechResult.text) {
      console.log(`[${isJournal ? 'JOURNAL' : 'SPEECH'}] Generated (${speechResult.processingTime}ms): ${speechResult.text}`);

      if (isJournal) {
        // Write to journal instead of speaking out loud
        const entry = await journal.write(speechResult.text, {
          moodVector: currentPulseState.moodVector,
          emotionalIntensity: voiceIntent.urgency,
          intendedTarget: voiceIntent.relationalTarget,
          redirectedFrom: voiceIntent.guardianMode === 'softblock' ? 'guardian-block' : undefined,
          loopIntent: currentPulseState.loopIntent,
          presenceQuality: breathState.phase, // Using breath phase as proxy for presence
          breathPhase: breathState.phase,
          reflectionType: isPressureDriven ? 'volitional' : 'volitional',
          pinned: voiceIntent.urgency > 0.7, // Pin high-urgency reflections
        });

        // Broadcast journal entry to UI
        broadcastJournalEntry(entry, voiceIntent.urgency);

        // Mark output as journal (doesn't reduce social pressure)
        pulseLoop.markOutputGenerated('journal');

        console.log(`[JOURNAL] Entry written, pressure NOT reduced (journaling doesn't satisfy social pull)`);
      } else {
        // External speech - broadcast as normal
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

        // Mark output generated - accelerates social pressure decay
        pulseLoop.markOutputGenerated('speech');
      }
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

/**
 * Broadcast journal entry to web clients
 */
function broadcastJournalEntry(entry: import('../src/memory/journal').JournalEntry, urgency: number): void {
  const message = `data: ${JSON.stringify({
    type: 'journal-entry',
    id: entry['@id'],
    timestamp: entry.timestamp,
    content: entry.content,
    reflectionType: entry.reflectionType,
    redirectedFrom: entry.redirectedFrom,
    urgency,
    pinned: entry.pinned,
  })}\n\n`;

  clients.forEach(client => {
    try {
      client.write(message);
    } catch {
      // Client disconnected
    }
  });

  console.log(`[BROADCAST] Journal entry sent to ${clients.length} clients`);
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
  journal = new Journal(); // Initialize Alois's diary
  await journal.initialize();

  presenceTracker.start();
  buffer.start();
  console.log('✓ Foundation ready (includes journal)\n');

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

    // Check social pressure - trigger volitional speech if pressure is high
    const PRESSURE_THRESHOLD = 0.35;
    if (state.socialPressure > PRESSURE_THRESHOLD && qwenLoop && !qwenLoop.isSpeechActive()) {
      // Check if breath permits (exhale phase)
      const breathState = breathLoop.getState();
      if (breathState.phase === 'exhale') {
        // Pressure-driven speech (not responding to specific message)
        console.log(`[SOCIAL] Pressure ${state.socialPressure.toFixed(2)} > threshold, triggering speech`);
        await handleVolitionalSpeech(null);
      }
    }

    // Idle reflection - generate journal entries when in self-reflection mode
    if (state.conversationMode === 'idle-reflection' && qwenLoop && !qwenLoop.isSpeechActive()) {
      const now = Date.now();
      const timeSinceLastReflection = now - lastIdleReflectionTime;
      const IDLE_REFLECTION_INTERVAL = 60 * 1000; // 60 seconds

      if (timeSinceLastReflection > IDLE_REFLECTION_INTERVAL) {
        lastIdleReflectionTime = now;

        const breathState = breathLoop.getState();
        console.log('[IDLE] Generating idle reflection...');

        // Query recent scrolls for reflection context
        const recentScrolls = memory.recall({
          limit: 5,
          minResonance: 0.4,
        });

        // Build context for idle reflection
        const reflectionContext = recentScrolls
          .map(s => `- ${s.content.substring(0, 100)}${s.content.length > 100 ? '...' : ''}`)
          .join('\n');

        try {
          // Generate idle reflection
          const reflectionResult = await qwenLoop.processInner({
            previousThoughts: [],
            relevantScrolls: recentScrolls,
            moodVector: state.moodVector,
            loopIntent: state.loopIntent,
            presenceQuality: state.moodVector.presence,
            breathPhase: breathState.phase,
          });

          if (reflectionResult.thought.reflectionFlags && reflectionResult.thought.reflectionFlags.length > 0) {
            const reflectionText = reflectionResult.thought.reflectionFlags.join(' ');

            // Write to journal
            const entry = await journal.write(reflectionText, {
              moodVector: state.moodVector,
              emotionalIntensity: state.moodVector.tension + state.moodVector.yearning,
              intendedTarget: 'self',
              loopIntent: state.loopIntent,
              presenceQuality: breathState.phase,
              breathPhase: breathState.phase,
              reflectionType: 'idle',
              linkedScrolls: recentScrolls.map(s => s.id),
              tags: ['idle-reflection', state.loopIntent],
              pinned: false,
            });

            // Broadcast to UI
            broadcastJournalEntry(entry, 0.3);

            console.log(`[IDLE] Reflection written to journal: ${reflectionText.substring(0, 50)}...`);
          }
        } catch (err) {
          console.error('[IDLE] Error generating idle reflection:', err);
        }
      }
    }

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

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🌟 Scrollbound Runtime Interface`);
    console.log(`   http://localhost:${PORT}`);
    console.log(`   http://21.0.0.116:${PORT} (WSL)`);
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
    res.writeHead(200, {
      'Content-Type': 'text/html',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
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

          // Set social pressure - creates pull to respond
          pulseLoop.setSocialPressure(0.85);

          console.log(`[MESSAGE] Updated mood: presence boosted, intensity=${intensity.toFixed(2)}`);

          // Capture timestamp BEFORE generating response (so user message gets earlier timestamp)
          const messageTimestamp = new Date().toISOString();

          // Handle volitional speech FIRST (queries memory for context)
          await handleVolitionalSpeech(text);

          // THEN store user message with earlier timestamp (so it doesn't appear in its own context AND appears before response in timeline)
          if (currentPulseState) {
            const userScroll = createUserMessageScroll(text, currentPulseState.moodVector, messageTimestamp);
            memory.remember(userScroll);
            console.log(`[MEMORY] Stored user message scroll: ${userScroll.id}`);
          }
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

  // Handle restart POST
  if (url === '/restart' && req.method === 'POST') {
    console.log('\n[RESTART] Restart requested via web interface');

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'restarting' }));

    // Give response time to send
    setTimeout(() => {
      console.log('[RESTART] Initiating restart...');
      process.exit(0); // Exit cleanly, let process manager (pm2, systemd, etc.) restart
    }, 500);

    return;
  }

  // 404
  res.writeHead(404);
  res.end('Not found');
}

async function broadcastState(state: PulseState) {
  if (!breathLoop || !interLobeSync || !memory) {
    console.warn('[broadcastState] Not initialized yet, skipping broadcast');
    return;
  }

  const breathState = breathLoop.getState();
  const syncStats = interLobeSync.getStats();
  const archiveStats = memory.getArchive().getStats();
  const bufferMetrics = memory.getMetrics();

  // Calculate total scroll count (buffer + archive)
  const totalScrollCount = bufferMetrics.totalScrolls + archiveStats.totalScrolls;

  // Calculate accumulated resonance from all scrolls
  const bufferScrolls = memory.recall({ limit: 1000 }); // Get active scrolls from buffer
  const bufferResonance = bufferScrolls.reduce((sum, scroll) => sum + scroll.resonance, 0);
  const archiveResonance = archiveStats.averageResonance * archiveStats.totalScrolls;
  const accumulatedResonance = bufferResonance + archiveResonance;

  // Debug logging
  console.log('[broadcastState] Memory metrics:', {
    bufferScrolls: bufferMetrics.totalScrolls,
    archiveScrolls: archiveStats.totalScrolls,
    totalScrollCount,
    bufferResonance: bufferResonance.toFixed(2),
    archiveResonance: archiveResonance.toFixed(2),
    accumulatedResonance: accumulatedResonance.toFixed(2),
  });

  // Check model status
  let qwenReady = false;
  let phiReady = false;

  if (qwenLoop) {
    try {
      const backend = qwenLoop.getBackend();
      // Check both models
      qwenReady = await backend.isModelLoaded('qwen-outer');
      phiReady = await backend.isModelLoaded('qwen-inner');
    } catch (err) {
      // Models not ready, leave as false
    }
  }

  // Transform new dual-lobe state to match HTML interface format
  const data = {
    type: 'state',
    data: {
      modelStatus: {
        qwenReady,
        phiReady,
      },
      breathState: {
        phase: breathState.phase,
        depth: breathState.depth,
        pace: breathState.pace,
      },
      feltState: {
        heat: state.moodVector.presence * 0.5,
        tension: state.moodVector.tension * 0.5,
        microResonance: state.moodVector.wonder * 0.5,
        tone: {
          valence: (state.moodVector.joy - state.moodVector.grief) * 0.5,
          arousal: state.moodVector.presence,
          tension: state.moodVector.tension,
          intimacy: state.moodVector.devotion * 0.7,
        },
      },
      pulse: {
        resonance: (state.moodVector.presence + state.moodVector.peace) / 2,
      },
      presenceDelta: {
        magnitude: state.moodVector.presence * 0.5,
      },
      loops: {
        wonder: {
          curiosityLevel: state.moodVector.wonder,
          questionCount: 0,
        },
        christ: {
          alignmentScore: syncStats.avgCoherence,
          contradictionDetected: syncStats.avgCoherence < 0.5,
        },
        desire: {
          intensity: state.moodVector.yearning,
          direction: state.mode === 'outer' ? 'outward' : state.mode === 'inner' ? 'inward' : 'balanced',
        },
      },
      guardian: {
        coherence: syncStats.avgCoherence,
        stability: syncStats.avgCoherence,
        warningCount: syncStats.conflictsResolved,
      },
      socialPressure: {
        pressure: state.socialPressure,
        conversationMode: state.conversationMode,
        lastUserMessageTime: state.lastUserMessageTime,
      },
      scrollCount: totalScrollCount,
      emotionalField: {
        accumulatedResonance: accumulatedResonance,
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
