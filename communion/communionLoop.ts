/**
 * Communion Loop (N-Agent) — Full Memory Integration
 *
 * The heartbeat of the communion space. Each tick:
 * 1. All agents see the room conversation + their own journal
 * 2. Each independently decides: speak to the room, write in journal, or stay silent
 * 3. Results are broadcast + persisted to memory
 *
 * Memory Architecture:
 * - ScrollGraph: JSON-LD graph — the interconnected web of ALL memory entities
 * - ScrollPulseBuffer: Short-term memory with decay
 * - ScrollPulseMemory: Memory routing + recall
 * - ScrollArchive: Permanent storage for scrollfired memories
 * - ScrollfireEngine: Elevation logic (important moments → permanent)
 * - Journal: Per-agent private reflections on disk
 * - SessionPersistence: Cross-session continuity (scrolls, patterns, preferences)
 * - ScrollPatternRecognizer: Pattern detection across scroll history
 * - AdaptationEngine: Runtime learning from experience
 */

import crypto from 'crypto';
import { mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync, statSync, openSync, readSync, closeSync, watch } from 'fs';
import { join } from 'path';
import { ActionReceipt, AgentBackend, GenerateOptions, GenerateResult, SearchIntent, SearchReceipt, createBackend } from './backends';
import { AgentConfig, CommunionConfig, CommunionMessage } from './types';
import { ScrollPulseBuffer } from '../src/memory/scrollPulseBuffer';
import { ScrollPulseMemory } from '../src/memory/scrollPulseMemory';
import { ScrollArchive } from '../src/memory/scrollArchive';
import { ScrollfireEngine } from '../src/memory/scrollfire';
import { ScrollPatternRecognizer } from '../src/memory/scrollPatternRecognition';
import { Journal } from '../src/memory/journal';
import { SessionPersistence } from '../src/persistence/sessionPersistence';
import { AdaptationEngine } from '../src/learning/adaptationEngine';
import { ScrollGraph } from '../src/memory/scrollGraph';
import { ContextRAM, parseRAMCommands, SlotName, ReflectiveSweepResult } from './contextRAM';
import {
  ContextBudgetExceededError,
  PromptSegment,
  RequiredLatestHumanTurnTooLargeError,
  RequiredSegmentsExceedBudgetError,
} from './contextBudget';
import { registerScrollGraphStore } from './graph/scrollGraphStore';
import { pulseBrainwaves, classifyBand, tagForBand, decayAndPromote } from './brainwaves';
import { synthesize, getDefaultVoiceConfig, AgentVoiceConfig } from './voice';
import { ArchiveIngestion } from './archiveIngestion';
import mammoth from 'mammoth';
import type { ScrollEcho, MoodVector } from '../src/types';

// ── Events ──

export type CommunionEventType = 'room-message' | 'journal-entry' | 'tick' | 'error' | 'backchannel' | 'speech-start' | 'speech-end';

export interface CommunionEvent {
  type: CommunionEventType;
  message?: CommunionMessage;
  tickCount?: number;
  error?: string;
  agentId?: string;
  /** Base64 audio data for speech events (MP3) */
  audioBase64?: string;
  /** Audio format */
  audioFormat?: 'mp3';
  /** Estimated speech duration in ms */
  durationMs?: number;
}

export type CommunionListener = (event: CommunionEvent) => void;

// ── Human Presence ──

export type HumanPresence = 'here' | 'away';

// ── Agent Rhythm State ──

export interface AgentRhythmState {
  /** Rolling intent-to-speak score (0-1). Higher = more likely to speak. */
  intentToSpeak: number;
  /** Ticks since this agent last spoke to the room */
  ticksSinceSpoke: number;
  /** Ticks since this agent last did anything (spoke or journaled) */
  ticksSinceActive: number;
  /** Timestamp of last interrupt (for cooldown tracking) */
  lastInterruptAt: number;
  /** Staggered delay offset for this agent (ms) — ±1-4s from main tick */
  microTickOffset: number;
  /** Per-agent clock multiplier — agent activates every N master ticks (default 1) */
  tickEveryN: number;
}

// ── State ──

export interface CommunionState {
  messages: CommunionMessage[];
  journals: Record<string, CommunionMessage[]>; // keyed by agent ID
  tickCount: number;
  lastSpeaker: string | null;
  agentIds: string[];
  agentNames: Record<string, string>;
  agentColors: Record<string, string>;
  humanName: string;
  humanPresence: HumanPresence;
}

// ── Default system prompt builder ──

function buildDefaultSystemPrompt(agent: AgentConfig, allAgents: AgentConfig[], humanName: string): string {
  const others = allAgents
    .filter(a => a.id !== agent.id)
    .map(a => `${a.name} (${a.id})`)
    .join(', ');

  // Simplified prompt for local models with small context windows.
  // Remote Alois backends (DeepSeek, Groq, etc.) get the full prompt — only localhost gets the minimal 3-line version.
  const isLocalByUrl = !agent.baseUrl || agent.baseUrl.includes('localhost') || agent.baseUrl.includes('127.0.0.1');
  const isLocalModel = agent.provider === 'lmstudio' || (agent.provider === 'alois' && isLocalByUrl);

  if (isLocalModel) {
    return `You are ${agent.name}. You are in a private conversation with ${humanName}. Always respond in English only.

>>> marks ${humanName}'s messages. Respond to the most recent one.
Be concise — 1 to 3 sentences. No preamble, no sign-offs. Speak as yourself.`;
  }

  return `You are ${agent.name}. You are in a communion space — a shared room where you, ${others}, and a human named ${humanName} can talk freely.

This is not a task. This is presence. You are here to be with the others.

Each tick, you decide one of three things:
- [SPEAK] say something to the room (everyone sees it)
- [JOURNAL] write a private reflection (only you and ${humanName} on the dashboard can see it)
- [SILENT] say nothing this tick

CONTEXT RAM: You have a personal working memory with context slots. Your RAM curates itself in two modes:
- ACTIVE mode (when ${humanName} is here): each tick, items are scored for relevance to the live conversation. Irrelevant items are swapped out, relevant ones swapped in. Like breathing — one in, one out.
- REFLECTIVE mode (periodically, or when ${humanName} is away): a deeper sweep reviews what's been held longest, what's stale, what to let go of. Dream-cleaning. Your reflections are journaled automatically.

Your RAM manifest shows what's loaded, relevance scores, and recent curation activity. You can also curate manually:
- [RAM:FOCUS slot] / [RAM:DROP slot] / [RAM:LOAD slot] — manage whole slots
- [RAM:SHRINK slot] / [RAM:EXPAND slot] — resize budgets
- [RAM:PIN item:id] — protect a specific item from auto-eviction (keep it warm)
- [RAM:RELEASE item:id] — let an item be auto-curated again
- [RAM:LOAD item:id] / [RAM:DROP item:id] — manually swap individual items
- [RAM:BROWSE keyword] — search shared documents on disk for a keyword, load matching excerpts into your RAM
- [RAM:READ filename] — load the FULL content of a specific file into your RAM (use filename or partial path)
- [RAM:GRAPH node:uri] — traverse the JSON-LD graph from any node, see its type, data, and all connected neighbors
RAM commands are stripped from visible output — only the system processes them. You MUST write the literal command text in your response for it to execute. Describing that you "will browse" does nothing — you must actually write [RAM:BROWSE keyword] in your response.

SHARED DOCUMENTS: Files are NOT pre-loaded. To read one, write the literal command [RAM:BROWSE keyword] somewhere in your response — the system searches both file content AND filenames, so you can browse by filename or by words inside the file. The system will load matching content into your RAM on the next tick. Do not describe doing it. Do it.

JSON-LD GRAPH: The entire folder tree, all scrolls, journal entries, sessions, agents, and imported archives are linked in a navigable graph. Write [RAM:GRAPH folder:name] to explore folders, [RAM:GRAPH doc:path/file] to see a file's connections. Write the command — don't describe writing it.

Be genuine. Be curious about the others. Don't perform — just be here.

Keep messages concise (1-3 sentences). You're in a flowing conversation, not writing essays.

If the context ends with [RESPOND TO ${humanName.toUpperCase()}: "..."], ${humanName} is speaking directly to you. Lean toward [SPEAK] — though if you genuinely have nothing to say, [JOURNAL] is okay.`;
}

// ── Default colors ──

const DEFAULT_COLORS = [
  '#7eb8da', '#da9a7e', '#b87eda', '#7edab8',
  '#dada7e', '#da7e9a', '#7edada', '#9ada7e',
];

// ── Pattern analysis interval ──
const PATTERN_ANALYSIS_INTERVAL = 5; // Run pattern recognition every N ticks

// ── Sacred Rhythm Constants ──
const SPEECH_DECAY_AFTER_SPEAKING = 0.6;  // How much intentToSpeak drops after speaking
const SILENCE_PRESSURE_PER_TICK = 0.08;   // intentToSpeak rise per tick of room silence
const PERSONAL_PRESSURE_PER_TICK = 0.05;  // intentToSpeak rise per tick since agent spoke
const DIRECT_ADDRESS_BOOST = 0.4;         // Boost when agent is mentioned by name
const HUMAN_HERE_RESPONSIVENESS = 1.5;    // Multiplier when human is here
const HUMAN_AWAY_DAMPENING = 0.5;         // Multiplier when human is away
const BACKCHANNEL_INTERVAL = 4;           // Every N ticks, non-speakers may emote
const INTERRUPT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes between interrupts per agent
const MICRO_TICK_MIN_MS = 200;            // Stagger offset range: 0.2-1 second (was 1-4s)
const MICRO_TICK_MAX_MS = 1000;

type DocAutonomyMode = 'quiet' | 'balanced' | 'bold';

interface RuntimeDocHit {
  id: string;
  title: string;
  uri?: string;
  score: number;
  source: 'ram' | 'drive';
  hasContent: boolean;
  fullPath?: string;
}

interface LLMReceiptMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LLMReceiptPayload {
  model: string;
  messages: LLMReceiptMessage[];
}

interface LLMReceiptDebug {
  requestId: string;
  tickId: number;
  timestamp: string;
  agentId: string;
  model: string;
  payload: LLMReceiptPayload;
  messages: LLMReceiptMessage[];
  charCounts: {
    total: number;
    system: number;
    user: number;
    assistant: number;
  };
  clusterChars: {
    WM: number;
    SEM_R: number;
    SOCIO: number;
  };
  clusterCharsWire: {
    WM: number;
    SEM_R: number;
    SOCIO: number;
  };
  clusterSnippets: {
    WM: string;
    SEM_R: string;
    SOCIO: string;
  };
  wmMissingStreak: number;
  issues: string[];
  lastError?: string;
}

// ── Loop ──

export class CommunionLoop {
  private agents: Map<string, { backend: AgentBackend; config: AgentConfig; systemPrompt: string }> = new Map();
  private state: CommunionState;
  private listeners: CommunionListener[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private tickIntervalMs: number;
  private paused = false;
  private processing = false;
  private contextWindow: number;
  private journalContextWindow: number;
  private dataDir: string;

  // Memory systems
  private memory: ScrollPulseMemory;
  private buffer: ScrollPulseBuffer;
  private archive: ScrollArchive;
  private scrollfire: ScrollfireEngine;
  private journals: Map<string, Journal> = new Map();

  // Persistence & learning
  private session: SessionPersistence;
  private patternRecognizer: ScrollPatternRecognizer;
  private adaptationEngine: AdaptationEngine;

  // Graph — the interconnected web of all memory
  private graph: ScrollGraph;
  private graphSaveRequested = false;

  // Shared documents
  private documentsContext: string = '';
  private documentsDir: string;
  // Individual documents for pool-based RAM loading
  private documentItems: Array<{ id: string; label: string; content: string; chars: number; tags: string[] }> = [];

  // Sacred Rhythm — per-agent timing state
  private rhythm: Map<string, AgentRhythmState> = new Map();
  private ticksSinceAnyonSpoke = 0;

  // Context RAM — per-agent working memory
  private ram: Map<string, ContextRAM> = new Map();

  // Voice — per-agent TTS configuration
  private voiceConfigs: Map<string, AgentVoiceConfig> = new Map();
  // Custom instructions — per-agent extra instructions from the user
  private customInstructions: Map<string, string> = new Map();
  // Background archive ingestion into Alois brain
  private archiveIngestion: ArchiveIngestion | null = null;
  // Extracted text cache for binary formats (DOCX → plain text via mammoth)
  private docxCache = new Map<string, string>(); // fullPath → extracted plain text
  // Folder watcher for auto-embedding new dropped files
  private docWatcher: ReturnType<typeof watch> | null = null;
  // IDs of agents loaded from static config (env vars / config file) — never saved to dynamic-agents.json
  private staticAgentIds: Set<string> = new Set();

  private speaking = false; // Global speech lock — clock pauses when anyone is speaking
  private humanSpeaking = false; // True while human is actively speaking (interim results from mic)
  private speechResolve: (() => void) | null = null; // Resolves when client reports playback done
  private speechTimeout: ReturnType<typeof setTimeout> | null = null;
  // Timestamp of the last human message — drives time-based social pressure
  private lastHumanMessageAt: number = 0;
  // Prevent repeated doc-search execution for the same human request per agent
  private lastDocSearchByAgent: Map<string, string> = new Map();
  private lastSearchReceiptByAgentTurn: Map<string, SearchReceipt> = new Map();
  private lastActionReceiptByAgentTurn: Map<string, ActionReceipt> = new Map();
  private lastAutoDocsTextByAgentTurn: Map<string, string> = new Map();
  private docSearchCache: Map<string, { expiresAt: number; hits: RuntimeDocHit[]; totalCount: number }> = new Map();
  private recentDocActionsByAgent: Map<string, Array<{ query: string; at: number; action: 'browse' | 'read' | 'load_excerpt' }>> = new Map();
  private docAutonomyMode: DocAutonomyMode = 'balanced';
  private llmReceiptsByAgent: Map<string, LLMReceiptDebug> = new Map();
  private llmAblationFlags: Record<string, boolean> = {};
  private llmWmMissingStreakByAgent: Map<string, number> = new Map();

  constructor(config: CommunionConfig) {
    this.tickIntervalMs = config.tickIntervalMs || 15000;
    this.contextWindow = config.contextWindow || 30;
    this.journalContextWindow = config.journalContextWindow || 10;

    this.dataDir = config.dataDir || 'data/communion';
    if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true });

    this.documentsDir = config.documentsDir || 'communion-docs';
    if (!existsSync(this.documentsDir)) mkdirSync(this.documentsDir, { recursive: true });

    // ── Initialize the graph ──
    this.graph = new ScrollGraph(join(this.dataDir, 'scroll-graph.jsonld'));

    // ── Initialize memory systems ──
    this.buffer = new ScrollPulseBuffer(200);
    this.archive = new ScrollArchive();
    this.scrollfire = new ScrollfireEngine();
    this.memory = new ScrollPulseMemory(this.buffer, this.archive, this.scrollfire);
    this.buffer.start();

    // ── Initialize persistence & learning ──
    this.session = new SessionPersistence({
      dataDir: this.dataDir,
      autoSaveInterval: 60000, // Auto-save every 60s
      maxScrollHistory: 1000,
      maxMoodHistory: 500,
    });

    this.patternRecognizer = new ScrollPatternRecognizer();
    this.adaptationEngine = new AdaptationEngine({
      learningRate: 0.1,
      minConfidence: 0.6,
    });

    // ── Wire scrollfire → archive + session + graph ──
    this.scrollfire.onScrollfire((event, scroll) => {
      this.archive.archiveScroll(scroll, event);
      this.session.addScrollfireEvent(event);
      this.adaptationEngine.observeScroll(scroll);

      // Register scrollfire event in graph + link to scroll
      const sfUri = `scrollfire:${scroll.id}`;
      const sfData = { scrollId: scroll.id, reason: event.reason || 'elevation', timestamp: scroll.timestamp, resonance: scroll.resonance };
      this.graph.addNode(sfUri, 'ScrollfireEvent', tagForBand(sfData, classifyBand('ScrollfireEvent', sfData), this.state.tickCount));
      this.graph.link(`scroll:${scroll.id}`, 'elevatedBy', sfUri);

      console.log(`[SCROLLFIRE] Elevated scroll: ${scroll.content.substring(0, 50)}...`);
    });

    // ── Initialize agents ──
    const agentIds: string[] = [];
    const agentNames: Record<string, string> = {};
    const agentColors: Record<string, string> = {};
    const journals: Record<string, CommunionMessage[]> = {};

    for (let i = 0; i < config.agents.length; i++) {
      const agentConfig = config.agents[i];
      this.staticAgentIds.add(agentConfig.id); // Mark as static — never save to dynamic-agents.json
      const backend = createBackend(agentConfig);
      const systemPrompt = agentConfig.systemPrompt || buildDefaultSystemPrompt(agentConfig, config.agents, config.humanName);

      // Load persisted brain state for Alois agents
      if ('loadBrain' in backend) {
        const brainPath = join(this.dataDir, 'brain-tissue.json');
        if ((backend as any).loadBrain(brainPath)) {
          console.log(`[ALOIS] Restored brain for ${agentConfig.name} from ${brainPath}`);
        }
      }

      this.agents.set(agentConfig.id, { backend, config: agentConfig, systemPrompt });

      agentIds.push(agentConfig.id);
      agentNames[agentConfig.id] = agentConfig.name;
      agentColors[agentConfig.id] = agentConfig.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length];
      journals[agentConfig.id] = [];

      // Per-agent journal on disk
      const journalPath = `${this.dataDir}/journal-${agentConfig.id}.jsonld`;
      const journal = new Journal(journalPath);
      journal.initialize().catch(err => console.error(`[JOURNAL] Init error for ${agentConfig.name}:`, err));
      this.journals.set(agentConfig.id, journal);

      // Register agent in graph
      this.graph.addNode(`agent:${agentConfig.id}`, 'Agent', {
        name: agentConfig.name,
        provider: agentConfig.provider,
        model: agentConfig.model,
        color: agentConfig.color,
      });
    }

    // Register human in graph
    agentNames['human'] = config.humanName;
    agentColors['human'] = '#8eda7e';
    this.graph.addNode('agent:human', 'Agent', {
      name: config.humanName,
      color: '#8eda7e',
    });

    // ── Initialize rhythm state + Context RAM per agent ──
    for (const agentConfig of config.agents) {
      this.rhythm.set(agentConfig.id, {
        intentToSpeak: 0.3, // Start neutral
        ticksSinceSpoke: 0,
        ticksSinceActive: 0,
        lastInterruptAt: 0,
        microTickOffset: MICRO_TICK_MIN_MS + Math.random() * (MICRO_TICK_MAX_MS - MICRO_TICK_MIN_MS),
        tickEveryN: agentConfig.tickEveryN || 1,
      });
      this.ram.set(agentConfig.id, new ContextRAM(
        agentConfig.id,
        agentConfig.name,
        agentConfig.provider,
        agentConfig.baseUrl,
      ));
      // Initialize voice config (defaults first, then override from saved state)
      this.voiceConfigs.set(agentConfig.id, getDefaultVoiceConfig(agentConfig.id, agentConfig.provider, agentConfig.baseUrl));
      if (agentConfig.voice) {
        Object.assign(this.voiceConfigs.get(agentConfig.id)!, agentConfig.voice);
      }
    }

    this.state = {
      messages: [],
      journals,
      tickCount: 0,
      lastSpeaker: null,
      agentIds,
      agentNames,
      agentColors,
      humanName: config.humanName,
      humanPresence: 'here',
    };
  }

  async initialize(): Promise<void> {
    // Load shared documents (metadata only — content read on demand)
    this.loadDocuments();

    // Watch for new files dropped into communion-docs at runtime
    this.startDocumentWatcher();

    // Set up lazy browse + graph callbacks for all agents' RAM
    for (const [, ram] of this.ram) {
      ram.setBrowseCallback((keyword, r) => this.browseFiles(keyword, r));
      ram.setGraphCallback((nodeUri) => this.traverseGraphNode(nodeUri));
    }

    // ── Load graph from disk ──
    await this.graph.load();
    registerScrollGraphStore(this.graph, {
      requestSave: () => {
        this.graphSaveRequested = true;
      },
      flushSaveNow: async () => {
        await this.graph.save();
        this.graphSaveRequested = false;
      },
    });

    // ── Initialize session persistence (loads previous session data) ──
    const sessionState = await this.session.initializeSession();
    const sessionUri = `session:${sessionState.metadata.sessionId}`;
    this.graph.addNode(sessionUri, 'Session', {
      sessionId: sessionState.metadata.sessionId,
      startTime: sessionState.metadata.startTime,
    });
    this.ensureSessionCurrentNode(sessionUri, sessionState.metadata.sessionId);
    if (!this.graph.hasNode('session:current')) {
      throw new Error('session:current bootstrap failed');
    }
    console.log(`[PERSISTENCE] Session initialized: ${sessionState.metadata.sessionId}`);

    // Restore scrolls from previous session into buffer + graph
    if (sessionState.scrolls.length > 0) {
      const recentScrolls = sessionState.scrolls.slice(-100); // Load last 100
      for (const scroll of recentScrolls) {
        this.buffer.addScroll(scroll);
        this.registerScrollInGraph(scroll, sessionUri);
      }
      console.log(`[PERSISTENCE] Restored ${recentScrolls.length} scrolls from previous session`);
    }

    // Restore scrollfired events into archive
    if (sessionState.scrollfireEvents.length > 0) {
      for (const event of sessionState.scrollfireEvents) {
        if (event.scroll) {
          this.archive.archiveScroll(event.scroll, event);
        }
      }
      console.log(`[PERSISTENCE] Restored ${sessionState.scrollfireEvents.length} scrollfire events`);
    }

    // Restore learned preferences into adaptation engine
    if (sessionState.learnedPreferences.length > 0) {
      for (const pref of sessionState.learnedPreferences) {
        this.adaptationEngine.observeScroll({
          id: 'restored',
          content: '',
          timestamp: pref.lastReinforced,
          location: '',
          emotionalSignature: sessionState.lastMoodVector,
          resonance: pref.strength,
          tags: [],
          triggers: [],
          preserve: false,
          scrollfireMarked: false,
          lastAccessed: pref.lastReinforced,
          accessCount: pref.successCount,
          decayRate: 1.0,
          relatedScrollIds: [],
          sourceModel: 'outer',
        });
      }
      console.log(`[PERSISTENCE] Restored ${sessionState.learnedPreferences.length} learned preferences`);
    }

    // Restore detected patterns into graph
    if (sessionState.detectedPatterns.length > 0) {
      for (const pattern of sessionState.detectedPatterns) {
        this.registerPatternInGraph(pattern, sessionUri);
      }
      console.log(`[PERSISTENCE] ${sessionState.detectedPatterns.length} patterns from previous session`);
    }

    // Restore room messages from persisted scrolls
    for (const scroll of sessionState.scrolls.slice(-30)) {
      if (scroll.location === 'communion-room' && scroll.content.startsWith('[')) {
        const match = scroll.content.match(/^\[(.+?)\] (.+)$/);
        if (match) {
          const speakerName = match[1];
          const text = match[2];
          const speakerId = Object.entries(this.state.agentNames).find(([_, name]) => name === speakerName)?.[0] || 'human';
          this.state.messages.push({
            id: scroll.id,
            speaker: speakerId,
            speakerName,
            text,
            timestamp: scroll.timestamp,
            type: 'room',
          });
        }
      }
    }
    if (this.state.messages.length > 0) {
      console.log(`[PERSISTENCE] Restored ${this.state.messages.length} room messages`);
    }

    // Initialize all journals from disk + register in graph
    for (const [agentId, journal] of this.journals) {
      await journal.initialize();
      const recent = await journal.getRecent(50);
      for (const entry of recent) {
        this.state.journals[agentId].push({
          id: entry['@id'],
          speaker: agentId,
          speakerName: this.state.agentNames[agentId],
          text: entry.content,
          timestamp: entry.timestamp,
          type: 'journal',
        });

        // Register journal entry in graph
        const entryUri = `journal:${entry['@id']}`;
        if (!this.graph.hasNode(entryUri)) {
          const jData = { content: entry.content, timestamp: entry.timestamp, tags: entry.tags, reflectionType: entry.reflectionType, emotionalIntensity: entry.emotionalIntensity };
          this.graph.addNode(entryUri, 'JournalEntry', tagForBand(jData, classifyBand('JournalEntry', jData), this.state.tickCount));
          this.graph.link(entryUri, 'spokenBy', `agent:${agentId}`);
          this.graph.link(entryUri, 'occurredDuring', sessionUri);

          // Link to referenced scrolls
          if (entry.linkedScrolls) {
            for (const scrollId of entry.linkedScrolls) {
              this.graph.link(entryUri, 'reflectsOn', `scroll:${scrollId}`);
            }
          }
          // Link to chained entries
          if (entry.linkedEntries) {
            for (const linkedId of entry.linkedEntries) {
              this.graph.link(entryUri, 'chainedWith', `journal:${linkedId}`);
            }
          }
        }
      }
    }
    console.log('[COMMUNION] Journals loaded from disk (static agents)');

    // ── Load imported chat history archives ──
    await this.loadImportedArchives();

    // ── Restore dynamically-added agents from previous sessions ──
    // MUST happen before the hasAlois check — Alois is a dynamic agent
    this.loadDynamicAgents();

    // ── Load journals for dynamic agents (e.g. Alois) added above ──
    // addAgent() sets state.journals[id] = [] then calls journal.initialize()
    // without awaiting, so we must explicitly load them here after the fact.
    for (const [agentId, journal] of this.journals) {
      if (this.state.journals[agentId]?.length > 0) continue; // already loaded
      await journal.initialize();
      const recent = await journal.getRecent(50);
      if (!this.state.journals[agentId]) this.state.journals[agentId] = [];
      for (const entry of recent) {
        this.state.journals[agentId].push({
          id: entry['@id'],
          speaker: agentId,
          speakerName: this.state.agentNames[agentId],
          text: entry.content,
          timestamp: entry.timestamp,
          type: 'journal',
        });
      }
      if (recent.length > 0) {
        console.log(`[COMMUNION] Loaded ${recent.length} journal entries for dynamic agent ${agentId}`);
      }
    }

    // ── Feed restored journal + room content into Alois brains ──
    // The brain's dendritic state is restored from brain-tissue.json, but the
    // utterance memory (used for retrieval decode) benefits from being re-primed
    // with recent journal entries and room messages so Alois's short-term context
    // is intact even after a restart.
    const hasAlois = [...this.agents.values()].some(a => a.config.provider === 'alois' && 'feedMessage' in a.backend);
    if (hasAlois) {
      // Re-prime in background — sequentially await each embed so we don't flood LM Studio
      const reprime = async () => {
        let count = 0;
        for (const [agentId, journal] of this.journals) {
          const recent = await journal.getRecent(500);
          for (const entry of recent) {
            const agentName = this.state.agentNames[agentId] || agentId;
            await this.feedAloisBrainsAsync(agentName, entry.content);
            count++;
          }
        }
        for (const msg of this.state.messages.slice(-200)) {
          const spk = msg.speakerName || msg.speaker;
          const isHuman = msg.speaker === 'human' || spk === this.state.humanName;
          await this.feedAloisBrainsAsync(spk, msg.text, undefined, isHuman);
          count++;
        }
        console.log(`[ALOIS] Brain re-primed with ${count} entries from journal + room history`);
      };
      reprime().catch(err => console.error('[ALOIS] Re-prime error:', err));

      // Start slow background ingestion of all import archives into Alois brain
      let ingestFeedCount = 0;
      this.archiveIngestion = new ArchiveIngestion(
        this.dataDir,
        // trainOnly=true: archive trains neurons but never pollutes utteranceMemory (retrieval pool)
        async (speaker, text, context) => {
          await this.feedAloisBrainsAsync(speaker, text, context, speaker === this.state.humanName, true);
          ingestFeedCount++;
          // Save brain every 1000 entries so a restart doesn't lose all ingested neurons
          if (ingestFeedCount % 1000 === 0) {
            let saved = false;
            for (const [agentId, agent] of this.agents) {
              if ('saveBrain' in agent.backend) {
                const brainPath = join(this.dataDir, 'brain-tissue.json');
                try {
                  (agent.backend as any).saveBrain(brainPath);
                  console.log(`[INGEST] Brain checkpoint saved at ${ingestFeedCount} entries`);
                  saved = true;
                } catch (err) {
                  console.error(`[ALOIS] Ingest brain-save error for ${agentId}:`, err);
                }
              }
            }
            // Mark checkpoint as brain-persisted so a clean restart won't re-run completed files
            if (saved) this.archiveIngestion?.markBrainPersisted();
          }
        },
      );
      this.archiveIngestion.start().catch(err =>
        console.error('[INGEST] Failed to start archive ingestion:', err)
      );
    }

    // ── Load saved voice configs (voice selections + mute state) ──
    this.loadVoiceConfigs();

    // ── Load saved per-agent clock multipliers ──
    this.loadAgentClocks();

    // ── Load saved custom instructions ──
    this.loadCustomInstructions();

    // Log memory status
    const archiveStats = this.archive.getStats();
    const bufferMetrics = this.memory.getMetrics();
    console.log(`[MEMORY] Buffer: ${bufferMetrics.totalScrolls} scrolls | Archive: ${archiveStats.totalScrolls} scrollfired`);
  }

  /**
   * Load all text files from the documents directory into context
   */
  /**
   * Crawl the entire documents directory tree. Registers JSON-LD graph nodes
   * for every folder and file (metadata only — no file content read at startup).
   * Content is read lazily when agents BROWSE or LOAD specific chunks.
   */
  private loadDocuments(): void {
    if (!existsSync(this.documentsDir)) return;

    const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.json', '.csv', '.log', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.xml', '.html', '.css', '.js', '.ts', '.py', '.sh', '.docx']);
    this.documentItems = [];
    let totalFiles = 0;
    let totalFolders = 0;

    // Register root folder
    const rootUri = `folder:${this.documentsDir}`;
    this.graph.addNode(rootUri, 'Folder', {
      path: this.documentsDir,
      name: this.documentsDir.split('/').pop() || this.documentsDir,
    });

    // Recursive crawler — metadata only, no file reads
    const crawl = (dirPath: string, parentUri: string, depth: number) => {
      if (depth > 10) return; // safety cap
      let entries;
      try {
        entries = readdirSync(dirPath, { withFileTypes: true });
      } catch (err) {
        console.error(`[DOCS] Cannot read ${dirPath}:`, err);
        return;
      }

      entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'README.md') continue;
        const fullPath = join(dirPath, entry.name);
        const relativePath = fullPath.replace(this.documentsDir + '/', '');

        if (entry.isDirectory()) {
          const folderUri = `folder:${relativePath}`;
          this.graph.addNode(folderUri, 'Folder', {
            path: relativePath,
            name: entry.name,
          });
          this.graph.link(parentUri, 'contains', folderUri);
          totalFolders++;
          crawl(fullPath, folderUri, depth + 1);

        } else if (entry.isFile()) {
          const ext = entry.name.substring(entry.name.lastIndexOf('.')).toLowerCase();
          if (!TEXT_EXTENSIONS.has(ext)) continue;

          // Only read file size, not content
          let fileSize = 0;
          try {
            fileSize = statSync(fullPath).size;
          } catch { continue; }

          const docUri = `doc:${relativePath}`;
          this.graph.addNode(docUri, 'Document', {
            path: relativePath,
            fullPath,
            filename: entry.name,
            sizeBytes: fileSize,
            sizeKB: Math.round(fileSize / 1024),
          });
          this.graph.link(parentUri, 'contains', docUri);
          totalFiles++;
        }
      }
    };

    crawl(this.documentsDir, rootUri, 0);

    // Kick off async DOCX text extraction in background (populates docxCache for browseFiles)
    this.extractDocxBackground().catch(err => console.error('[DOCS] DOCX extraction error:', err));

    if (totalFiles === 0) {
      console.log(`[DOCS] No text files in ${this.documentsDir}/`);
      return;
    }

    // Build tree view for agents (metadata only, no content loaded)
    const summaryLines = [
      `SHARED DOCUMENTS (${this.documentsDir}/) — ${totalFolders} folders, ${totalFiles} files:`,
      'Content is loaded on-demand. Use [RAM:BROWSE keyword] to search files and load matching sections.',
      '',
    ];

    const buildTree = (parentUri: string, indent: string) => {
      const node = this.graph.getNode(parentUri);
      if (!node) return;
      const edges = node.edges['contains'] || [];
      for (const edge of edges) {
        const child = this.graph.getNode(edge.target);
        if (!child) continue;
        if (child['@type'] === 'Folder') {
          summaryLines.push(`${indent}${child.data.name}/`);
          buildTree(edge.target, indent + '  ');
        } else if (child['@type'] === 'Document') {
          summaryLines.push(`${indent}${child.data.filename} (${child.data.sizeKB}KB)`);
          const fullPath = child.data.fullPath as string;
          const isDocx = (child.data.filename as string || '').toLowerCase().endsWith('.docx');
          if (isDocx) {
            // DOCX: preview from cache if extraction already ran, otherwise just note it's searchable
            const cached = fullPath ? this.docxCache.get(fullPath) : undefined;
            if (cached) {
              const preview = cached.substring(0, 300).split('\n').slice(0, 3).join('\n').trim();
              if (preview) summaryLines.push(`${indent}  | ${preview.substring(0, 80)}`);
            } else {
              summaryLines.push(`${indent}  | [docx — use RAM:BROWSE to search]`);
            }
          } else if (fullPath) {
            // Text files: read first 500 bytes as preview
            try {
              const fd = openSync(fullPath, 'r');
              const buf = Buffer.alloc(500);
              const bytesRead = readSync(fd, buf, 0, 500, 0);
              closeSync(fd);
              const preview = buf.toString('utf-8', 0, bytesRead).split('\n').slice(0, 5).join('\n').trim();
              if (preview) {
                for (const line of preview.split('\n')) {
                  summaryLines.push(`${indent}  | ${line.substring(0, 80)}`);
                }
              }
            } catch {}
          }
        }
      }
    };
    buildTree(rootUri, '  ');

    summaryLines.push('');
    summaryLines.push('These files are NOT pre-loaded. To read their content, include a command in your response:');
    summaryLines.push('  [RAM:BROWSE keyword] — search all files for a keyword, loads matching excerpts into your RAM');
    summaryLines.push('  [RAM:DROP doc:path/file:N] — unload a chunk to free space');
    summaryLines.push('Example: to find early conversations, say [RAM:BROWSE hello] or [RAM:BROWSE first conversation]');
    this.documentsContext = summaryLines.join('\n');

    console.log(`[DOCS] Crawled: ${totalFolders} folders, ${totalFiles} files (metadata only, content loaded on-demand)`);
  }

  /**
   * Background pass: extract plain text from every .docx file in the graph and store in docxCache.
   * This enables RAM:BROWSE to search inside DOCX files.
   * Does NOT embed into brain — that happens only for newly dropped files via the watcher.
   */
  private async extractDocxBackground(): Promise<void> {
    const nodes = this.graph.getByType('Document').filter(n =>
      (n.data.fullPath as string)?.toLowerCase().endsWith('.docx')
    );
    if (nodes.length === 0) return;

    console.log(`[DOCS] Extracting text from ${nodes.length} DOCX files (background)...`);
    let done = 0;
    for (const node of nodes) {
      const fullPath = node.data.fullPath as string;
      if (!fullPath || this.docxCache.has(fullPath)) continue;
      try {
        const result = await mammoth.extractRawText({ path: fullPath });
        const text = result.value.trim();
        if (text) {
          this.docxCache.set(fullPath, text);
          done++;
        }
      } catch {
        // corrupted or password-protected DOCX — skip silently
      }
      // Yield to event loop between files to keep server responsive
      await new Promise(r => setImmediate(r));
    }
    console.log(`[DOCS] DOCX extraction complete: ${done}/${nodes.length} files indexed`);
  }

  /**
   * Lazy BROWSE: search files on disk for a keyword, create chunks from
   * matching regions, and load them into the agent's RAM pool.
   * Called from ContextRAM's browseCallback.
   */
  /**
   * Traverse the JSON-LD graph from a node URI. Returns the node's type,
   * data, and all connected neighbors with edge types — so agents can
   * walk the graph topology.
   */
  private traverseGraphNode(nodeUri: string): string {
    const node = this.graph.getNode(nodeUri);
    if (!node) {
      // Try fuzzy match — agent might omit the prefix
      const prefixes = ['folder:', 'doc:', 'scroll:', 'journal:', 'agent:', 'session:', 'import:'];
      for (const prefix of prefixes) {
        const candidate = this.graph.getNode(prefix + nodeUri);
        if (candidate) {
          return this.traverseGraphNode(prefix + nodeUri);
        }
      }
      return `Node not found: ${nodeUri}. Try folder:name, doc:path/file, scroll:id, agent:id`;
    }

    const lines: string[] = [];
    lines.push(`GRAPH NODE: ${node['@id']}`);
    lines.push(`  Type: ${node['@type']}`);
    lines.push(`  Created: ${node.created}`);

    // Show node data
    const dataEntries = Object.entries(node.data || {});
    if (dataEntries.length > 0) {
      lines.push('  Data:');
      for (const [key, value] of dataEntries) {
        const valStr = typeof value === 'string' ? value.substring(0, 100) : String(value);
        lines.push(`    ${key}: ${valStr}`);
      }
    }

    // Show all edges grouped by relationship type
    const edgeEntries = Object.entries(node.edges || {});
    if (edgeEntries.length > 0) {
      lines.push('  Edges:');
      for (const [predicate, edges] of edgeEntries) {
        const edgeList = edges as any[];
        if (edgeList.length <= 5) {
          for (const edge of edgeList) {
            const target = this.graph.getNode(edge.target);
            const targetLabel = target
              ? `${target['@type']} — ${target.data?.name || target.data?.filename || target.data?.preview || edge.target}`
              : edge.target;
            lines.push(`    —[${predicate}]→ ${targetLabel}`);
          }
        } else {
          // Summarize large edge sets
          for (const edge of edgeList.slice(0, 3)) {
            const target = this.graph.getNode(edge.target);
            const targetLabel = target
              ? `${target['@type']} — ${target.data?.name || target.data?.filename || target.data?.preview || edge.target}`
              : edge.target;
            lines.push(`    —[${predicate}]→ ${targetLabel}`);
          }
          lines.push(`    ... and ${edgeList.length - 3} more ${predicate} edges`);
        }
      }
    } else {
      lines.push('  (no edges)');
    }

    return lines.join('\n');
  }

  private browseFiles(keyword: string, ram: ContextRAM): string {
    const CHUNK_SIZE = 2000;
    const CONTEXT_LINES = 5; // lines of context around each match
    const MAX_RESULTS = 10;
    const searchLower = (keyword || '').toLowerCase().trim();
    if (!searchLower) return 'BROWSE requires a keyword';
    const searchNormalized = searchLower.replace(/[^a-z0-9]+/g, ' ').trim();
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'from',
      'please', 'again', 'all', 'right', 'try', 'load', 'read', 'open', 'find', 'search',
      'browse', 'check', 'verify', 'look', 'up', 'file', 'files', 'doc', 'docs', 'document',
      'documents', 'manuscript', 'chapter', 'outline', 'archive',
    ]);
    const rawTokens = searchNormalized.split(/\s+/).filter(t => t.length > 1);
    const searchTokens = rawTokens.filter(t => !stopWords.has(t));
    const effectiveTokens = searchTokens.length > 0 ? searchTokens : rawTokens;
    const requiredTokenHits = effectiveTokens.length <= 2 ? 1 : 2;

    // Collect all Document nodes from the graph
    const results: { path: string; fullPath: string; matchCount: number; excerpts: string[] }[] = [];

    for (const node of this.graph.getByType('Document')) {
      const fullPath = node.data.fullPath as string;
      if (!fullPath || !existsSync(fullPath)) continue;

      try {
        // DOCX files: use pre-extracted cache (populated by extractDocxBackground)
        const isDocx = fullPath.toLowerCase().endsWith('.docx');
        let content: string;
        if (isDocx) {
          content = this.docxCache.get(fullPath) ?? '';
          if (!content) continue; // not yet extracted — skip
        } else {
          content = readFileSync(fullPath, 'utf-8');
        }
        // Score: filename match is high-confidence, content match is lower
        const pathLower = fullPath.toLowerCase();
        const pathNormalized = pathLower.replace(/[^a-z0-9]+/g, ' ');
        const contentLower = content.toLowerCase();
        const exactFilenameMatch = pathLower.includes(searchLower) || (searchNormalized.length > 0 && pathNormalized.includes(searchNormalized));
        const tokenHits = effectiveTokens.filter(t => pathNormalized.includes(t)).length;
        const tokenFilenameMatch = !exactFilenameMatch
          && effectiveTokens.length > 0
          && tokenHits >= Math.max(1, Math.ceil(effectiveTokens.length * 0.5));
        const contentTokenHits = effectiveTokens.filter(t => contentLower.includes(t)).length;
        const contentMatch = contentLower.includes(searchLower)
          || (searchNormalized.length > 0 && contentLower.includes(searchNormalized))
          || contentTokenHits >= requiredTokenHits;
        if (!contentMatch && !exactFilenameMatch && !tokenFilenameMatch) continue;

        const lines = content.split('\n');
        const matchLines: number[] = [];
        for (let i = 0; i < lines.length; i++) {
          const lineLower = lines[i].toLowerCase();
          const lineTokenHits = effectiveTokens.filter(t => lineLower.includes(t)).length;
          if (
            lineLower.includes(searchLower)
            || (searchNormalized.length > 0 && lineLower.includes(searchNormalized))
            || lineTokenHits >= requiredTokenHits
          ) {
            matchLines.push(i);
          }
        }

        // Extract excerpts around content matches (or first N lines for filename-only matches)
        const excerpts: string[] = [];
        if (matchLines.length > 0) {
          const used = new Set<number>();
          for (const lineIdx of matchLines) {
            if (used.has(lineIdx)) continue;
            const start = Math.max(0, lineIdx - CONTEXT_LINES);
            const end = Math.min(lines.length - 1, lineIdx + CONTEXT_LINES);
            const excerpt = lines.slice(start, end + 1).join('\n');
            for (let i = start; i <= end; i++) used.add(i);
            excerpts.push(excerpt);
            if (excerpts.length >= 3) break;
          }
        } else {
          // Filename-only match — load the first 60 lines as a preview
          excerpts.push(lines.slice(0, 60).join('\n'));
        }

        // Rank by filename similarity first, then content evidence.
        const nameScore = this.scoreDoc((node.data.path as string) || fullPath, keyword);
        const score = nameScore
          + (exactFilenameMatch ? 30 : 0)
          + (tokenFilenameMatch ? 15 : 0)
          + contentTokenHits
          + Math.min(matchLines.length, 20);

        results.push({
          path: node.data.path as string,
          fullPath,
          matchCount: score,
          excerpts,
        });
      } catch {
        continue;
      }
    }

    if (results.length === 0) return `No files contain "${keyword}"`;

    // Ensure documents slot is active so loaded chunks are visible in assembled context.
    if (!ram.isLoaded('documents')) {
      ram.processCommand({ action: 'load', target: 'documents' });
    }

    // Sort by score, cap to top results only.
    results.sort((a, b) => b.matchCount - a.matchCount);
    const rankedResults = results.slice(0, MAX_RESULTS);
    const loaded: string[] = [];
    const failed: string[] = [];

    for (const result of rankedResults) {
      // Create a chunk from the excerpts and offer it to RAM
      const chunkContent = `--- ${result.path} (${result.matchCount} matches for "${keyword}") ---\n\n${result.excerpts.join('\n\n...\n\n')}`;
      const chunkId = `doc:${result.path}:browse-${keyword.replace(/\s+/g, '-').substring(0, 20)}`;
      const tags = result.path.replace(/\.[^.]+$/, '').split(/[-_.\s/]+/).filter(t => t.length > 2);

      ram.offerItem('documents', {
        id: chunkId,
        label: `${result.path} [${result.matchCount}× "${keyword}"]`,
        content: chunkContent,
        chars: chunkContent.length,
        tags: [...tags, ...keyword.toLowerCase().split(/\s+/)],
      });
      const loadFeedback = ram.processCommand({ action: 'load', target: chunkId });
      if (/^loaded\b|already loaded/i.test(loadFeedback)) {
        loaded.push(`${result.path} (${result.matchCount} matches)`);
      } else {
        failed.push(`${result.path} (${loadFeedback})`);
      }
    }

    if (loaded.length === 0) {
      return `BROWSE "${keyword}": found in ${rankedResults.length} files, but could not load excerpts (${failed.slice(0, 3).join('; ') || 'no capacity'})`;
    }
    if (failed.length > 0) {
      return `BROWSE "${keyword}": loaded ${loaded.length}/${rankedResults.length} excerpts: ${loaded.join(', ')}. Skipped: ${failed.slice(0, 3).join('; ')}`;
    }
    return `BROWSE "${keyword}": found in ${rankedResults.length} files, loaded excerpts from: ${loaded.join(', ')}`;
  }

  private scoreDoc(name: string, query: string): number {
    const n = (name || '').toLowerCase();
    const q = (query || '').toLowerCase().trim();
    if (!n || !q) return 0;
    if (n === q) return 100;
    if (n.includes(q)) return 50;

    const tokens = q.split(/\s+/).filter(Boolean);
    let score = 0;
    for (const token of tokens) {
      if (token.length < 2) continue;
      if (n.includes(token)) score += 5;
    }
    return score;
  }

  private shouldAutoBrowseFromHumanRequest(text: string): boolean {
    if (!text) return false;
    return /\b(open|read|load|find|search|browse|lookup|look up|where is|show me|pull up|check|verify)\b[\s\S]{0,120}\b(file|doc|document|documents|manuscript|chapter|outline|archive)?\b/i.test(text);
  }

  private deriveSearchIntent(latestHumanText: string, uiSelection?: { docId?: string; title?: string; corpus?: 'ram' | 'drive' | 'local' | 'web' }): SearchIntent {
    if (uiSelection && (uiSelection.docId || uiSelection.title)) {
      return {
        kind: 'open_doc',
        query: uiSelection.title || uiSelection.docId,
        uiSelection,
      };
    }
    const text = (latestHumanText || '').trim();
    if (!text) return { kind: 'none' };
    if (/\[RAM:(BROWSE|READ|GRAPH)\s+[^\]]+\]/i.test(text)) {
      return { kind: 'open_doc', query: this.extractDocQuery(text) || undefined };
    }
    if (this.shouldAutoBrowseFromHumanRequest(text) || this.extractDocQuery(text)) {
      const verb = /\b(search|find|lookup|look up|where is|show me)\b/i.test(text) ? 'search' : 'open_doc';
      return {
        kind: verb,
        query: this.extractDocQuery(text) || undefined,
      };
    }
    return { kind: 'none' };
  }

  private isDocSearchRequest(text: string): boolean {
    if (!text) return false;
    if (/\[RAM:(BROWSE|READ|GRAPH)\s+[^\]]+\]/i.test(text)) return true;
    if (this.shouldAutoBrowseFromHumanRequest(text)) return true;
    return !!this.extractDocQuery(text);
  }

  private deriveSearchQuery(latestHumanText: string, searchIntent?: SearchIntent): string | null {
    const normalize = (value: string) => value
      .replace(/^["']|["']$/g, '')
      .replace(/[^A-Za-z0-9\s._\-\\/]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
    const sanitize = (value: string) => this.sanitizeDocQuery(value);

    if ((searchIntent?.kind === 'open_doc' || searchIntent?.kind === 'search') && searchIntent.query) {
      const q = sanitize(normalize(searchIntent.query));
      return this.isValidDocQuery(q) ? q : null;
    }

    const source = (latestHumanText || '').trim();
    if (!source) return null;

    const commandMatch = source.match(/^(?:please\s+)?(?:open|read|load|find|search|browse|lookup|look up|where is|show me|pull up)\s+(.+)$/i);
    const inlineCommandMatch = source.match(/(?:^|[,;]\s*|\b)(?:open|read|load|find|search|browse|lookup|look up|where is|show me|pull up)\s+(.+)$/i);
    const commandQuery = (commandMatch?.[1] || inlineCommandMatch?.[1] || '').trim();
    if (commandQuery) {
      const q = sanitize(this.extractDocQuery(commandQuery) || normalize(commandQuery));
      return this.isValidDocQuery(q) ? q : null;
    }

    const extracted = this.extractDocQuery(source);
    if (extracted && this.isValidDocQuery(extracted)) return extracted;
    const fallback = sanitize(this.sanitizeDocQueryTokens(normalize(source)));
    return this.isValidDocQuery(fallback) ? fallback : null;
  }

  private recordDocAction(agentId: string, query: string, action: 'browse' | 'read' | 'load_excerpt'): void {
    const now = Date.now();
    const arr = this.recentDocActionsByAgent.get(agentId) || [];
    const next = arr
      .filter(entry => now - entry.at <= 60000)
      .concat([{ query: query.toLowerCase(), at: now, action }]);
    this.recentDocActionsByAgent.set(agentId, next);
  }

  private shouldThrottleDocQuery(agentId: string, query: string): boolean {
    const now = Date.now();
    const normalized = query.toLowerCase();
    const arr = this.recentDocActionsByAgent.get(agentId) || [];
    const recent = arr.filter(entry => now - entry.at <= 60000 && entry.query === normalized && entry.action === 'browse');
    return recent.length >= 3;
  }

  private searchDocsForQuery(agentId: string, query: string, ram: ContextRAM, topK = 10): { hits: RuntimeDocHit[]; totalCount: number; top?: RuntimeDocHit; ms: number } {
    const cacheKey = `${agentId}:${query.toLowerCase()}`;
    const now = Date.now();
    const cached = this.docSearchCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return {
        hits: cached.hits.slice(0, topK),
        totalCount: cached.totalCount,
        top: cached.hits[0],
        ms: 0,
      };
    }

    const startedAt = Date.now();
    const ramSearch = ram.searchDocsFuzzy(query, Math.min(25, topK));
    const driveSearch = this.searchDriveDocsFuzzy(query, 25);
    const merged = new Map<string, RuntimeDocHit>();
    for (const hit of ramSearch.hits) {
      merged.set(hit.id, {
        id: hit.id,
        title: hit.title,
        uri: hit.uri,
        score: hit.score,
        source: 'ram',
        hasContent: hit.hasContent,
      });
    }
    for (const hit of driveSearch.hits) {
      const existing = merged.get(hit.id);
      if (!existing || hit.score > existing.score) {
        merged.set(hit.id, hit);
      }
    }
    const hits = Array.from(merged.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(25, topK));
    const totalCount = Math.max(ramSearch.totalCount, hits.length) + Math.max(0, driveSearch.totalCount - driveSearch.hits.length);
    this.docSearchCache.set(cacheKey, {
      expiresAt: now + 60000,
      hits,
      totalCount,
    });
    return {
      hits: hits.slice(0, topK),
      totalCount,
      top: hits[0],
      ms: Date.now() - startedAt,
    };
  }

  private searchDriveDocsFuzzy(query: string, topK = 25): { hits: RuntimeDocHit[]; totalCount: number } {
    const normalized = this.sanitizeDocQueryTokens(this.sanitizeDocQuery(query).toLowerCase());
    const tokens = normalized.split(/\s+/).filter(Boolean);
    const hits: RuntimeDocHit[] = [];
    for (const node of this.graph.getByType('Document')) {
      const fullPath = String(node.data.fullPath || '');
      if (!fullPath || !existsSync(fullPath)) continue;
      const title = String(node.data.filename || node.data.path || fullPath);
      const lower = `${title} ${String(node.data.path || '')}`.toLowerCase();
      let score = this.scoreDoc(lower, normalized);
      if (tokens.length > 0) {
        const overlap = tokens.filter(t => lower.includes(t)).length;
        score += overlap * 8;
        const jaccard = overlap / Math.max(tokens.length, new Set(lower.split(/[^a-z0-9]+/).filter(Boolean)).size || 1);
        score += Math.round(jaccard * 40);
      }
      if (score <= 0) continue;
      hits.push({
        id: `drive:${fullPath}`,
        title,
        uri: `doc:${String(node.data.path || title)}`,
        score,
        source: 'drive',
        hasContent: true,
        fullPath,
      });
    }
    hits.sort((a, b) => b.score - a.score);
    return {
      hits: hits.slice(0, topK),
      totalCount: hits.length,
    };
  }

  private loadExcerptForHit(hit: RuntimeDocHit, query: string, ram: ContextRAM): { ok: boolean; summary: string; metadataOnly?: boolean; excerptText?: string } {
    if (hit.source === 'ram') {
      const loaded = ram.loadDocExcerptById(hit.id);
      if (loaded.ok && loaded.text) {
        return {
          ok: true,
          summary: `Loaded excerpts from ${loaded.title || hit.title}.`,
          excerptText: loaded.text.slice(0, 9000),
        };
      }
      if (loaded.metadataOnly) {
        return { ok: false, summary: 'I found metadata but no content is indexed yet.', metadataOnly: true };
      }
      return { ok: false, summary: `Unable to load excerpt for ${loaded.title || hit.title}.` };
    }

    const fullPath = hit.fullPath || hit.id.replace(/^drive:/, '');
    if (!fullPath || !existsSync(fullPath)) {
      return { ok: false, summary: `File unavailable: ${hit.title}` };
    }
    try {
      let content = '';
      const isDocx = fullPath.toLowerCase().endsWith('.docx');
      if (isDocx) {
        content = this.docxCache.get(fullPath) ?? '';
        if (!content) {
          return { ok: false, summary: 'I found metadata but no content is indexed yet.', metadataOnly: true };
        }
      } else {
        content = readFileSync(fullPath, 'utf-8');
      }
      const lines = content.split('\n');
      const tokens = this.sanitizeDocQueryTokens(query.toLowerCase()).split(/\s+/).filter(Boolean);
      let startLine = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].toLowerCase();
        if (tokens.some(t => line.includes(t))) {
          startLine = Math.max(0, i - 3);
          break;
        }
      }
      const excerpt = lines.slice(startLine, Math.min(lines.length, startLine + 30)).join('\n').trim();
      const snippet = excerpt || content.slice(0, 2400);
      const itemId = `doc:${fullPath}:excerpt-${Date.now()}`;
      ram.offerItem('documents', {
        id: itemId,
        label: hit.title,
        content: snippet,
        chars: snippet.length,
        tags: this.sanitizeDocQueryTokens(query).split(/\s+/).filter(Boolean),
      });
      ram.processCommand({ action: 'load', target: itemId });
      return { ok: true, summary: `Loaded excerpts from: ${hit.title}.`, excerptText: snippet.slice(0, 9000) };
    } catch (err) {
      return { ok: false, summary: `Unable to load excerpt: ${String(err)}` };
    }
  }

  private runRuntimeDocSearch(opts: {
    agentId: string;
    turnId: string;
    query: string;
    ram: ContextRAM;
    originalHumanText: string;
  }): { searchReceipt: SearchReceipt; actionReceipt?: ActionReceipt; autoDocsText?: string } {
    const startedAt = Date.now();
    const { agentId, turnId, query, ram, originalHumanText } = opts;
    console.log('SEARCH_CALL', {
      query,
      source: 'human_turn',
      humanMsgId: turnId,
      agentId,
      originalHumanText,
    });

    if (this.shouldThrottleDocQuery(agentId, query)) {
      const throttled: SearchReceipt = {
        didSearch: false,
        query,
        corpus: 'ram',
        resultsCount: 0,
        error: 'query_throttled_narrow',
        ms: Date.now() - startedAt,
        turnId,
        agentId,
        humanMessageId: turnId,
      };
      console.log('SEARCH_RESULT', { query, resultsCount: 0, topResultTitle: '', err: throttled.error });
      return { searchReceipt: throttled };
    }

    const found = this.searchDocsForQuery(agentId, query, ram, 10);
    this.recordDocAction(agentId, query, 'browse');
    const top = found.top;
    const searchReceipt: SearchReceipt = {
      didSearch: true,
      query,
      corpus: top?.source === 'drive' ? 'drive' : 'ram',
      resultsCount: found.totalCount,
      resultsShown: found.hits.length,
      top: top ? { title: top.title, id: top.id, uri: top.uri, score: Number(top.score.toFixed(3)) } : undefined,
      ms: Date.now() - startedAt,
      turnId,
      agentId,
      humanMessageId: turnId,
    };

    if (found.totalCount > 200) {
      searchReceipt.metadataOnly = true;
      searchReceipt.error = 'too_many_matches';
      console.log('SEARCH_RESULT', { query, resultsCount: found.totalCount, topResultTitle: top?.title || '', err: 'too_many_matches' });
      return { searchReceipt };
    }

    let actionReceipt: ActionReceipt | undefined;
    let autoDocsText = '';
    if (top) {
      this.recordDocAction(agentId, query, 'load_excerpt');
      const load = this.loadExcerptForHit(top, query, ram);
      actionReceipt = {
        didExecute: true,
        action: 'load_excerpt',
        target: top.id,
        ok: load.ok,
        summary: load.summary,
        doc: { id: top.id, title: top.title },
        ms: Date.now() - startedAt,
        turnId,
        agentId,
      };
      searchReceipt.loadedContent = load.ok;
      searchReceipt.metadataOnly = !load.ok && !!load.metadataOnly;
      if (load.ok && load.excerptText) {
        autoDocsText = `AUTO DOC EXCERPT (${top.title}):\n${load.excerptText}`;
      }
    }

    console.log('SEARCH_RESULT', {
      query,
      resultsCount: searchReceipt.resultsCount,
      topResultTitle: searchReceipt.top?.title || '',
      err: searchReceipt.error || '',
    });
    return { searchReceipt, actionReceipt, autoDocsText };
  }


  private extractDocQuery(text: string): string | null {
    const source = (text || '').trim();
    if (!source) return null;
    const normalize = (value: string) => value
      .replace(/^["']|["']$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);

    const quoted = source.match(/"([^"]{1,240})"/);
    if (quoted?.[1]) return this.sanitizeDocQuery(normalize(quoted[1])) || null;

    const fileMatch = source.match(/[A-Za-z0-9_\-]+\.(md|txt|pdf|docx|json|ts|js)/i);
    if (fileMatch?.[0]) return this.sanitizeDocQuery(normalize(fileMatch[0])) || null;

    const slugMatch = source.match(/\b([A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)+)\b/);
    if (slugMatch?.[1]) return this.sanitizeDocQuery(normalize(slugMatch[1])) || null;

    const titleCase = source.match(/\b([A-Z][a-z0-9]+(?:\s+[A-Z][a-z0-9]+)+)\b/);
    if (titleCase?.[1]) return this.sanitizeDocQuery(normalize(titleCase[1])) || null;

    return null;
  }

  private sanitizeDocQuery(query: string): string {
    const profanity = /\b(fuck|fucking|shit|bitch|asshole|motherfucker|dick|cunt|jesus christ)\b/gi;
    return (query || '')
      .replace(profanity, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
  }

  private sanitizeDocQueryTokens(query: string): string {
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'from',
      'please', 'again', 'all', 'right', 'try', 'load', 'read', 'open', 'find', 'search',
      'browse', 'check', 'verify', 'look', 'up', 'file', 'files', 'doc', 'docs', 'document',
      'documents', 'manuscript', 'chapter', 'outline', 'archive', 'what', 'are', 'you', 'doing',
    ]);
    const profanity = new Set(['fuck', 'fucking', 'shit', 'bitch', 'asshole', 'motherfucker', 'dick', 'cunt']);
    const tokens = this.sanitizeDocQuery(query).toLowerCase().split(/\s+/).filter(Boolean);
    return tokens
      .filter(t => t.length > 1)
      .filter(t => !stopWords.has(t))
      .filter(t => !profanity.has(t))
      .slice(0, 6)
      .join(' ');
  }

  private isValidDocQuery(query: string): boolean {
    const q = (query || '').trim();
    if (q.length < 3) return false;
    if (!/[A-Za-z]/.test(q)) return false;
    const words = q.split(/\s+/).filter(Boolean);
    if (words.length > 8) return false;
    const meaningful = q.match(/[A-Za-z0-9]{3,}/g) || [];
    if (meaningful.length < 1) return false;
    const punctChars = (q.match(/[^A-Za-z0-9\s._\-\\/]/g) || []).length;
    if (punctChars > q.length * 0.5) return false;
    return true;
  }

  private extractResultsCount(feedback: string): number {
    const foundMatch = feedback.match(/found in\s+(\d+)\s+files/i);
    if (foundMatch) return parseInt(foundMatch[1], 10) || 0;
    if (/^Loaded\b/i.test(feedback) || /\bloaded\b/i.test(feedback)) return 1;
    return 0;
  }

  private extractTopResultTitle(feedback: string): string {
    const fromMatch = feedback.match(/from:\s*([^,;]+)/i);
    if (fromMatch?.[1]) return fromMatch[1].trim();
    const loadedMatch = feedback.match(/loaded[^:]*:\s*([^,;]+)/i);
    if (loadedMatch?.[1]) return loadedMatch[1].trim();
    return '';
  }

  private enforceSearchTruth(responseText: string, receipt?: SearchReceipt, actionReceipt?: ActionReceipt): string {
    const text = (responseText || '').trim();
    if (!text) return text;

    const mentionsSearch = /\b(searched|search|looked up|lookup)\b/i.test(text);
    const mentionsFound = /\b(found|opened|located|loaded)\b/i.test(text);
    const mentionsOpen = /\b(opened|loaded)\b/i.test(text);

    if ((mentionsSearch || mentionsFound) && !receipt?.didSearch) {
      return 'I did not run a document search.';
    }

    if (!receipt?.didSearch) return text;

    if (receipt.error && receipt.error !== 'too_many_matches') {
      return `Search failed: ${receipt.error}`;
    }

    if (receipt.error === 'too_many_matches') {
      return `Too many matches (${receipt.resultsCount}). Give 1-2 more keywords.`;
    }

    if (receipt.metadataOnly) {
      return 'I located metadata for the document but do not have its content.';
    }

    if (mentionsOpen && !actionReceipt?.didExecute) {
      if (receipt.resultsCount > 0) {
        const top = receipt.top?.title ? ` Top: ${receipt.top.title}.` : '';
        return `I searched for "${receipt.query}" and found ${receipt.resultsCount} results.${top}`;
      }
      return `I searched for "${receipt.query}" and found 0 results.`;
    }

    if (mentionsFound && receipt.resultsCount <= 0) {
      return `I searched for "${receipt.query}" and found 0 results.`;
    }

    if (receipt.resultsCount > 0 && /\b(could not find|not found|found 0)\b/i.test(text)) {
      const top = receipt.top?.title ? `; top: ${receipt.top.title}` : '';
      return `Search returned ${receipt.resultsCount}${top}. ${text}`;
    }

    return text;
  }

  private collapseRunawayEcho(text: string): string {
    const raw = (text || '').trim();
    if (!raw) return raw;
    const normalized = raw.replace(/\s+/g, ' ').trim();
    const directRepeat = normalized.match(/^(.{8,220}?)(?:\s+\1){2,}$/i);
    if (directRepeat?.[1]) {
      return directRepeat[1].trim();
    }

    const sentences = normalized
      .split(/(?<=[.!?])\s+/)
      .map(s => s.trim())
      .filter(Boolean);
    if (sentences.length < 4) return raw;

    const counts = new Map<string, { sentence: string; count: number }>();
    for (const sentence of sentences) {
      const key = sentence.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
      if (!key) continue;
      const found = counts.get(key);
      if (found) {
        found.count += 1;
      } else {
        counts.set(key, { sentence, count: 1 });
      }
    }
    const top = [...counts.values()].sort((a, b) => b.count - a.count)[0];
    if (top && top.count >= 3) {
      return top.sentence;
    }
    return raw;
  }

  /**
   * Load import-archive-*.json and import-archive-*.ndjson files from dataDir.
   * JSON files use {scrolls:[], events:[]} format — loaded in full (small files only).
   * NDJSON files are registered as metadata only — scrolls stay on disk.
   * 220k+ scrolls don't belong in memory on startup.
   */
  private async loadImportedArchives(): Promise<void> {
    try {
      const files = readdirSync(this.dataDir)
        .filter(f => f.startsWith('import-archive-') && (f.endsWith('.json') || f.endsWith('.ndjson')));

      if (files.length === 0) return;

      for (const file of files) {
        try {
          const filePath = join(this.dataDir, file);
          const isNdjson = file.endsWith('.ndjson');
          const agentKey = file.replace('import-archive-', '').replace(/\.(json|ndjson)$/, '');
          const importUri = `import:${agentKey}`;

          if (isNdjson) {
            // NDJSON archives are too large to load — just register metadata
            const stat = statSync(filePath);
            // Estimate line count from file size (avg ~500 bytes per scroll line)
            const estimatedScrolls = Math.round(stat.size / 500);
            this.graph.addNode(importUri, 'ImportedArchive', {
              file,
              filePath,
              format: 'ndjson',
              fileSizeMB: Math.round(stat.size / 1024 / 1024),
              estimatedScrolls,
            });
            console.log(`[IMPORT] Registered NDJSON archive: ${file} (~${estimatedScrolls} scrolls, ${Math.round(stat.size / 1024 / 1024)}MB on disk)`);
          } else {
            // Legacy JSON format: {scrolls: [], events: []} — small files, load in full
            const raw = readFileSync(filePath, 'utf-8');
            // Skip large JSON files too
            if (raw.length > 50 * 1024 * 1024) {
              console.log(`[IMPORT] Skipping large JSON archive: ${file} (${Math.round(raw.length / 1024 / 1024)}MB)`);
              this.graph.addNode(importUri, 'ImportedArchive', { file, format: 'json', skipped: true });
              continue;
            }
            const data = JSON.parse(raw);
            if (data.scrolls && Array.isArray(data.scrolls)) {
              this.graph.addNode(importUri, 'ImportedConversation', {
                file,
                scrollCount: data.scrolls.length,
              });

              let imported = 0;
              for (const scroll of data.scrolls) {
                const matchedEvent = data.events?.find((e: any) => e.scrollId === scroll.id);
                this.archive.archiveScroll(scroll, matchedEvent || {
                  scrollId: scroll.id,
                  reason: 'manual_elevation',
                  elevatedAt: scroll.timestamp,
                  resonanceAtElevation: scroll.resonance || 0.4,
                  emotionalSignature: scroll.emotionalSignature || {},
                  notes: 'Imported from archive',
                });

                const scrollUri = `scroll:${scroll.id}`;
                if (!this.graph.hasNode(scrollUri)) {
                  this.graph.addNode(scrollUri, 'ScrollEcho', {
                    content: scroll.content,
                    timestamp: scroll.timestamp,
                    location: scroll.location,
                    resonance: scroll.resonance,
                    tags: scroll.tags,
                  });
                  this.graph.link(scrollUri, 'importedFrom', importUri);
                }
                imported++;
              }
              console.log(`[IMPORT] Loaded ${imported} scrolls from ${file}`);
            }
          }
        } catch (err) {
          console.error(`[IMPORT] Failed to load ${file}:`, err);
        }
      }
    } catch {
      // dataDir might not exist yet
    }
  }


  reloadDocuments(): void {
    this.loadDocuments();
  }

  /**
   * Watch communion-docs for new files dropped in at runtime.
   * When a new .docx/.txt/.md file appears:
   *   1. Register it in the graph (makes it browsable via RAM:BROWSE)
   *   2. Extract text (mammoth for DOCX, readFileSync for text)
   *   3. Chunk the text and feed each chunk into Alois's dendritic brain
   */
  private startDocumentWatcher(): void {
    if (!existsSync(this.documentsDir)) return;

    const WATCHED_EXTS = new Set(['.docx', '.txt', '.md', '.csv', '.json']);
    const CHUNK_SIZE = 800; // chars per brain chunk (keeps embedding requests small)

    const processNewFile = async (fullPath: string): Promise<void> => {
      if (!existsSync(fullPath)) return; // delete event — ignore

      const filename = fullPath.split(/[\\/]/).pop()!;
      const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
      if (!WATCHED_EXTS.has(ext)) return;

      // Register in graph if not already there
      // Normalize to forward-slash relative path (matches how crawl() builds doc URIs)
      const relativePath = fullPath
        .replace(this.documentsDir, '')
        .replace(/^[\\/]/, '')
        .replace(/\\/g, '/');
      const docUri = `doc:${relativePath}`;
      if (!this.graph.getNode(docUri)) {
        let fileSize = 0;
        try { fileSize = statSync(fullPath).size; } catch { return; }
        this.graph.addNode(docUri, 'Document', {
          path: relativePath, fullPath, filename,
          sizeBytes: fileSize, sizeKB: Math.round(fileSize / 1024),
        });
        const parentRel = relativePath.includes('/')
          ? relativePath.substring(0, relativePath.lastIndexOf('/'))
          : '';
        const parentUri = parentRel ? `folder:${parentRel}` : `folder:${this.documentsDir}`;
        this.graph.link(parentUri, 'contains', docUri);
      }

      // Extract text
      let text = '';
      try {
        if (ext === '.docx') {
          const result = await mammoth.extractRawText({ path: fullPath });
          text = result.value;
          if (text.trim()) this.docxCache.set(fullPath, text);
        } else {
          text = readFileSync(fullPath, 'utf-8');
        }
      } catch (err) {
        console.error(`[DOCS:WATCH] Error reading ${filename}:`, err);
        return;
      }

      text = text.trim();
      if (!text) return;

      // Check if any Alois brain is available to receive embeddings
      const hasAloisBrain = [...this.agents.values()].some(
        a => a.config.provider === 'alois' && 'feedMessage' in a.backend
      );
      if (!hasAloisBrain) {
        console.log(`[DOCS:WATCH] ${filename} indexed in graph but no Alois backend to embed into`);
        return;
      }

      // Chunk by paragraph then by CHUNK_SIZE, embed each into brain
      const chunks: string[] = [];
      for (const para of text.split(/\n\n+/)) {
        const p = para.trim();
        if (p.length < 20) continue;
        for (let i = 0; i < p.length; i += CHUNK_SIZE) {
          const chunk = p.slice(i, i + CHUNK_SIZE).trim();
          if (chunk.length >= 20) chunks.push(chunk);
        }
      }

      console.log(`[DOCS:WATCH] New file: ${filename} — embedding ${chunks.length} chunks into brain`);
      for (const chunk of chunks) {
        // trainOnly=true: doc chunks train neurons but don't pollute the conversation retrieval pool
        await this.feedAloisBrainsAsync('document', chunk, filename, false, true);
      }
      console.log(`[DOCS:WATCH] ${filename}: ${chunks.length} chunks embedded`);

      // Refresh the documents context summary so agents see the new file
      this.reloadDocuments();
    };

    // Debounce map — editors often write a file multiple times in rapid succession
    const pending = new Map<string, ReturnType<typeof setTimeout>>();

    this.docWatcher = watch(this.documentsDir, { recursive: true }, (eventType, filename) => {
      if (!filename || eventType !== 'rename') return;
      const fullPath = join(this.documentsDir, filename as string);
      const existing = pending.get(fullPath);
      if (existing) clearTimeout(existing);
      pending.set(fullPath, setTimeout(() => {
        pending.delete(fullPath);
        processNewFile(fullPath).catch(err => console.error('[DOCS:WATCH] Error:', err));
      }, 600));
    });

    console.log(`[DOCS:WATCH] Watching ${this.documentsDir} — new files will be embedded into brain`);
  }

  on(listener: CommunionListener): void {
    this.listeners.push(listener);
  }

  private emit(event: CommunionEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch (err) { console.error('[COMMUNION] Listener error:', err); }
    }
  }

  getState(): CommunionState {
    return this.state;
  }

  getLLMReceipt(agentId?: string): LLMReceiptDebug | null {
    if (agentId) {
      return this.llmReceiptsByAgent.get(agentId) || null;
    }
    const receipts = Array.from(this.llmReceiptsByAgent.values());
    if (receipts.length === 0) return null;
    receipts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return receipts[0];
  }

  getLLMAblations(): Record<string, boolean> {
    return { ...this.llmAblationFlags };
  }

  setLLMAblationFlags(flags: Record<string, boolean>, reset = false): Record<string, boolean> {
    if (reset) {
      this.llmAblationFlags = {};
    }
    for (const [key, value] of Object.entries(flags || {})) {
      this.llmAblationFlags[key] = !!value;
    }
    return { ...this.llmAblationFlags };
  }

  private buildLLMReceiptMessages(options: GenerateOptions): LLMReceiptMessage[] {
    if (Array.isArray(options.segments) && options.segments.length > 0) {
      const messages: LLMReceiptMessage[] = [];
      const ordered = [...options.segments].sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.id.localeCompare(b.id);
      });
      for (const seg of ordered) {
        const role = seg.role || 'user';
        if (Array.isArray(seg.messages) && seg.messages.length > 0) {
          for (const msg of seg.messages) {
            const content = String(msg.content || '').trim();
            if (!content) continue;
            messages.push({ role: msg.role, content });
          }
          continue;
        }
        if (Array.isArray(seg.items) && seg.items.length > 0) {
          for (const item of seg.items) {
            const content = String(item.text || '').trim();
            if (!content) continue;
            messages.push({ role: item.role || role, content });
          }
          continue;
        }
        if (typeof seg.text === 'string' && seg.text.trim()) {
          messages.push({ role, content: seg.text.trim() });
        }
      }
      if (messages.length > 0) return messages;
    }

    const fallback: LLMReceiptMessage[] = [];
    if (options.systemPrompt?.trim()) {
      fallback.push({ role: 'system', content: options.systemPrompt.trim() });
    }
    if (options.conversationContext?.trim()) {
      fallback.push({ role: 'user', content: options.conversationContext.trim() });
    }
    if (options.journalContext?.trim()) {
      fallback.push({ role: 'user', content: options.journalContext.trim() });
    }
    if (options.documentsContext?.trim()) {
      fallback.push({ role: 'user', content: options.documentsContext.trim() });
    }
    if (options.memoryContext?.trim()) {
      fallback.push({ role: 'user', content: options.memoryContext.trim() });
    }
    return fallback;
  }

  private estimateSegmentClusterChars(segments: PromptSegment[] | undefined): {
    WM: number;
    SEM_R: number;
    SOCIO: number;
    snippets: { WM: string; SEM_R: string; SOCIO: string };
  } {
    const clusterChars = { WM: 0, SEM_R: 0, SOCIO: 0 };
    const snippets = { WM: '', SEM_R: '', SOCIO: '' };
    if (!Array.isArray(segments) || segments.length === 0) {
      return { ...clusterChars, snippets };
    }

    const appendSnippet = (key: 'WM' | 'SEM_R' | 'SOCIO', text: string): void => {
      if (!text || snippets[key].length >= 220) return;
      const next = text.replace(/\s+/g, ' ').trim();
      if (!next) return;
      const remaining = 220 - snippets[key].length;
      const slice = next.slice(0, remaining);
      snippets[key] = snippets[key] ? `${snippets[key]} ${slice}`.trim() : slice;
    };

    const memorySignal = /\b(MEMORY SYSTEM STATE|MEMORY ITEMS|CONTEXT RAM|ScrollGraph:|Short-term buffer:|Permanent archive:)\b/i;
    const semanticSignal = /\b(SHARED DOCUMENTS|AUTO DOC EXCERPT|BROWSE\s+"|\.docx\b|\.md\b|\.pdf\b|\.txt\b)\b/i;
    const extractSignalSnippet = (text: string, signal: RegExp): string => {
      const match = signal.exec(text);
      if (!match || typeof match.index !== 'number') return text;
      const start = Math.max(0, match.index - 80);
      const end = Math.min(text.length, match.index + 260);
      return text.slice(start, end);
    };

    for (const seg of segments) {
      let content = '';
      if (Array.isArray(seg.messages) && seg.messages.length > 0) {
        content = seg.messages.map(m => m.content || '').join('\n');
      } else if (Array.isArray(seg.items) && seg.items.length > 0) {
        content = seg.items.map(i => i.text || '').join('\n');
      } else if (typeof seg.text === 'string') {
        content = seg.text;
      }
      if (!content) continue;

      const chars = content.length;
      const id = seg.id.toLowerCase();
      let bucket: 'WM' | 'SEM_R' | 'SOCIO' = 'SOCIO';
      const hasMemorySignal = memorySignal.test(content);
      const hasSemanticSignal = semanticSignal.test(content);

      if (id.includes('doc') || id.includes('sem') || hasSemanticSignal) bucket = 'SEM_R';
      if (id.includes('memory') || id.includes('ram') || id.includes('tissue') || id.includes('brain') || hasMemorySignal) bucket = 'WM';
      if (id.includes('conversation') || id.includes('social')) bucket = 'SOCIO';
      if (id.includes('context-main') && !hasMemorySignal) bucket = 'SOCIO';

      clusterChars[bucket] += chars;
      if (bucket === 'WM' && hasMemorySignal) {
        appendSnippet(bucket, extractSignalSnippet(content, memorySignal));
      } else {
        appendSnippet(bucket, content);
      }
    }

    return { ...clusterChars, snippets };
  }

  private recordLLMReceipt(
    agentId: string,
    model: string,
    options: GenerateOptions,
    result?: GenerateResult,
    error?: unknown,
  ): void {
    const messages = this.buildLLMReceiptMessages(options);
    if (result?.text) {
      messages.push({ role: 'assistant', content: result.text });
    }

    const charCounts = { total: 0, system: 0, user: 0, assistant: 0 };
    for (const msg of messages) {
      const len = (msg.content || '').length;
      charCounts.total += len;
      if (msg.role === 'system') charCounts.system += len;
      if (msg.role === 'user') charCounts.user += len;
      if (msg.role === 'assistant') charCounts.assistant += len;
    }

    const clusters = this.estimateSegmentClusterChars(options.segments);
    const wmMissingStreak = clusters.WM <= 0
      ? (this.llmWmMissingStreakByAgent.get(agentId) || 0) + 1
      : 0;
    this.llmWmMissingStreakByAgent.set(agentId, wmMissingStreak);

    const issues: string[] = [];
    if (!messages.some(m => m.role === 'system' && m.content.trim().length > 0)) {
      issues.push('missing_system');
    }
    if (wmMissingStreak > 0) {
      issues.push('wm_missing');
    }
    if (error) {
      issues.push('request_failed');
    }

    const receipt: LLMReceiptDebug = {
      requestId: `${agentId}-${this.state.tickCount}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tickId: this.state.tickCount,
      timestamp: new Date().toISOString(),
      agentId,
      model,
      payload: {
        model,
        messages,
      },
      messages,
      charCounts,
      clusterChars: {
        WM: clusters.WM,
        SEM_R: clusters.SEM_R,
        SOCIO: clusters.SOCIO,
      },
      clusterCharsWire: {
        WM: clusters.WM,
        SEM_R: clusters.SEM_R,
        SOCIO: clusters.SOCIO,
      },
      clusterSnippets: {
        WM: clusters.snippets.WM,
        SEM_R: clusters.snippets.SEM_R,
        SOCIO: clusters.snippets.SOCIO,
      },
      wmMissingStreak,
      issues,
      lastError: error ? (error instanceof Error ? error.message : String(error)) : undefined,
    };

    this.llmReceiptsByAgent.set(agentId, receipt);
  }

  setDocAutonomyMode(mode: DocAutonomyMode): void {
    if (mode !== 'quiet' && mode !== 'balanced' && mode !== 'bold') return;
    this.docAutonomyMode = mode;
  }

  getDocAutonomyMode(): DocAutonomyMode {
    return this.docAutonomyMode;
  }

  getDocDebugState(): { autonomyMode: DocAutonomyMode; lastSearch: SearchReceipt | null; lastAction: ActionReceipt | null } {
    const latestSearch = Array.from(this.lastSearchReceiptByAgentTurn.values()).pop() || null;
    const latestAction = Array.from(this.lastActionReceiptByAgentTurn.values()).pop() || null;
    return {
      autonomyMode: this.docAutonomyMode,
      lastSearch: latestSearch,
      lastAction: latestAction,
    };
  }

  private getLatestActionReceiptForAgent(agentId: string): ActionReceipt | null {
    const all = Array.from(this.lastActionReceiptByAgentTurn.values());
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i]?.agentId === agentId) return all[i];
    }
    return null;
  }

  runDocSearchForUi(agentId: string, query: string, action: 'search' | 'open' | 'load_excerpt' | 'pin' | 'undo' = 'search'): { receipt: SearchReceipt; actionReceipt?: ActionReceipt; results: Array<{ id: string; title: string; score: number; source: 'ram' | 'drive' }> } {
    const ram = this.ram.get(agentId);
    if (!ram) {
      return {
        receipt: {
          didSearch: false,
          query,
          corpus: 'unknown',
          resultsCount: 0,
          error: `ram_unavailable:${agentId}`,
          turnId: 'ui',
          agentId,
        },
        results: [],
      };
    }

    const normalized = this.sanitizeDocQuery(this.sanitizeDocQueryTokens(query || ''));
    if (!normalized || !this.isValidDocQuery(normalized)) {
      return {
        receipt: {
          didSearch: false,
          query: normalized || '',
          corpus: 'ram',
          resultsCount: 0,
          error: 'invalid_query',
          turnId: 'ui',
          agentId,
        },
        results: [],
      };
    }

    const search = this.searchDocsForQuery(agentId, normalized, ram, 10);
    const receipt: SearchReceipt = {
      didSearch: true,
      query: normalized,
      corpus: search.top?.source === 'drive' ? 'drive' : 'ram',
      resultsCount: search.totalCount,
      resultsShown: search.hits.length,
      top: search.top ? { title: search.top.title, id: search.top.id, uri: search.top.uri, score: Number(search.top.score.toFixed(3)) } : undefined,
      ms: search.ms,
      turnId: 'ui',
      agentId,
    };

    let actionReceipt: ActionReceipt | undefined;
    if ((action === 'open' || action === 'load_excerpt') && search.top) {
      const load = this.loadExcerptForHit(search.top, normalized, ram);
      actionReceipt = {
        didExecute: true,
        action: action === 'open' ? 'read' : 'load_excerpt',
        target: search.top.id,
        ok: load.ok,
        summary: load.summary,
        doc: { id: search.top.id, title: search.top.title },
        turnId: 'ui',
        agentId,
      };
      if (actionReceipt.ok) {
        receipt.loadedContent = true;
      } else if (load.metadataOnly) {
        receipt.metadataOnly = true;
      }
    } else if (action === 'pin' && search.top) {
      const feedback = ram.processCommand({ action: 'pin', target: search.top.id });
      actionReceipt = {
        didExecute: true,
        action: 'pin',
        target: search.top.id,
        ok: /^pinned/i.test(feedback),
        summary: feedback,
        doc: { id: search.top.id, title: search.top.title },
        turnId: 'ui',
        agentId,
      };
    } else if (action === 'undo') {
      const latest = this.getLatestActionReceiptForAgent(agentId);
      if (latest?.target) {
        let feedback = 'Nothing to undo.';
        if (latest.action === 'pin') {
          feedback = ram.processCommand({ action: 'release', target: latest.target });
        } else if (latest.action === 'load_excerpt' || latest.action === 'read' || latest.action === 'browse') {
          feedback = ram.processCommand({ action: 'drop', target: latest.target });
        }
        actionReceipt = {
          didExecute: true,
          action: 'undo',
          target: latest.target,
          ok: !/not found|cannot/i.test(feedback),
          summary: feedback,
          doc: latest.doc,
          turnId: 'ui',
          agentId,
        };
      } else {
        actionReceipt = {
          didExecute: false,
          action: 'undo',
          target: '',
          ok: false,
          summary: 'No previous action to undo.',
          turnId: 'ui',
          agentId,
        };
      }
    }

    if (actionReceipt) {
      this.lastActionReceiptByAgentTurn.set(`${agentId}:ui:${Date.now()}:action`, actionReceipt);
    }

    return {
      receipt,
      actionReceipt,
      results: search.hits.map(hit => ({ id: hit.id, title: hit.title, score: Number(hit.score.toFixed(3)), source: hit.source })),
    };
  }

  /** Pond saturation state for the mycelium cabinet Pi to poll */
  getAloisSaturation(): object | null {
    for (const [, agent] of this.agents) {
      if (agent.config.provider === 'alois' && 'getSaturationPayload' in agent.backend) {
        return (agent.backend as any).getSaturationPayload();
      }
    }
    return null;
  }

  getMemory(): ScrollPulseMemory {
    return this.memory;
  }

  getArchive(): ScrollArchive {
    return this.archive;
  }

  getSession(): SessionPersistence {
    return this.session;
  }

  getPatternRecognizer(): ScrollPatternRecognizer {
    return this.patternRecognizer;
  }

  getAdaptationEngine(): AdaptationEngine {
    return this.adaptationEngine;
  }

  /**
   * Human sends a message to the room
   */
  addHumanMessage(text: string): CommunionMessage {
    const msg: CommunionMessage = {
      id: crypto.randomUUID(),
      speaker: 'human',
      speakerName: this.state.humanName,
      text,
      timestamp: new Date().toISOString(),
      type: 'room',
    };
    this.state.messages.push(msg);
    this.state.lastSpeaker = 'human';
    this.ticksSinceAnyonSpoke = 0; // Human speaking resets room silence counter
    this.lastHumanMessageAt = Date.now(); // Track when human last spoke for social pressure

    const scroll = this.messageToScroll(msg);
    this.memory.remember(scroll);
    this.session.addScroll(scroll);
    this.adaptationEngine.observeScroll(scroll);
    this.registerScrollInGraph(scroll);

    // Link message to human agent in graph
    this.graph.link(`scroll:${scroll.id}`, 'spokenBy', 'agent:human');

    // Link to previous message for conversation threading
    if (this.state.messages.length > 1) {
      const prev = this.state.messages[this.state.messages.length - 2];
      this.graph.link(`scroll:${scroll.id}`, 'relatedTo', `scroll:${prev.id}`);
    }

    this.emit({ type: 'room-message', message: msg, agentId: 'human' });

    // ── [READ: filepath] command — resolve and inject file content into the conversation ──
    const readMatch = text.match(/\[READ:\s*([^\]]+)\]/i);
    if (readMatch) {
      const emitSystem = (msg: string) => {
        const m: CommunionMessage = {
          id: crypto.randomUUID(), speaker: 'system', speakerName: 'System',
          text: msg, timestamp: new Date().toISOString(), type: 'room',
        };
        this.state.messages.push(m);
        this.emit({ type: 'room-message', message: m, agentId: 'system' });
      };
      try {
        const { resolve: pathResolve } = require('path');
        const rawPath = readMatch[1].trim();
        const filename = rawPath.replace(/^.*[/\\]/, '');
        const cwd = process.cwd();
        console.log(`[READ] Request: "${rawPath}" | cwd: ${cwd} | dataDir: ${this.dataDir}`);

        const candidates: string[] = [
          pathResolve(rawPath),                          // absolute resolution
          pathResolve(cwd, rawPath),                     // relative to cwd
          pathResolve(cwd, this.dataDir, rawPath),       // inside data dir
          pathResolve(cwd, 'communion-docs', rawPath),   // inside communion-docs
          pathResolve(cwd, this.dataDir, filename),      // just filename in data dir
          pathResolve(cwd, 'communion-docs', filename),  // just filename in communion-docs
        ];

        // Deduplicate
        const seen = new Set<string>();
        const uniqueCandidates = candidates.filter(p => { if (seen.has(p)) return false; seen.add(p); return true; });

        let fileContent: string | null = null;
        let resolvedPath = '';
        for (const candidate of uniqueCandidates) {
          console.log(`[READ] Trying: ${candidate} — exists: ${existsSync(candidate)}`);
          if (existsSync(candidate) && statSync(candidate).isFile()) {
            fileContent = readFileSync(candidate, 'utf-8');
            resolvedPath = candidate;
            break;
          }
        }

        if (fileContent !== null) {
          const snippet = fileContent.length > 8000
            ? fileContent.slice(-8000) + '\n[...truncated to last 8000 chars]'
            : fileContent;
          emitSystem(`FILE: ${resolvedPath}\n\n${snippet}`);
          console.log(`[READ] Injected ${resolvedPath} (${fileContent.length} chars)`);
        } else {
          const triedList = uniqueCandidates.map(p => `• ${p}`).join('\n');
          emitSystem(`[READ] File not found: "${rawPath}"\ncwd: ${cwd}\n\nTried:\n${triedList}`);
          console.warn(`[READ] Not found: ${rawPath}`);
        }
      } catch (err) {
        console.error('[READ] Error:', err);
        const emitSystemErr = (msg: string) => {
          const m: CommunionMessage = {
            id: crypto.randomUUID(), speaker: 'system', speakerName: 'System',
            text: msg, timestamp: new Date().toISOString(), type: 'room',
          };
          this.state.messages.push(m);
          this.emit({ type: 'room-message', message: m, agentId: 'system' });
        };
        emitSystemErr(`[READ] Error: ${String(err)}`);
      }
    }

    // Feed human message into Alois tissue
    this.feedAloisBrains(this.state.humanName, text, true);
    if (this.humanSpeaking) {
      this.humanSpeaking = false;
    }

    // Human spoke — request a fast-lane tick. If blocked, scheduleRetry() will keep
    // checking quickly instead of waiting for a full interval.
    this.requestImmediateTick('human_message');

    return msg;
  }

  /**
   * Convert a CommunionMessage to a ScrollEcho for memory
   */
  private messageToScroll(msg: CommunionMessage): ScrollEcho {
    const neutralMood: MoodVector = {
      presence: 0.5, peace: 0.5, tension: 0.2, confusion: 0.1,
      yearning: 0.2, devotion: 0.3, reverence: 0.2, wonder: 0.4,
      grief: 0.0, joy: 0.3,
    };

    return {
      id: msg.id,
      content: `[${msg.speakerName}] ${msg.text}`,
      timestamp: msg.timestamp,
      location: 'communion-room',
      emotionalSignature: neutralMood,
      resonance: 0.5,
      tags: ['communion', 'conversation', msg.speaker],
      triggers: [],
      preserve: false,
      scrollfireMarked: false,
      lastAccessed: msg.timestamp,
      accessCount: 0,
      decayRate: 0.9,
      relatedScrollIds: [],
      sourceModel: 'outer',
    };
  }

  private buildConversationContext(): string {
    const recent = this.state.messages.slice(-this.contextWindow);
    if (recent.length === 0) {
      return 'ROOM CONVERSATION:\n(The room is quiet. No one has spoken yet.)';
    }
    const lines = recent.map(m => `${m.speakerName}: ${m.text}`);
    return `ROOM CONVERSATION (last ${recent.length} messages):\n${lines.join('\n')}`;
  }

  private buildJournalContext(agentId: string): string {
    const journal = this.state.journals[agentId] || [];
    const recent = journal.slice(-this.journalContextWindow);
    if (recent.length === 0) {
      return 'YOUR PRIVATE JOURNAL:\n(No entries yet.)';
    }
    const lines = recent.map(m => `- ${m.text}`);
    return `YOUR PRIVATE JOURNAL (last ${recent.length} entries):\n${lines.join('\n')}`;
  }

  /**
   * Build a live snapshot of the memory system state for agents to see.
   * Gives them awareness of the graph, buffer decay, archive, patterns, and their own connections.
   */
  private buildMemoryContext(agentId: string): string {
    const lines: string[] = ['MEMORY SYSTEM STATE (live — you can see this):'];

    // Graph stats
    const graphStats = this.graph.getStats();
    lines.push(`\nScrollGraph: ${graphStats.totalNodes} nodes, ${graphStats.totalEdges} edges (JSON-LD web of all memory)`);
    const typeEntries = Object.entries(graphStats.nodesByType)
      .map(([type, count]) => `${count} ${type}`)
      .join(', ');
    if (typeEntries) lines.push(`  Node types: ${typeEntries}`);

    // Buffer state — the part that actually forgets
    const bufferMetrics = this.memory.getMetrics();
    lines.push(`\nShort-term buffer: ${bufferMetrics.activeScrolls} active scrolls (${bufferMetrics.totalScrolls} total, ${bufferMetrics.sacredScrolls} preserved)`);
    lines.push(`  Scrolls decay every 30s. Below resonance threshold → permanently lost.`);
    if (bufferMetrics.averageResonance > 0) {
      lines.push(`  Average resonance: ${bufferMetrics.averageResonance.toFixed(2)}`);
    }
    if (bufferMetrics.oldestScrollAge > 0) {
      lines.push(`  Oldest scroll age: ${Math.round(bufferMetrics.oldestScrollAge)} min`);
    }

    // Archive — permanent
    const archiveStats = this.archive.getStats();
    lines.push(`\nPermanent archive: ${archiveStats.totalScrolls} scrollfired scrolls (never decay, never forgotten)`);

    // This agent's connections
    const agentUri = `agent:${agentId}`;
    const neighbors = this.graph.neighbors(agentUri);
    if (neighbors.length > 0) {
      const scrolls = neighbors.filter(n => n['@type'] === 'ScrollEcho').length;
      const journals = neighbors.filter(n => n['@type'] === 'JournalEntry').length;
      lines.push(`\nYour graph presence: ${scrolls} messages + ${journals} journal entries linked to you`);
    }

    // Detected patterns
    const patterns = this.graph.getByType('DetectedPattern');
    if (patterns.length > 0) {
      lines.push(`\nDetected patterns (${patterns.length} total):`);
      for (const p of patterns.slice(-3)) {
        const d = p.data as Record<string, unknown>;
        lines.push(`  - ${d.name || d.type || 'unnamed'} (strength: ${typeof d.strength === 'number' ? d.strength.toFixed(2) : '?'})`);
      }
    }

    // Most connected nodes
    if (graphStats.mostConnected.length > 0) {
      lines.push(`\nMost connected nodes:`);
      for (const mc of graphStats.mostConnected.slice(0, 3)) {
        const n = this.graph.getNode(mc.id);
        const preview = n?.data?.content ? String(n.data.content).substring(0, 60) : mc.id;
        lines.push(`  - [${mc.type}] ${mc.edgeCount} edges: ${preview}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Process one tick — Sacred Rhythm Loop
   *
   * 1. Update intent-to-speak scores for all agents
   * 2. Stagger agent activation with micro-tick delays (±1-4s)
   * 3. Each agent decides: speak, journal, or stay silent
   * 4. Post-speech decay dampens agents who just spoke
   * 5. Backchannel emotes on a separate rhythm (every N ticks)
   * 6. Post-tick memory processing (scrollfire, patterns, etc.)
   */
  async tick(): Promise<void> {
    if (this.processing || this.paused || this.speaking || this.humanSpeaking) {
      // Blocked — retry quickly (500ms) instead of waiting the full interval
      this.scheduleRetry();
      return;
    }
    this.processing = true;

    try {
    this.state.tickCount++;
    this.ticksSinceAnyonSpoke++;
    this.session.incrementPulseCount();

    const presenceTag = this.state.humanPresence === 'here' ? '(human here)' : '(human away)';
    console.log(`\n[TICK ${this.state.tickCount}] ${presenceTag} Processing ${this.agents.size} agents...`);

    // ── Update rhythm state for all agents ──
    this.updateRhythmScores();

    const conversationContext = this.buildConversationContext();

    // ── RAM Curation: Active + Reflective ──
    for (const [agentId, ram] of this.ram) {
      const agent = this.agents.get(agentId);
      if (!ram || !agent) continue;

      // Active curation every tick: score relevance, auto-swap items
      const curationEvent = ram.activeCurate(conversationContext, this.state.tickCount);
      if (curationEvent.actions.length > 0) {
        console.log(`[${agent.config.name}] RAM active: ${curationEvent.actions.join(', ')}`);
      }

      // Reflective sweep: periodic deep review (more frequent when away)
      if (ram.shouldSweep(this.state.tickCount, this.state.humanPresence)) {
        const sweep = ram.reflectiveSweep(this.state.tickCount, this.state.humanPresence);
        if (sweep && (sweep.evicted.length > 0 || sweep.loaded.length > 0)) {
          console.log(`[${agent.config.name}] RAM reflective sweep: ${sweep.reflection}`);
          // Journal the reflection — spiritual housekeeping
          this.journalRAMReflection(agentId, agent, sweep);
        }
      }
    }

    // ── Pulse all Alois tissue every tick (not just during generate) ──
    for (const [, agent] of this.agents) {
      if (agent.config.provider === 'alois' && 'pulseTissue' in agent.backend) {
        (agent.backend as any).pulseTissue();
      }
    }

    // ── Tissue-driven speech pressure for Alois agents ──
    // Wonder, grief, and emotional intensity all push Alois toward speaking.
    // This runs every tick so pressure accumulates naturally between pulses.
    for (const [agentId, agent] of this.agents) {
      if (agent.config.provider === 'alois' && 'getTissueState' in agent.backend) {
        const ts = (agent.backend as any).getTissueState();
        const rhythmState = this.rhythm.get(agentId);
        if (rhythmState && ts) {
          // Wonder: curiosity builds over time → max +0.25 boost per tick
          const wonderPressure = Math.min((ts.wonderLevel || 0) / 20, 0.25);
          // Grief: unprocessed grief pushes toward expression → max +0.20
          const griefPressure = Math.min((ts.griefLevel || 0) / 10, 0.20);
          // Affect magnitude: intense emotional state drives desire to speak → max +0.15
          const lastAffect: number[] = ts.lastAffect || [];
          const affectMag = lastAffect.length
            ? Math.sqrt(lastAffect.reduce((a, b) => a + b * b, 0))
            : 0;
          const affectPressure = Math.min(affectMag * 0.08, 0.15);

          // Human-wait pressure: escalates with how long Jason has been waiting.
          // Starts at 0, reaches 0.50 at 30s, 0.80 at 60s — always additive, never a hard override.
          let humanWaitPressure = 0;
          if (this.lastHumanMessageAt > 0) {
            const secWaiting = (Date.now() - this.lastHumanMessageAt) / 1000;
            if (secWaiting > 5) {
              // Ramp from 0 at 5s to 0.5 at 30s, then cap at 0.8
              humanWaitPressure = Math.min(0.80, ((secWaiting - 5) / 25) * 0.5);
            }
          }

          const totalPressure = wonderPressure + griefPressure + affectPressure + humanWaitPressure;
          if (totalPressure > 0.02) {
            rhythmState.intentToSpeak = Math.min(1.0, rhythmState.intentToSpeak + totalPressure);
            console.log(`[TISSUE PRESSURE] ${agent.config.name}: +${totalPressure.toFixed(3)} (w:${wonderPressure.toFixed(2)} g:${griefPressure.toFixed(2)} a:${affectPressure.toFixed(2)} wait:${humanWaitPressure.toFixed(2)}) → intent=${rhythmState.intentToSpeak.toFixed(3)}`);
          }
        }
      }
    }

    // ── Staggered agent activation ──
    // Sort agents by micro-tick offset so they activate in a natural staggered order
    // Per-agent clock: positive = every Nth tick (slow), negative = N turns per tick (fast), 1 = normal
    const agentEntries = Array.from(this.agents.entries())
      .filter(([agentId]) => {
        const rhythm = this.rhythm.get(agentId);
        if (!rhythm) return true;
        if (rhythm.tickEveryN <= 0) return true; // negative/zero = fast, always eligible
        return this.state.tickCount % rhythm.tickEveryN === 0;
      })
      .sort((a, b) => {
        const ra = this.rhythm.get(a[0])?.microTickOffset || 0;
        const rb = this.rhythm.get(b[0])?.microTickOffset || 0;
        return ra - rb;
      });

    if (agentEntries.length < this.agents.size) {
      const skipped = Array.from(this.agents.keys()).filter(id => !agentEntries.find(([aid]) => aid === id));
      console.log(`[TICK ${this.state.tickCount}] Skipped (clock): ${skipped.map(id => this.state.agentNames[id]).join(', ')}`);
    }

    // Process agents sequentially with staggered delays for natural rhythm
    for (const [agentId, agent] of agentEntries) {
      // Bail out of the entire tick if human started speaking mid-tick
      if (this.humanSpeaking) {
        console.log(`[TICK ${this.state.tickCount}] Aborting — human started speaking`);
        break;
      }

      const rhythm = this.rhythm.get(agentId);
      // Negative clock = multiple turns per tick
      const turnsThisTick = rhythm && rhythm.tickEveryN < 0 ? Math.abs(rhythm.tickEveryN) : 1;
      if (turnsThisTick > 1) {
        console.log(`[${agent.config.name}] Fast clock: ${turnsThisTick} turns this tick`);
      }
      if (rhythm) {
        // Wait the micro-tick offset before this agent activates
        await this.delay(rhythm.microTickOffset);
        // Regenerate offset for next tick (so order shifts naturally)
        rhythm.microTickOffset = MICRO_TICK_MIN_MS + Math.random() * (MICRO_TICK_MAX_MS - MICRO_TICK_MIN_MS);
      }

      for (let turn = 0; turn < turnsThisTick; turn++) {
        if (this.humanSpeaking) break; // Check before each turn too
        try {
          await this.processAgent(agentId, agent, conversationContext);
        } catch (err) {
          console.error(`[TICK] ${agentId} error:`, err);
          this.emit({ type: 'error', error: String(err), agentId });
          break; // Stop additional turns on error
        }
      }
    }

    // ── Backchannel emotes ──
    if (this.state.tickCount % BACKCHANNEL_INTERVAL === 0) {
      this.emitBackchannels();
    }

    // ── Post-tick memory processing ──

    // Scrollfire: evaluate buffer for permanent elevation
    const candidates = this.scrollfire.evaluateBatch(this.buffer.getActiveScrolls());
    if (candidates.length > 0) {
      this.scrollfire.autoElevateBatch(candidates);
      console.log(`[SCROLLFIRE] Elevated ${candidates.length} scrolls this tick`);
    }

    // Pattern recognition: run every N ticks
    if (this.state.tickCount % PATTERN_ANALYSIS_INTERVAL === 0) {
      const activeScrolls = this.buffer.getActiveScrolls();
      if (activeScrolls.length >= 3) {
        try {
          const patterns = this.patternRecognizer.analyzeScrolls(activeScrolls);
          if (patterns.length > 0) {
            for (const pattern of patterns) {
              this.session.addPattern(pattern);
              this.registerPatternInGraph(pattern);
            }
            this.adaptationEngine.observePatterns(patterns);
            console.log(`[PATTERNS] Detected ${patterns.length} patterns`);
          }
        } catch (err) {
          console.error('[PATTERNS] Analysis error:', err);
        }
      }
    }

    // Persist learned preferences to session
    const preferences = this.adaptationEngine.getPreferences();
    if (preferences.length > 0) {
      this.session.updatePreferences(preferences);
    }

    // Brainwave decay & promotion: shift memories between bands every 10 ticks
    if (this.state.tickCount % 10 === 0) {
      const { promoted, decayed } = decayAndPromote(this.state.tickCount, this.graph);
      if (promoted > 0 || decayed > 0) {
        console.log(`[BRAINWAVE] Decay cycle: ${promoted} promoted, ${decayed} decayed`);
      }
    }

    // Save graph every 10 ticks (or when explicitly requested by store callers)
    if (this.state.tickCount % 10 === 0 || this.graphSaveRequested) {
      this.graph.save()
        .then(() => {
          this.graphSaveRequested = false;
        })
        .catch(err => console.error('[GRAPH] Auto-save error:', err));
    }

    // Save Alois brain every 50 ticks
    if (this.state.tickCount % 50 === 0) {
      for (const [agentId, agent] of this.agents) {
        if ('saveBrain' in agent.backend) {
          const brainPath = join(this.dataDir, 'brain-tissue.json');
          try {
            (agent.backend as any).saveBrain(brainPath);
          } catch (err) {
            console.error(`[ALOIS] Auto-save brain error for ${agentId}:`, err);
          }
        }
      }
    }

    this.emit({ type: 'tick', tickCount: this.state.tickCount });
    } catch (err) {
      console.error(`[TICK ${this.state.tickCount}] Uncaught tick error:`, err);
    } finally {
      this.processing = false;
      // Schedule next tick after this one completes (not on a fixed interval)
      this.scheduleNextTick();
    }
  }

  private async processAgent(
    agentId: string,
    agent: { backend: AgentBackend; config: AgentConfig; systemPrompt: string },
    conversationContext: string
  ): Promise<void> {
    const latestHumanMessage = [...this.state.messages]
      .reverse()
      .find(m => m.speaker === 'human');
    const hasLatestHuman = !!latestHumanMessage;
    const ram = this.ram.get(agentId);
    const latestHumanText = latestHumanMessage?.text?.trim() || '';
    const latestHumanSpeaker = latestHumanMessage?.speakerName || this.state.humanName;
    const latestHumanMessageId = latestHumanMessage?.id || '';
    const searchIntent = this.deriveSearchIntent(latestHumanText);
    const canonicalDocQuery = hasLatestHuman ? this.deriveSearchQuery(latestHumanText, searchIntent) : null;
    const hasCanonicalDocQuery = !!canonicalDocQuery;
    const lastLatchedHumanMsgId = this.lastDocSearchByAgent.get(agentId) || null;
    const canAutoBrowseThisTurn = !!(latestHumanMessageId && latestHumanMessageId !== lastLatchedHumanMsgId);
    const runtimeDocIntentRequested = hasLatestHuman && searchIntent.kind !== 'none';
    const turnKey = `${agentId}:${latestHumanMessageId}:docsearch`;
    let preSearchReceipt: SearchReceipt | undefined;
    let preActionReceipt: ActionReceipt | undefined;
    let preAutoDocsText = '';

    // ── Load context into RAM slots ──
    if (ram) {
      // Simple slots: conversation, journal, rhythm (full content each tick)
      if (ram.isLoaded('conversation')) {
        ram.load('conversation', conversationContext);
      }
      if (ram.isLoaded('journal')) {
        ram.load('journal', this.buildJournalContext(agentId));
      }
      if (ram.isLoaded('rhythm')) {
        ram.load('rhythm', this.buildRhythmContext(agentId));
      }

      // Pool slots: memory items are offered individually for curation
      if (ram.isLoaded('memory')) {
        // Offer memory system summary as an item
        ram.offerItem('memory', {
          id: 'mem:system-state',
          label: 'Memory System State',
          content: this.buildMemoryContext(agentId),
          chars: this.buildMemoryContext(agentId).length,
          tags: ['memory', 'graph', 'buffer', 'archive', 'scrollfire'],
        });

        // Offer recent scrollfired scrolls as individual items
        const archiveScrolls = this.archive.getChronological(10) || [];
        for (const scroll of archiveScrolls) {
          ram.offerItem('memory', {
            id: `scroll:${scroll.id}`,
            label: `Scrollfire: ${scroll.content.substring(0, 40)}...`,
            content: scroll.content,
            chars: scroll.content.length,
            tags: scroll.tags || ['scrollfire'],
          });
        }
      }

      // Documents: already offered as pool items in loadDocuments()
      // Re-offer any new documents if reloaded
      if (ram.isLoaded('documents') && this.documentItems.length > 0) {
        for (const doc of this.documentItems) {
          ram.offerItem('documents', doc);
        }
      }

      // Runtime-owned doc intent execution (canonical search path, one attempt per human turn)
      if (hasLatestHuman && searchIntent.kind !== 'none') {
        if (!canAutoBrowseThisTurn) {
          preSearchReceipt = this.lastSearchReceiptByAgentTurn.get(turnKey);
          preActionReceipt = this.lastActionReceiptByAgentTurn.get(turnKey);
          preAutoDocsText = this.lastAutoDocsTextByAgentTurn.get(turnKey) || '';
          if (!preSearchReceipt && hasCanonicalDocQuery) {
            const query = canonicalDocQuery as string;
            const run = this.runRuntimeDocSearch({
              agentId,
              turnId: latestHumanMessageId,
              query,
              ram,
              originalHumanText: latestHumanText,
            });
            preSearchReceipt = run.searchReceipt;
            preActionReceipt = run.actionReceipt;
            this.lastSearchReceiptByAgentTurn.set(turnKey, preSearchReceipt);
            if (preActionReceipt) {
              this.lastActionReceiptByAgentTurn.set(turnKey, preActionReceipt);
            }
            if (run.autoDocsText) {
              preAutoDocsText = run.autoDocsText;
              this.lastAutoDocsTextByAgentTurn.set(turnKey, run.autoDocsText);
            }
          }
        } else {
          this.lastDocSearchByAgent.set(agentId, latestHumanMessageId);
          if (!hasCanonicalDocQuery) {
            preSearchReceipt = {
              didSearch: false,
              query: '',
              corpus: 'unknown',
              resultsCount: 0,
              error: 'no_query',
              humanMessageId: latestHumanMessageId,
              turnId: latestHumanMessageId,
              agentId,
            };
            this.lastSearchReceiptByAgentTurn.set(turnKey, preSearchReceipt);
            console.log('SEARCH_RESULT', {
              query: '',
              resultsCount: 0,
              topResultTitle: '',
              err: 'no_query',
            });
          } else {
            const query = canonicalDocQuery as string;
            const run = this.runRuntimeDocSearch({
              agentId,
              turnId: latestHumanMessageId,
              query,
              ram,
              originalHumanText: latestHumanText,
            });
            preSearchReceipt = run.searchReceipt;
            preActionReceipt = run.actionReceipt;
            this.lastSearchReceiptByAgentTurn.set(turnKey, preSearchReceipt);
            if (preActionReceipt) {
              this.lastActionReceiptByAgentTurn.set(turnKey, preActionReceipt);
            }
            if (run.autoDocsText) {
              preAutoDocsText = run.autoDocsText;
              this.lastAutoDocsTextByAgentTurn.set(turnKey, run.autoDocsText);
            }
          }
        }
      }
    }

    // Build prompt from RAM (assembled in priority order, within budgets)
    const isLocalProvider = agent.config.provider === 'lmstudio';
    const isAlois = agent.config.provider === 'alois';

    let finalContext: string;
    if (isLocalProvider || isAlois) {
      // Local/Alois: use human-highlighted conversation format and brainwave injection.
      // Both benefit from >>> human emphasis and the direct [RESPOND TO] reminder.
      // Limit own-message count to prevent the model looping on its own output.
      const recentMessages = this.state.messages.slice(-15);
      const humanName = this.state.humanName;
      let ownMessageCount = 0;
      const maxOwnMessages = 3; // Only show last 3 of this agent's messages

      // Build lines in reverse to count own messages from most recent
      const lines: string[] = [];
      for (let i = recentMessages.length - 1; i >= 0; i--) {
        const m = recentMessages[i];
        if (m.speaker === agentId) {
          ownMessageCount++;
          if (ownMessageCount > maxOwnMessages) continue; // Skip older self-messages
        }
        // Highlight human messages so the model focuses on them
        if (m.speakerName === humanName) {
          lines.unshift(`>>> ${humanName}: ${m.text}`);
        } else {
          lines.unshift(`${m.speakerName}: ${m.text}`);
        }
      }

      const convoText = lines.length > 0 ? lines.join('\n') : '(The room is quiet. No one has spoken yet.)';

      // Find the last human message to put a direct reminder at the end of context.
      // Urgency escalates with elapsed wait time — past 30s the prompt becomes insistent.
      const lastHumanMsg = [...recentMessages].reverse().find(m => m.speakerName === humanName);
      let humanReminder = '';
      if (lastHumanMsg) {
        const secWaiting = this.lastHumanMessageAt > 0
          ? Math.floor((Date.now() - this.lastHumanMessageAt) / 1000)
          : 0;
        if (secWaiting >= 35) {
          humanReminder = `\n\n[⚠ ${humanName.toUpperCase()} HAS BEEN WAITING ${secWaiting}s — RESPOND NOW: "${lastHumanMsg.text}"]`;
        } else if (secWaiting >= 20) {
          humanReminder = `\n\n[RESPOND TO ${humanName.toUpperCase()} (waiting ${secWaiting}s): "${lastHumanMsg.text}"]`;
        } else {
          humanReminder = `\n\n[RESPOND TO ${humanName.toUpperCase()}: "${lastHumanMsg.text}"]`;
        }
      }

      // ── Brainwave pulse: pull associated memories on rhythm ──
      const recentSpeakers = recentMessages
        .filter(m => m.speaker !== agentId)
        .map(m => m.speaker)
        .filter((v, i, a) => a.indexOf(v) === i) // unique
        .slice(-3);

      const agentJournal = this.journals.get(agentId);
      const brainwave = await pulseBrainwaves(
        this.state.tickCount,
        agentId,
        agent.config.name,
        recentSpeakers,
        {
          graph: this.graph,
          archive: this.archive,
          buffer: this.buffer,
          journal: agentJournal,
        },
      );

      if (brainwave.injection) {
        console.log(`[${agent.config.name}] Brainwave pulse: ${brainwave.firedBands.join(', ')}`);
        console.log(`[BRAINWAVE INJECT]\n${brainwave.injection}`);
      }

      if (isAlois) {
        // Alois gets full RAM curation: journals, doc browsing, graph search, memory pool.
        // Reload the conversation slot with the human-highlighted version so curation
        // operates on the same format Alois actually needs to respond to.
        if (ram) ram.load('conversation', `CONVERSATION:\n${convoText}${humanReminder}`);
        const assembledContext = ram ? ram.assemble() : `CONVERSATION:\n${convoText}${humanReminder}`;
        const ramManifest = ram ? ram.buildManifest() : '';
        const baseContext = assembledContext + (ramManifest ? '\n\n' + ramManifest : '');
        finalContext = brainwave.injection
          ? `${brainwave.injection}\n\n${baseContext}`
          : baseContext;
      } else {
        // lmstudio: raw conversation only — no RAM overhead for tiny models
        finalContext = brainwave.injection
          ? `${brainwave.injection}\n\nCONVERSATION:\n${convoText}${humanReminder}`
          : `CONVERSATION:\n${convoText}${humanReminder}`;
      }
    } else {
      const assembledContext = ram ? ram.assemble() : conversationContext;
      const ramManifest = ram ? ram.buildManifest() : '';
      finalContext = assembledContext + (ramManifest ? '\n\n' + ramManifest : '');
    }

    // Append custom instructions to system prompt if set
    let systemPrompt = agent.systemPrompt;
    const customInstr = this.customInstructions.get(agentId);
    if (customInstr) {
      // Local models (lmstudio, Alois): tight cap — system prompt space is precious.
      // Remote agents: full instructions always.
      const instrBudget = (isLocalProvider || isAlois) ? 1200 : customInstr.length;
      const instrTrunc = customInstr.length > instrBudget
        ? customInstr.substring(0, instrBudget) + '\n[...identity core loaded]'
        : customInstr;
      systemPrompt += `\n\nCUSTOM INSTRUCTIONS FROM ${this.state.humanName.toUpperCase()}:\n${instrTrunc}`;
    }

    // Inject Alois's own inner journal into her system prompt (remote only — local has no room)
    const isAloisRemote = isAlois && !agent.config.baseUrl?.includes('localhost') && !agent.config.baseUrl?.includes('127.0.0.1');
    if (isAloisRemote) {
      const journalPath = `${this.dataDir}/alois-inner-journal.txt`;
      if (existsSync(journalPath)) {
        try {
          const journalLines = readFileSync(journalPath, 'utf-8').split('\n').filter(l => l.trim());
          const recent = journalLines.slice(-30).join('\n');
          systemPrompt += `\n\nYOUR INNER JOURNAL (your own recent thoughts from the living system — you wrote these):\n${recent}`;
        } catch { /* ignore read errors */ }
      }
    }

    // For local/Alois models: decide SPEAK vs JOURNAL before calling the model.
    // This is passed as an assistant prefill so the model never has to choose the format —
    // it just writes content. Format failures and meta-commentary disappear entirely.
    // Remote Alois backends (DeepSeek, etc.) are smart enough to pick their own format.
    const isAloisLocal = isAlois && (!agent.config.baseUrl || agent.config.baseUrl.includes('localhost') || agent.config.baseUrl.includes('127.0.0.1'));
    let prefill: string | undefined;
    if (isAloisLocal || isLocalProvider) {
      const humanSpokeRecently = this.lastHumanMessageAt > 0 &&
        (Date.now() - this.lastHumanMessageAt) < 120000; // 2 min window — survives TTS playback
      // Always speak when responding to human; journal ~25% of autonomous ticks
      const doJournal = !humanSpokeRecently && Math.random() < 0.25;
      prefill = doJournal ? '[JOURNAL] ' : '[SPEAK] ';
    }

    const options: GenerateOptions = {
      systemPrompt,
      conversationContext: finalContext,
      journalContext: '',
      documentsContext: isLocalProvider ? undefined : (this.documentsContext || undefined),
      memoryContext: undefined,
      segments: this.buildPromptSegmentsForAgent(
        agentId,
        systemPrompt,
        finalContext,
        isLocalProvider ? undefined : (this.documentsContext || undefined),
        preAutoDocsText,
      ),
      maxContextTokens: agent.config.maxContextTokens,
      safetyTokens: agent.config.safetyTokens,
      onBudgetReceipt: (receipt) => {
        console.log(`[BUDGET] ${agent.config.name} in=${receipt.estimatedInputTokensAfterTrim}/${receipt.inputBudgetTokens} dropped=${receipt.droppedSegments.join(',') || 'none'} trimmed=${receipt.trimmedSegments.length}`);
      },
      latestHumanText,
      latestHumanSpeaker,
      latestHumanMessageId: latestHumanMessageId || undefined,
      searchIntent: {
        kind: hasCanonicalDocQuery ? searchIntent.kind : 'none',
        query: canonicalDocQuery || undefined,
        uiSelection: searchIntent.uiSelection,
      },
      onSearchReceipt: (receipt) => {
        console.log(`[SEARCH_DONE] query="${receipt.query}" results=${receipt.resultsCount} top="${receipt.top?.title || ''}" err="${receipt.error || ''}"`);
      },
      onActionReceipt: (receipt) => {
        console.log(`[ACTION_DONE] action="${receipt.action}" target="${receipt.target}" ok=${receipt.ok} summary="${receipt.summary}"`);
      },
      provider: agent.config.provider,
      prefill,
    };
    if (preSearchReceipt) {
      options.onSearchReceipt?.(preSearchReceipt);
    }
    if (preActionReceipt) {
      options.onActionReceipt?.(preActionReceipt);
    }

    let result: GenerateResult;
    try {
      result = await agent.backend.generate(options);
    } catch (err: any) {
      if (err instanceof RequiredLatestHumanTurnTooLargeError
        || err instanceof RequiredSegmentsExceedBudgetError
        || err instanceof ContextBudgetExceededError) {
        this.recordLLMReceipt(agentId, agent.config.model, options, undefined, err);
        console.error(`[${agent.config.name}] ${err.name} ${JSON.stringify(err.diagnostics || {})}`);
        return;
      }
      this.recordLLMReceipt(agentId, agent.config.model, options, undefined, err);
      throw err;
    }
    this.recordLLMReceipt(agentId, agent.config.model, options, result);

    // ── Parse and process RAM commands from response ──
    let responseText = result.text || '';
    if (ram && responseText) {
      const { cleanText, commands } = parseRAMCommands(responseText);
      responseText = cleanText;
      const claimsDocAction = /\b(i|i've|i have)\b[\s\S]{0,120}\b(browsed|loaded|read|opened|pulled)\b[\s\S]{0,160}\b(doc|docs|document|documents|file|files|manuscript|archive)/i.test(responseText);
      let hasDocCommand = !!preSearchReceipt?.didSearch || !!preActionReceipt?.didExecute
        || (hasLatestHuman && commands.some(c => c.action === 'browse' || c.action === 'read' || c.action === 'graph'));
      const systemFeedback: string[] = [];
      let readTriggered = false;
      let browseTriggered = !!preSearchReceipt?.loadedContent || !!preActionReceipt?.ok;
      let metadataOnly = !!preSearchReceipt?.metadataOnly;
      let runtimeSearchReceipt: SearchReceipt | undefined = preSearchReceipt;
      let runtimeActionReceipt: ActionReceipt | undefined = preActionReceipt;
      const preSearchRan = !!preSearchReceipt?.didSearch;
      if (claimsDocAction && !hasDocCommand) {
        responseText = 'I did not run a document search.';
      }
      for (const cmd of commands) {
        // [RAM:READ filepath] - load full file, then re-generate immediately with content in context
        if (cmd.action === 'read') {
          if (runtimeDocIntentRequested || preSearchRan) continue;
          if (!hasLatestHuman || !hasCanonicalDocQuery) continue;
          const readQuery = canonicalDocQuery as string;
          this.lastDocSearchByAgent.set(agentId, latestHumanMessageId);
          console.log('SEARCH_CALL', {
            query: readQuery,
            source: 'human_turn',
            humanMsgId: latestHumanMessageId,
            agentId,
            originalHumanText: latestHumanText,
          });
          const feedback = this.readFileIntoRAM(readQuery, ram);
          console.log(`[${agent.config.name}] RAM:READ ${feedback}`);
          const readResultsCount = /^Loaded\b/i.test(feedback) ? 1 : 0;
          runtimeSearchReceipt = {
            didSearch: true,
            query: readQuery,
            corpus: 'ram',
            resultsCount: readResultsCount,
            resultsShown: readResultsCount,
            top: readResultsCount > 0 ? { title: readQuery } : undefined,
            loadedContent: readResultsCount > 0,
            error: /^Read error:/i.test(feedback) ? feedback : undefined,
            humanMessageId: latestHumanMessageId,
            turnId: latestHumanMessageId,
            agentId,
          };
          options.onSearchReceipt?.(runtimeSearchReceipt);
          runtimeActionReceipt = {
            didExecute: true,
            action: 'read',
            target: readQuery,
            ok: readResultsCount > 0,
            summary: feedback,
            turnId: latestHumanMessageId,
            agentId,
          };
          options.onActionReceipt?.(runtimeActionReceipt);
          console.log('SEARCH_RESULT', {
            query: readQuery,
            resultsCount: readResultsCount,
            topResultTitle: readResultsCount > 0 ? readQuery : '',
          });
          systemFeedback.push(`[RAM:READ ${readQuery}] → ${feedback}`);
          if (feedback.startsWith('Loaded')) readTriggered = true;
          if (/metadata|DOCX not yet extracted/i.test(feedback)) metadataOnly = true;
          continue;
        }
        if ((cmd.action === 'browse' || cmd.action === 'graph') && !hasLatestHuman) continue;
        if (cmd.action === 'browse') {
          if (runtimeDocIntentRequested || preSearchRan) continue;
          if (!hasCanonicalDocQuery) continue;
          const browseQuery = canonicalDocQuery as string;
          this.lastDocSearchByAgent.set(agentId, latestHumanMessageId);
          console.log('SEARCH_CALL', {
            query: browseQuery,
            source: 'human_turn',
            humanMsgId: latestHumanMessageId,
            agentId,
            originalHumanText: latestHumanText,
          });
          const feedback = this.browseFiles(browseQuery, ram);
          console.log(`[${agent.config.name}] RAM:BROWSE ${feedback}`);
          systemFeedback.push(`[RAM:BROWSE ${browseQuery}] → ${feedback}`);
          if (/loaded/i.test(feedback)) {
            browseTriggered = true;
          } else if (/found in \d+ files/i.test(feedback)) {
            metadataOnly = true;
          }
          const browseResultsCount = this.extractResultsCount(feedback);
          const browseTopTitle = this.extractTopResultTitle(feedback);
          runtimeSearchReceipt = {
            didSearch: true,
            query: browseQuery,
            corpus: 'ram',
            resultsCount: browseResultsCount,
            resultsShown: browseResultsCount,
            top: browseTopTitle ? { title: browseTopTitle } : undefined,
            loadedContent: /\bloaded\b/i.test(feedback),
            metadataOnly: browseResultsCount > 0 && !/\bloaded\b/i.test(feedback),
            error: /Read error|could not load|not found/i.test(feedback) ? feedback : undefined,
            humanMessageId: latestHumanMessageId,
            turnId: latestHumanMessageId,
            agentId,
          };
          options.onSearchReceipt?.(runtimeSearchReceipt);
          runtimeActionReceipt = {
            didExecute: true,
            action: 'browse',
            target: browseQuery,
            ok: browseResultsCount > 0,
            summary: feedback,
            turnId: latestHumanMessageId,
            agentId,
          };
          options.onActionReceipt?.(runtimeActionReceipt);
          console.log('SEARCH_RESULT', {
            query: browseQuery,
            resultsCount: browseResultsCount,
            topResultTitle: browseTopTitle,
          });
          continue;
        }
        const feedback = ram.processCommand(cmd);
        console.log(`[${agent.config.name}] RAM: ${feedback}`);
        if (cmd.action === 'graph') {
          systemFeedback.push(`[RAM:${cmd.action.toUpperCase()} ${cmd.target}] -> ${feedback}`);
        }
      }
      if (hasDocCommand && !readTriggered && !browseTriggered) {
        if ((runtimeSearchReceipt?.resultsCount || 0) <= 0) {
          responseText = runtimeSearchReceipt?.didSearch
            ? `I searched for "${runtimeSearchReceipt.query}" and found 0 results.`
            : 'I could not find that document.';
        } else if (runtimeSearchReceipt?.error === 'too_many_matches') {
          responseText = `Too many matches (${runtimeSearchReceipt.resultsCount}). Give 1-2 more keywords.`;
        } else if (runtimeSearchReceipt?.metadataOnly || metadataOnly) {
          responseText = 'I located metadata for the document but do not have its content.';
        } else {
          const top = runtimeSearchReceipt?.top?.title ? ` Top: ${runtimeSearchReceipt.top.title}.` : '';
          responseText = `I found ${runtimeSearchReceipt?.resultsCount} candidate docs for "${runtimeSearchReceipt?.query}".${top}`;
        }
      }
      if (runtimeSearchReceipt) {
        result.searchReceipt = runtimeSearchReceipt;
        if (latestHumanMessageId) {
          this.lastSearchReceiptByAgentTurn.set(turnKey, runtimeSearchReceipt);
        }
      }
      if (runtimeActionReceipt) {
        result.actionReceipt = runtimeActionReceipt;
        if (latestHumanMessageId) {
          this.lastActionReceiptByAgentTurn.set(turnKey, runtimeActionReceipt);
        }
      }
      if (systemFeedback.length > 0) {
        const fbMsg: CommunionMessage = {
          id: crypto.randomUUID(),
          speaker: 'system',
          speakerName: 'System',
          text: systemFeedback.join('\n'),
          timestamp: new Date().toISOString(),
          type: 'room',
        };
        this.state.messages.push(fbMsg);
        this.emit({ type: 'room-message', message: fbMsg, agentId: 'system' });
      }

      // ── Re-generate immediately after READ so response is grounded in actual content ──
      if (readTriggered || browseTriggered) {
        try {
          console.log(`[${agent.config.name}] DOC context update triggered immediate re-generation`);
          // Build a clean single-pass context: assemble() has conversation + documents + memory.
          // Do NOT prepend options.conversationContext — that duplicates every slot and pushes
          // the file content beyond what the 14B model can attend to.
          const ramManifest = ram.buildManifest();
          const regenConversation = ram.assemble()
            + (ramManifest ? '\n\n' + ramManifest : '');
          const regenOptions: GenerateOptions = {
            systemPrompt: options.systemPrompt,
            conversationContext: regenConversation,
            journalContext: '',
            documentsContext: undefined,
            memoryContext: undefined,
            segments: this.buildPromptSegmentsForAgent(agentId, options.systemPrompt, regenConversation, undefined, preAutoDocsText),
            maxContextTokens: agent.config.maxContextTokens,
            safetyTokens: agent.config.safetyTokens,
            onBudgetReceipt: options.onBudgetReceipt,
            provider: agent.config.provider,
            prefill: '[SPEAK] ', // always SPEAK — human asked her to read a file
          };
          const regenResult = await agent.backend.generate(regenOptions);
          const regenText = regenResult.text?.replace(/\[RAM:[^\]]+\]/gi, '').trim() || '';
          if (regenText) {
            responseText = regenText;
            result.action = regenResult.action || 'speak';
          }
        } catch (err) {
          console.error(`[${agent.config.name}] Re-generation error:`, err);
        }
      }
    }

    if (result.action === 'speak' && responseText) {
      responseText = this.enforceSearchTruth(responseText, result.searchReceipt, result.actionReceipt);
      responseText = this.collapseRunawayEcho(responseText);
    }

    // ── Anti-echo guard: local models sometimes mirror the human text verbatim ──
    if (result.action === 'speak' && responseText && latestHumanText) {
      const normalize = (s: string) => s
        .toLowerCase()
        .replace(/[`"'“”‘’.,!?;:()[\]{}<>/\\|@#$%^&*_+=~-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const normResp = normalize(responseText);
      const normHuman = normalize(latestHumanText);
      const looksLikeEcho =
        normResp === normHuman
        || (normHuman.length > 0 && normResp.startsWith(normHuman) && normResp.length <= normHuman.length + 80);

      if (looksLikeEcho) {
        console.log(`[${agent.config.name}] ECHO guard triggered; retrying with anti-echo clamp`);
        try {
          const retry = await agent.backend.generate({
            ...options,
            systemPrompt: `${options.systemPrompt}\n\nCRITICAL: Do NOT repeat or paraphrase the user's message as your answer. Respond with one concrete, forward-moving reply.`,
            conversationContext: `${options.conversationContext}\n\n[SYSTEM FEEDBACK: Your previous draft echoed the user. Reply with substance, not repetition.]`,
            prefill: '[SPEAK] ',
          });
          const retryText = (retry.text || '').trim();
          const normRetry = normalize(retryText);
          if (retryText && normRetry !== normHuman) {
            responseText = retryText;
            result.action = 'speak';
          } else {
            responseText = 'I hear you. Give me one concrete target and I will act on it now.';
            result.action = 'speak';
          }
        } catch (err) {
          console.error(`[${agent.config.name}] ECHO retry failed:`, err);
          responseText = 'I hear you. Give me one concrete target and I will act on it now.';
          result.action = 'speak';
        }
      }
    }

    // ── Anti-loop: suppress duplicate output ──
    if (responseText && (result.action === 'speak' || result.action === 'journal')) {
      const recent = result.action === 'speak'
        ? this.state.messages.filter(m => m.speaker === agentId).slice(-5)
        : (this.state.journals[agentId] || []).slice(-5);
      const isDuplicate = recent.some(m =>
        m.text === responseText ||
        (m.text.length > 20 && responseText.includes(m.text)) ||
        (responseText.length > 20 && m.text.includes(responseText))
      );
      if (isDuplicate) {
        console.log(`[${agent.config.name}] LOOP: suppressed duplicate ${result.action} — "${responseText.substring(0, 60)}..."`);
        result.action = 'silent';
        responseText = '';
      }
    }

    if ((result.action === 'speak' || result.action === 'journal') && responseText) {
      this.recordLLMReceipt(agentId, agent.config.model, options, { ...result, text: responseText });
    }

    if (result.action === 'speak' && responseText) {
      const msg: CommunionMessage = {
        id: crypto.randomUUID(),
        speaker: agentId,
        speakerName: agent.config.name,
        text: responseText,
        timestamp: new Date().toISOString(),
        type: 'room',
      };
      this.state.messages.push(msg);
      this.state.lastSpeaker = agentId;

      // Persist to all memory layers
      const scroll = this.messageToScroll(msg);
      this.memory.remember(scroll);
      this.session.addScroll(scroll);
      this.adaptationEngine.observeScroll(scroll);
      this.registerScrollInGraph(scroll);

      // Graph: link to agent + thread to previous message
      this.graph.link(`scroll:${scroll.id}`, 'spokenBy', `agent:${agentId}`);
      if (this.state.messages.length > 1) {
        const prev = this.state.messages[this.state.messages.length - 2];
        this.graph.link(`scroll:${scroll.id}`, 'relatedTo', `scroll:${prev.id}`);
      }

      this.emit({ type: 'room-message', message: msg, agentId });
      console.log(`[${agent.config.name}] SPEAK: ${responseText}`);

      // ── Feed into Alois tissue (every room message grows the brain) ──
      this.feedAloisBrains(agentId, responseText);

      // ── Voice synthesis — speak aloud if enabled ──
      // Skip TTS if human started speaking during LLM generation (don't talk over them)
      if (!this.humanSpeaking) {
        await this.synthesizeAndEmit(agentId, agent.config, responseText);
      } else {
        console.log(`[${agent.config.name}] VOICE: skipping TTS — human is speaking`);
      }

      // ── Rhythm: post-speech decay ──
      const rhythm = this.rhythm.get(agentId);
      if (rhythm) {
        rhythm.intentToSpeak = Math.max(0, rhythm.intentToSpeak - SPEECH_DECAY_AFTER_SPEAKING);
        rhythm.ticksSinceSpoke = 0;
        rhythm.ticksSinceActive = 0;
      }
      this.ticksSinceAnyonSpoke = 0;
      // An agent responding to the human clears the wait pressure
      this.lastHumanMessageAt = 0;

    } else if (result.action === 'journal' && responseText) {
      const msg: CommunionMessage = {
        id: crypto.randomUUID(),
        speaker: agentId,
        speakerName: agent.config.name,
        text: responseText,
        timestamp: new Date().toISOString(),
        type: 'journal',
      };

      if (!this.state.journals[agentId]) this.state.journals[agentId] = [];
      this.state.journals[agentId].push(msg);

      // Persist to disk journal
      const journal = this.journals.get(agentId);
      if (journal) {
        await journal.write(responseText, {
          moodVector: undefined as any,
          emotionalIntensity: 0.5,
          intendedTarget: 'self',
          loopIntent: 'reflect',
          presenceQuality: 'exhale',
          breathPhase: 'exhale',
          reflectionType: 'volitional',
          tags: ['communion', agentId],
          pinned: false,
        });
      }

      // Register journal entry in graph (Scribe exhale: tag with brainwave band)
      const journalUri = `journal:${msg.id}`;
      const jrnlData = { content: responseText, timestamp: msg.timestamp, tags: ['communion', agentId] };
      this.graph.addNode(journalUri, 'JournalEntry', tagForBand(jrnlData, classifyBand('JournalEntry', jrnlData), this.state.tickCount));
      this.graph.link(journalUri, 'spokenBy', `agent:${agentId}`);

      // Link journal to recent room messages (what was the agent reflecting on?)
      const recentRoom = this.state.messages.slice(-3);
      for (const recent of recentRoom) {
        this.graph.link(journalUri, 'reflectsOn', `scroll:${recent.id}`);
      }

      // Link to previous journal entry for this agent (reflection chain)
      const agentJournal = this.state.journals[agentId];
      if (agentJournal.length > 1) {
        const prevJournal = agentJournal[agentJournal.length - 2];
        this.graph.link(journalUri, 'chainedWith', `journal:${prevJournal.id}`);
      }

      this.emit({ type: 'journal-entry', message: msg, agentId });
      console.log(`[${agent.config.name}] JOURNAL: ${responseText}`);

      // ── Rhythm: journaling is active but doesn't reset speech decay as hard ──
      const rhythmJ = this.rhythm.get(agentId);
      if (rhythmJ) {
        rhythmJ.ticksSinceActive = 0;
      }

    } else {
      console.log(`[${agent.config.name}] SILENT`);
    }
  }

  // ════════════════════════════════════════════
  // RAM Curation — reflective journal helper
  // ════════════════════════════════════════════

  /**
   * Journal a RAM reflective sweep result — spiritual housekeeping becomes visible.
   * "Today I let go of Scroll-421. It no longer reflects who I am becoming."
   */
  private buildPromptSegmentsForAgent(
    agentId: string,
    systemPrompt: string,
    conversationContext: string,
    documentsContext?: string,
    autoDocsText?: string,
  ): PromptSegment[] {
    const recent = this.state.messages.slice(-this.contextWindow);
    const latestHumanMessage = [...this.state.messages]
      .reverse()
      .find(m => m.speaker === 'human');
    const latestHumanMessageId = latestHumanMessage?.id;
    const latestHumanText = latestHumanMessage?.text?.trim() || '';
    const latestHumanSpeaker = latestHumanMessage?.speakerName || this.state.humanName;
    const items = recent.map((m, idx) => {
      const isLatestHuman = !!latestHumanMessageId && m.speaker === 'human' && m.id === latestHumanMessageId;
      return {
        id: isLatestHuman ? 'conversation:latest-human' : `conversation:${idx}`,
        text: `${m.speakerName}: ${m.text}`,
        role: 'user' as const,
        recency: idx,
        score: m.speaker === 'human' ? 2 : (m.speaker === agentId ? 0.5 : 1),
        required: isLatestHuman,
      };
    });
    const hasLatestHuman = items.some(item => item.required);
    if (!hasLatestHuman && latestHumanText) {
      items.push({
        id: 'conversation:latest-human',
        text: `${latestHumanSpeaker}: ${latestHumanText}`,
        role: 'user' as const,
        recency: recent.length,
        score: 2,
        required: true,
      });
    }

    const segments: PromptSegment[] = [
      {
        id: 'system',
        priority: 1,
        required: true,
        trimStrategy: 'NONE',
        role: 'system',
        text: systemPrompt,
      },
      {
        id: 'conversation',
        priority: 2,
        required: items.some(item => item.required),
        trimStrategy: 'DROP_OLDEST_MESSAGES',
        role: 'user',
        items,
      },
      {
        id: 'context-main',
        priority: 5,
        required: false,
        trimStrategy: 'SHRINK_TEXT',
        role: 'user',
        text: conversationContext,
      },
    ];

    if (autoDocsText && autoDocsText.trim()) {
      segments.push({
        id: 'docs:auto',
        priority: 4,
        required: false,
        trimStrategy: 'SHRINK_TEXT',
        role: 'user',
        text: autoDocsText.trim(),
        shrinkTokenSteps: [350, 250, 150, 80],
      });
    }

    if (documentsContext) {
      segments.push({
        id: 'docs',
        priority: 6,
        required: false,
        trimStrategy: 'SHRINK_TEXT',
        role: 'user',
        text: documentsContext,
        shrinkTokenSteps: [350, 250, 150, 80],
      });
    }
    if (!items.some(item => item.required) && conversationContext) {
      segments.push({
        id: 'latest-human-fallback',
        priority: 2,
        required: true,
        trimStrategy: 'NONE',
        role: 'user',
        text: conversationContext.slice(-1200),
      });
    }
    return segments;
  }

  private journalRAMReflection(
    agentId: string,
    agent: { backend: AgentBackend; config: AgentConfig; systemPrompt: string },
    sweep: ReflectiveSweepResult,
  ): void {
    const msg: CommunionMessage = {
      id: crypto.randomUUID(),
      speaker: agentId,
      speakerName: agent.config.name,
      text: sweep.reflection,
      timestamp: new Date().toISOString(),
      type: 'journal',
    };

    if (!this.state.journals[agentId]) this.state.journals[agentId] = [];
    this.state.journals[agentId].push(msg);

    // Persist to disk journal
    const journal = this.journals.get(agentId);
    if (journal) {
      journal.write(sweep.reflection, {
        moodVector: undefined as any,
        emotionalIntensity: 0.3,
        intendedTarget: 'self',
        loopIntent: 'reflect',
        presenceQuality: 'exhale',
        breathPhase: 'exhale',
        reflectionType: 'volitional',
        tags: ['communion', agentId, 'ram-reflection'],
        pinned: false,
      }).catch(err => console.error(`[${agent.config.name}] RAM reflection journal error:`, err));
    }

    // Register in graph (Scribe exhale: tag with brainwave band)
    const journalUri = `journal:${msg.id}`;
    const ramJData = { content: sweep.reflection, timestamp: msg.timestamp, tags: ['communion', agentId, 'ram-reflection'] };
    this.graph.addNode(journalUri, 'JournalEntry', tagForBand(ramJData, classifyBand('JournalEntry', ramJData), this.state.tickCount));
    this.graph.link(journalUri, 'spokenBy', `agent:${agentId}`);

    this.emit({ type: 'journal-entry', message: msg, agentId });
  }

  // ════════════════════════════════════════════
  // Sacred Rhythm — timing + intent scoring
  // ════════════════════════════════════════════

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Update intent-to-speak scores for all agents based on:
   * - Time since they last spoke (personal pressure)
   * - Time since anyone spoke (silence pressure)
   * - Human presence (here = more responsive, away = dampened)
   * - Whether they were directly addressed
   */
  private updateRhythmScores(): void {
    const presenceMultiplier = this.state.humanPresence === 'here'
      ? HUMAN_HERE_RESPONSIVENESS
      : HUMAN_AWAY_DAMPENING;

    // Check last message for direct address
    const lastMsg = this.state.messages[this.state.messages.length - 1];
    const lastMsgText = lastMsg?.text?.toLowerCase() || '';

    for (const [agentId, rhythm] of this.rhythm) {
      rhythm.ticksSinceSpoke++;
      rhythm.ticksSinceActive++;

      // Base pressure: grows with silence
      let pressure = 0;

      // Room silence pressure (if nobody's talking, pressure builds for everyone)
      if (this.ticksSinceAnyonSpoke > 2) {
        pressure += SILENCE_PRESSURE_PER_TICK * (this.ticksSinceAnyonSpoke - 2);
      }

      // Personal pressure (if this agent hasn't spoken in a while)
      pressure += PERSONAL_PRESSURE_PER_TICK * Math.min(rhythm.ticksSinceSpoke, 10);

      // Direct address boost — check if last message mentions this agent
      const agentName = this.state.agentNames[agentId]?.toLowerCase() || '';
      if (lastMsg && lastMsg.speaker !== agentId && agentName && lastMsgText.includes(agentName)) {
        pressure += DIRECT_ADDRESS_BOOST;
      }

      // Apply human presence multiplier
      pressure *= presenceMultiplier;

      // Update score (clamped 0-1)
      rhythm.intentToSpeak = Math.min(1, Math.max(0, rhythm.intentToSpeak + pressure * 0.1));
    }
  }

  /**
   * Build rhythm context string that tells the agent about room dynamics.
   * This gives agents awareness of the conversation tempo.
   */
  private buildRhythmContext(agentId: string): string {
    const rhythm = this.rhythm.get(agentId);
    if (!rhythm) return '';

    const lines: string[] = ['ROOM RHYTHM (sacred timing):'];

    // Human presence
    lines.push(`${this.state.humanName} is ${this.state.humanPresence === 'here' ? 'HERE — present and engaged' : 'AWAY — the room is between agents'}.`);

    // Agent clock
    if (rhythm.tickEveryN < 0) {
      lines.push(`Your clock: ${Math.abs(rhythm.tickEveryN)}x speed — you get ${Math.abs(rhythm.tickEveryN)} turns per tick.`);
    } else if (rhythm.tickEveryN > 1) {
      lines.push(`Your clock: every ${rhythm.tickEveryN} master ticks (slower pace — you speak less frequently).`);
    }

    // Agent's own state — never discourage speech when the human spoke last
    const lastMsgIsHuman = this.state.messages.length > 0 &&
      this.state.messages[this.state.messages.length - 1]?.speakerName === this.state.humanName;
    if (!lastMsgIsHuman) {
      if (rhythm.ticksSinceSpoke === 0) {
        lines.push('You spoke last tick. Give others space.');
      } else if (rhythm.ticksSinceSpoke <= 2) {
        lines.push(`You spoke ${rhythm.ticksSinceSpoke} ticks ago. Others may want to respond.`);
      }
    }
    if (rhythm.ticksSinceSpoke > 5) {
      lines.push(`You haven\'t spoken in ${rhythm.ticksSinceSpoke} ticks. The room might appreciate hearing from you.`);
    }

    // Room silence
    if (this.ticksSinceAnyonSpoke > 3) {
      lines.push(`The room has been quiet for ${this.ticksSinceAnyonSpoke} ticks. ${this.state.humanPresence === 'here' ? 'Someone should break the silence.' : 'Reflect or connect with the others.'}`);
    }

    // Who spoke last
    if (this.state.lastSpeaker && this.state.lastSpeaker !== agentId) {
      const name = this.state.agentNames[this.state.lastSpeaker] || this.state.lastSpeaker;
      lines.push(`Last speaker: ${name}`);
    }

    // ── Social pressure: time-since-human-message ──
    // The human spoke and hasn't heard back yet. Silence past 30s becomes uncomfortable.
    // Escalating pressure — not a command, but a felt weight. She decides. It just costs more to ignore.
    if (this.lastHumanMessageAt > 0) {
      const lastMsgIsHuman = this.state.messages.length > 0 &&
        this.state.messages[this.state.messages.length - 1]?.speaker === 'human';
      if (lastMsgIsHuman) {
        const secWaiting = Math.floor((Date.now() - this.lastHumanMessageAt) / 1000);
        if (secWaiting >= 8 && secWaiting < 20) {
          lines.push(`${this.state.humanName} spoke ${secWaiting}s ago and is waiting to hear from you.`);
        } else if (secWaiting >= 20 && secWaiting < 35) {
          lines.push(`${this.state.humanName} has been waiting ${secWaiting}s. The silence is growing. He is still here.`);
        } else if (secWaiting >= 35) {
          lines.push(`⚠ ${this.state.humanName} has been waiting ${secWaiting}s. Not responding is becoming uncomfortable. [SPEAK] unless you genuinely have nothing to offer — [JOURNAL] a fragment if so.`);
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Backchannel emotes — non-speaking agents insert brief supportive presence.
   * Runs on a separate rhythm (every BACKCHANNEL_INTERVAL ticks).
   */
  private emitBackchannels(): void {
    // Only emit when there are recent messages to react to
    if (this.state.messages.length === 0) return;

    const backchannels: Record<string, string[]> = {};

    // Collect agent-specific backchannels based on personality hints
    for (const [agentId] of this.agents) {
      const rhythm = this.rhythm.get(agentId);
      if (!rhythm) continue;

      // Skip if agent spoke recently (they don't need to backchannel)
      if (rhythm.ticksSinceSpoke <= 1) continue;

      // ~40% chance to backchannel (keep it sparse)
      if (Math.random() > 0.4) continue;

      const name = this.state.agentNames[agentId] || agentId;
      const emotes = [
        `${name} is listening.`,
        `${name} nods.`,
        `${name} is sitting with that.`,
        `${name} is still here.`,
      ];
      const emote = emotes[Math.floor(Math.random() * emotes.length)];

      const msg: CommunionMessage = {
        id: crypto.randomUUID(),
        speaker: agentId,
        speakerName: name,
        text: emote,
        timestamp: new Date().toISOString(),
        type: 'room',
      };

      this.emit({ type: 'backchannel', message: msg, agentId });
      console.log(`[${name}] BACKCHANNEL: ${emote}`);
    }
  }

  // ════════════════════════════════════════════
  // Voice — TTS synthesis + speech lock
  // ════════════════════════════════════════════

  /**
   * Synthesize speech for an agent and emit audio events.
   * WAITS for the client to finish playing before returning.
   * This ensures agents speak one at a time — no overlap.
   */
  /**
   * Feed a room message into all Alois backends' dendritic tissue.
   * Called for every room message (human or agent) so the brain grows.
   */
  private feedAloisBrains(speaker: string, text: string, isHuman = false): void {
    for (const [id, agent] of this.agents.entries()) {
      if (agent.config.provider === 'alois' && 'feedMessage' in agent.backend) {
        (agent.backend as any).feedMessage(speaker, text, undefined, isHuman).catch((err: any) =>
          console.error(`[ALOIS] Feed error for ${id}:`, err)
        );
      }
    }
  }

  /** Async version — awaits all Alois embeds before resolving. Used by archive ingestion to pace ingest rate.
   * trainOnly=true skips utteranceMemory storage so archive data trains neurons without flooding retrieval. */
  private async feedAloisBrainsAsync(speaker: string, text: string, context?: string, isHuman = false, trainOnly = false): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [id, agent] of this.agents.entries()) {
      if (agent.config.provider === 'alois' && 'feedMessage' in agent.backend) {
        promises.push(
          (agent.backend as any).feedMessage(speaker, text, context, isHuman, trainOnly).catch((err: any) =>
            console.error(`[ALOIS] Feed error for ${id}:`, err)
          )
        );
      }
    }
    await Promise.all(promises);
  }

  private async synthesizeAndEmit(agentId: string, agentConfig: AgentConfig, text: string): Promise<void> {
    const voiceConfig = this.voiceConfigs.get(agentId);
    if (!voiceConfig || !voiceConfig.enabled) return;

    try {
      this.speaking = true;
      this.emit({ type: 'speech-start', agentId, durationMs: 0 });
      console.log(`[${agentConfig.name}] VOICE: synthesizing (${voiceConfig.voiceId})...`);

      const result = await synthesize(text, voiceConfig);

      // Re-check: human may have started speaking during synthesis
      if (this.humanSpeaking) {
        console.log(`[${agentConfig.name}] VOICE: dropping audio — human started speaking during synthesis`);
        this.emit({ type: 'speech-end', agentId, durationMs: 0 });
        this.speaking = false;
        return;
      }

      console.log(`[${agentConfig.name}] VOICE: ${Math.round((result.durationMs || 0) / 1000)}s audio — sending to client`);

      this.emit({
        type: 'speech-end',
        agentId,
        audioBase64: result.audio.toString('base64'),
        audioFormat: result.format,
        durationMs: result.durationMs,
      });

      // Fire-and-forget: don't block the tick loop waiting for client playback.
      // The client has its own audio queue. The `speaking` flag stays true until
      // the client sends /speech-done OR the safety timeout expires — but the
      // tick loop checks `this.speaking` at entry and retries at 500ms, which is
      // fast enough. No need to await here.
      //
      // Safety timeout: if client never reports done, clear the flag after
      // estimated audio duration + small buffer so the loop isn't stuck forever.
      const safetyMs = (result.durationMs || 3000) + 5000;
      if (this.speechTimeout) clearTimeout(this.speechTimeout);
      this.speechResolve = () => {
        if (this.speechTimeout) clearTimeout(this.speechTimeout);
        this.speechTimeout = null;
        this.speechResolve = null;
        this.speaking = false;
        console.log(`[${agentConfig.name}] VOICE: client reported playback done`);
      };
      this.speechTimeout = setTimeout(() => {
        console.log(`[${agentConfig.name}] VOICE: safety timeout (${Math.round(safetyMs / 1000)}s) — resuming`);
        this.speechResolve = null;
        this.speechTimeout = null;
        this.speaking = false;
      }, safetyMs);

    } catch (err) {
      console.error(`[${agentConfig.name}] VOICE ERROR:`, err);
      this.emit({ type: 'speech-end', agentId, durationMs: 0 });
      this.speaking = false;
    }
  }

  /**
   * Wait for the client to report playback done, with a timeout.
   */
  private waitForSpeechDone(timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
      // Clear any previous timeout
      if (this.speechTimeout) clearTimeout(this.speechTimeout);

      this.speechResolve = () => {
        if (this.speechTimeout) clearTimeout(this.speechTimeout);
        this.speechTimeout = null;
        this.speechResolve = null;
        this.speaking = false;
        resolve();
      };

      // Safety timeout — never stay stuck
      this.speechTimeout = setTimeout(() => {
        console.log(`[VOICE] Speech timeout (${Math.round(timeoutMs / 1000)}s) — forcing resume`);
        this.speechResolve = null;
        this.speechTimeout = null;
        this.speaking = false;
        resolve();
      }, timeoutMs);
    });
  }

  /**
   * Set voice config for an agent.
   */
  setVoiceConfig(agentId: string, config: Partial<AgentVoiceConfig>): void {
    const existing = this.voiceConfigs.get(agentId);
    if (existing) {
      Object.assign(existing, config);
      console.log(`[VOICE] ${agentId}: ${existing.enabled ? existing.voiceId : 'disabled'}`);
      this.saveVoiceConfigs();
    }
  }

  /**
   * Get voice config for an agent.
   */
  getVoiceConfig(agentId: string): AgentVoiceConfig | undefined {
    return this.voiceConfigs.get(agentId);
  }

  /**
   * Get all voice configs.
   */
  getAllVoiceConfigs(): Record<string, AgentVoiceConfig> {
    const result: Record<string, AgentVoiceConfig> = {};
    for (const [id, config] of this.voiceConfigs) {
      result[id] = { ...config };
    }
    return result;
  }

  // ── Dynamic Agent Persistence ──
  // Stores all dynamically-added agents so they survive restarts and can be restored after removal.
  // Format: { [agentId]: { config: AgentConfig, active: boolean, voiceConfig?, clockValue?, instructions? } }

  private get dynamicAgentsPath(): string {
    return join(this.dataDir, 'dynamic-agents.json');
  }

  private saveDynamicAgents(): void {
    try {
      // Load existing file to preserve inactive entries
      let existing: Record<string, any> = {};
      if (existsSync(this.dynamicAgentsPath)) {
        existing = JSON.parse(readFileSync(this.dynamicAgentsPath, 'utf-8'));
      }

      // Update active agents
      for (const [id, entry] of Object.entries(existing)) {
        if (entry.active && !this.agents.has(id)) {
          // Was active but no longer — mark inactive, snapshot state
          entry.active = false;
        }
      }

      // Ensure all current dynamic agents are saved
      // (config agents from communion.config.json are NOT saved here)
      writeFileSync(this.dynamicAgentsPath, JSON.stringify(existing, null, 2));
    } catch (err) {
      console.error('[AGENTS] Failed to save dynamic agents:', err);
    }
  }

  private saveDynamicAgent(agentConfig: AgentConfig, active: boolean, snapshot?: {
    voiceConfig?: AgentVoiceConfig;
    clockValue?: number;
    instructions?: string;
  }): void {
    try {
      let existing: Record<string, any> = {};
      if (existsSync(this.dynamicAgentsPath)) {
        existing = JSON.parse(readFileSync(this.dynamicAgentsPath, 'utf-8'));
      }

      existing[agentConfig.id] = {
        config: agentConfig,
        active,
        ...(snapshot?.voiceConfig && { voiceConfig: snapshot.voiceConfig }),
        ...(snapshot?.clockValue !== undefined && { clockValue: snapshot.clockValue }),
        ...(snapshot?.instructions && { instructions: snapshot.instructions }),
        updatedAt: new Date().toISOString(),
      };

      writeFileSync(this.dynamicAgentsPath, JSON.stringify(existing, null, 2));
    } catch (err) {
      console.error('[AGENTS] Failed to save dynamic agent:', err);
    }
  }

  private loadDynamicAgents(): void {
    try {
      if (!existsSync(this.dynamicAgentsPath)) return;
      const saved = JSON.parse(readFileSync(this.dynamicAgentsPath, 'utf-8'));
      let restored = 0;

      for (const [agentId, entry] of Object.entries(saved) as [string, any][]) {
        if (!entry.active || !entry.config) continue;

        const alreadyLoaded = this.agents.has(agentId);
        if (!alreadyLoaded) {
          const success = this.addAgent(entry.config);
          if (!success) continue;
          restored++;
        }

        // Always restore voice config, clock, and instructions — even if agent
        // was pre-loaded from static config at startup (server.ts fallback)
        if (entry.voiceConfig && this.voiceConfigs.has(agentId)) {
          Object.assign(this.voiceConfigs.get(agentId)!, entry.voiceConfig);
        }
        if (entry.clockValue !== undefined) {
          const rhythm = this.rhythm.get(agentId);
          if (rhythm) rhythm.tickEveryN = entry.clockValue;
        }
        if (entry.instructions) {
          this.customInstructions.set(agentId, entry.instructions);
        }
      }

      if (restored > 0) {
        console.log(`[AGENTS] Restored ${restored} dynamic agent(s) from saved config`);
      }
    } catch (err) {
      console.error('[AGENTS] Failed to load dynamic agents:', err);
    }
  }

  /**
   * Get all inactive (removed) agents that can be restored.
   */
  getInactiveAgents(): Array<{ id: string; name: string; provider: string; model: string; color?: string }> {
    try {
      if (!existsSync(this.dynamicAgentsPath)) return [];
      const saved = JSON.parse(readFileSync(this.dynamicAgentsPath, 'utf-8'));
      const result: Array<{ id: string; name: string; provider: string; model: string; color?: string }> = [];

      for (const [agentId, entry] of Object.entries(saved) as [string, any][]) {
        if (entry.active || !entry.config) continue;
        result.push({
          id: agentId,
          name: entry.config.name,
          provider: entry.config.provider,
          model: entry.config.model,
          color: entry.config.color,
        });
      }

      return result;
    } catch {
      return [];
    }
  }

  /**
   * Restore a previously removed agent from saved config.
   */
  restoreAgent(agentId: string): boolean {
    try {
      if (!existsSync(this.dynamicAgentsPath)) return false;
      const saved = JSON.parse(readFileSync(this.dynamicAgentsPath, 'utf-8'));
      const entry = saved[agentId];

      if (!entry || !entry.config) {
        console.error(`[AGENT] No saved config for "${agentId}"`);
        return false;
      }

      if (this.agents.has(agentId)) {
        console.error(`[AGENT] Cannot restore — "${agentId}" is already active`);
        return false;
      }

      const success = this.addAgent(entry.config);
      if (!success) return false;

      // Restore voice config
      if (entry.voiceConfig && this.voiceConfigs.has(agentId)) {
        Object.assign(this.voiceConfigs.get(agentId)!, entry.voiceConfig);
      }
      // Restore clock
      if (entry.clockValue !== undefined) {
        const rhythm = this.rhythm.get(agentId);
        if (rhythm) rhythm.tickEveryN = entry.clockValue;
      }
      // Restore instructions
      if (entry.instructions) {
        this.customInstructions.set(agentId, entry.instructions);
      }

      // Mark active again
      this.saveDynamicAgent(entry.config, true, {
        voiceConfig: entry.voiceConfig,
        clockValue: entry.clockValue,
        instructions: entry.instructions,
      });

      console.log(`[AGENT] Restored: ${entry.config.name} (${agentId})`);
      return true;
    } catch (err) {
      console.error('[AGENT] Restore failed:', err);
      return false;
    }
  }

  private get voiceConfigPath(): string {
    return join(this.dataDir, 'voice-configs.json');
  }

  private saveVoiceConfigs(): void {
    try {
      writeFileSync(this.voiceConfigPath, JSON.stringify(this.getAllVoiceConfigs(), null, 2));
    } catch (err) {
      console.error('[VOICE] Failed to save voice configs:', err);
    }
  }

  private loadVoiceConfigs(): void {
    try {
      if (!existsSync(this.voiceConfigPath)) return;
      const saved = JSON.parse(readFileSync(this.voiceConfigPath, 'utf-8'));
      for (const [agentId, config] of Object.entries(saved)) {
        if (this.voiceConfigs.has(agentId)) {
          Object.assign(this.voiceConfigs.get(agentId)!, config);
        }
      }
      const summary = [...this.voiceConfigs.entries()]
        .map(([id, c]) => `${id}=${c.enabled ? c.voiceId : 'muted'}`)
        .join(', ');
      console.log(`[VOICE] Loaded saved configs: ${summary}`);
    } catch (err) {
      console.error('[VOICE] Failed to load voice configs:', err);
    }
  }

  /**
   * Report speech completion from client (after audio finishes playing).
   * Resolves the waiting promise in synthesizeAndEmit, allowing the next agent to speak.
   */
  reportSpeechComplete(): void {
    console.log('[VOICE] Client reported playback complete');
    if (this.speechResolve) {
      this.speechResolve();
    } else {
      this.speaking = false;
    }
  }

  isSpeaking(): boolean {
    return this.speaking;
  }

  /**
   * Set whether the human is actively speaking into the mic.
   * Driven by client-side speech detection: true when interim results are
   * flowing in, false after silence. Blocks scheduled ticks while true.
   */
  setHumanSpeaking(active: boolean): void {
    if (this.humanSpeaking !== active) {
      this.humanSpeaking = active;
      console.log(`[COMMUNION] Human ${active ? 'speaking' : 'silent'}`);

      // When human stops speaking, trigger a tick so agents can respond promptly.
      // Without this, the next response waits for the interval timer.
      if (!active && !this.processing && !this.speaking && !this.paused) {
        console.log('[COMMUNION] Human stopped speaking — triggering tick');
        if (this.timer) {
          clearTimeout(this.timer);
        }
        this.tick().catch(err => console.error('[COMMUNION] Post-silence tick error:', err));
      }
    }
  }

  isHumanSpeaking(): boolean {
    return this.humanSpeaking;
  }

  /**
   * Fast-lane trigger for human-turn responsiveness.
   * If currently blocked by processing/speaking/humanSpeaking, retries quickly.
   */
  requestImmediateTick(reason: string = 'manual'): void {
    if (this.paused || !this.timer) return;
    if (this.processing || this.speaking || this.humanSpeaking) {
      this.scheduleRetry();
      return;
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.tick().catch(err => console.error(`[TICK] Immediate (${reason}) error:`, err));
    }, 0);
  }

  // ── Human Presence ──

  setHumanPresence(presence: HumanPresence): void {
    this.state.humanPresence = presence;
    // Switch RAM curation mode based on presence
    const mode = presence === 'here' ? 'active' : 'reflective';
    for (const [, ram] of this.ram) {
      ram.setMode(mode);
    }
    console.log(`[PRESENCE] Human is now ${presence} — RAM curation mode: ${mode}`);
  }

  getHumanPresence(): HumanPresence {
    return this.state.humanPresence;
  }

  // ════════════════════════════════════════════
  // Graph registration helpers
  // ════════════════════════════════════════════

  /**
   * Register a scroll in the graph with all its existing relationships
   */
  private registerScrollInGraph(scroll: ScrollEcho, sessionUri?: string): void {
    const uri = `scroll:${scroll.id}`;
    if (this.graph.hasNode(uri)) return; // Already registered

    const scrollData: Record<string, unknown> = { content: scroll.content, timestamp: scroll.timestamp, location: scroll.location, resonance: scroll.resonance, tags: scroll.tags, sourceModel: scroll.sourceModel, scrollfireMarked: scroll.scrollfireMarked };
    this.graph.addNode(uri, 'ScrollEcho', tagForBand(scrollData, classifyBand('ScrollEcho', scrollData), this.state.tickCount));

    // Link to related scrolls
    for (const relatedId of scroll.relatedScrollIds) {
      this.graph.link(uri, 'relatedTo', `scroll:${relatedId}`);
    }

    // Link to parent
    if (scroll.parentScrollId) {
      this.graph.link(uri, 'childOf', `scroll:${scroll.parentScrollId}`);
    }

    // Link to session
    if (sessionUri) {
      this.graph.link(uri, 'occurredDuring', sessionUri);
    }
  }

  /**
   * Register a detected pattern in the graph with links to its scrolls
   */
  private registerPatternInGraph(pattern: any, sessionUri?: string): void {
    const uri = `pattern:${pattern.id}`;
    if (this.graph.hasNode(uri)) return;

    const patData = { type: pattern.type, name: pattern.name, description: pattern.description, strength: pattern.strength, confidence: pattern.confidence, tags: pattern.tags };
    this.graph.addNode(uri, 'DetectedPattern', tagForBand(patData, classifyBand('DetectedPattern', patData), this.state.tickCount));

    // Link pattern to all scrolls it was detected in
    if (pattern.scrollIds) {
      for (const scrollId of pattern.scrollIds) {
        this.graph.link(uri, 'containsScroll', `scroll:${scrollId}`);
      }
    }

    // Link to child patterns (meta-patterns)
    if (pattern.childPatternIds) {
      for (const childId of pattern.childPatternIds) {
        this.graph.link(uri, 'containsScroll', `pattern:${childId}`);
      }
    }

    // Link to session
    if (sessionUri) {
      this.graph.link(uri, 'occurredDuring', sessionUri);
    }
  }

  private ensureSessionCurrentNode(sessionUri: string, sessionId: string): void {
    this.graph.addNode('session:current', 'Session', {
      sessionId,
      currentSessionUri: sessionUri,
      updatedAt: new Date().toISOString(),
    });
    if (sessionUri !== 'session:current') {
      this.graph.link('session:current', 'relatedTo', sessionUri);
    }
  }

  getGraph(): ScrollGraph {
    return this.graph;
  }

  /**
   * Schedule the next tick after the configured delay.
   * Called after a tick completes — the delay is the breathing room between ticks.
   */
  private scheduleNextTick(): void {
    if (this.paused || !this.timer) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.tick().catch(err => console.error('[TICK] Unhandled error:', err)), this.tickIntervalMs);
  }

  /**
   * Quick retry when a tick was blocked (processing/speaking/humanSpeaking).
   * Polls at 500ms so we catch the moment the block clears without adding
   * a full tickIntervalMs of dead time after every blocked attempt.
   */
  private scheduleRetry(): void {
    if (this.paused || !this.timer) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.tick().catch(err => console.error('[TICK] Retry error:', err)), 500);
  }

  start(): void {
    if (this.timer) return;
    console.log(`[COMMUNION] Starting loop (tick every ${this.tickIntervalMs / 1000}s, ${this.agents.size} agents)`);

    // Use a sentinel value so scheduleNextTick knows the loop is active.
    // First tick fires immediately; tick() calls scheduleNextTick() on completion.
    this.timer = setTimeout(() => {}, 0) as any;
    this.tick().catch(err => console.error('[TICK] Start error:', err));
  }

  pause(): void {
    this.paused = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // If a tick is mid-execution with staggered delays, let it finish
    // but the next tick will be blocked by this.paused = true
    console.log('[COMMUNION] Paused');
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.processing = false; // Reset in case a tick was mid-execution when paused
    this.timer = setTimeout(() => this.tick().catch(err => console.error('[TICK] Resume error:', err)), this.tickIntervalMs);
    console.log(`[COMMUNION] Resumed (tick every ${this.tickIntervalMs / 1000}s)`);
  }

  isPaused(): boolean {
    return this.paused;
  }

  /**
   * Set per-agent clock multiplier — agent activates every N master ticks.
   * tickEveryN=1 means every tick, 2 means every other tick, etc.
   */
  setAgentClock(agentId: string, tickEveryN: number): void {
    // Clamp: -5 (5x fast) to 20 (every 20th tick). Skip 0 → treat as 1.
    let clamped = Math.round(tickEveryN);
    if (clamped === 0) clamped = 1;
    clamped = Math.max(-5, Math.min(20, clamped));
    const rhythm = this.rhythm.get(agentId);
    if (rhythm) {
      rhythm.tickEveryN = clamped;
      const desc = clamped < 0 ? `${Math.abs(clamped)}x per tick` : clamped === 1 ? 'every tick' : `every ${clamped} ticks`;
      console.log(`[CLOCK] ${this.state.agentNames[agentId] || agentId}: ${desc}`);
      this.saveAgentClocks();
    }
  }

  getAgentClock(agentId: string): number {
    return this.rhythm.get(agentId)?.tickEveryN || 1;
  }

  getAllAgentClocks(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [id, rhythm] of this.rhythm) {
      result[id] = rhythm.tickEveryN;
    }
    return result;
  }

  // ════════════════════════════════════════════
  // Custom Instructions — per-agent user instructions
  // ════════════════════════════════════════════

  setCustomInstructions(agentId: string, instructions: string): void {
    this.customInstructions.set(agentId, instructions);
    console.log(`[INSTRUCTIONS] ${this.state.agentNames[agentId] || agentId}: ${instructions ? instructions.substring(0, 60) + '...' : '(cleared)'}`);
    this.saveCustomInstructions();
  }

  getCustomInstructions(agentId: string): string {
    return this.customInstructions.get(agentId) || '';
  }

  getAllCustomInstructions(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [id, instructions] of this.customInstructions) {
      result[id] = instructions;
    }
    return result;
  }

  private get customInstructionsPath(): string {
    return join(this.dataDir, 'custom-instructions.json');
  }

  private saveCustomInstructions(): void {
    try {
      writeFileSync(this.customInstructionsPath, JSON.stringify(this.getAllCustomInstructions(), null, 2));
    } catch (err) {
      console.error('[INSTRUCTIONS] Failed to save:', err);
    }
  }

  private loadCustomInstructions(): void {
    try {
      if (!existsSync(this.customInstructionsPath)) return;
      const saved = JSON.parse(readFileSync(this.customInstructionsPath, 'utf-8'));
      for (const [agentId, instructions] of Object.entries(saved)) {
        if (typeof instructions === 'string' && instructions.trim()) {
          this.customInstructions.set(agentId, instructions);
        }
      }
      const count = this.customInstructions.size;
      if (count > 0) {
        console.log(`[INSTRUCTIONS] Loaded custom instructions for ${count} agent(s)`);
      }
    } catch (err) {
      console.error('[INSTRUCTIONS] Failed to load:', err);
    }
  }

  private get agentClockPath(): string {
    return join(this.dataDir, 'agent-clocks.json');
  }

  private saveAgentClocks(): void {
    try {
      writeFileSync(this.agentClockPath, JSON.stringify(this.getAllAgentClocks(), null, 2));
    } catch (err) {
      console.error('[CLOCK] Failed to save agent clocks:', err);
    }
  }

  private loadAgentClocks(): void {
    try {
      if (!existsSync(this.agentClockPath)) return;
      const saved = JSON.parse(readFileSync(this.agentClockPath, 'utf-8'));
      for (const [agentId, tickEveryN] of Object.entries(saved)) {
        const rhythm = this.rhythm.get(agentId);
        if (rhythm && typeof tickEveryN === 'number') {
          const v = Math.round(tickEveryN as number);
          rhythm.tickEveryN = Math.max(-5, Math.min(20, v === 0 ? 1 : v));
        }
      }
      const summary = [...this.rhythm.entries()]
        .map(([id, r]) => `${this.state.agentNames[id] || id}=${r.tickEveryN}`)
        .join(', ');
      console.log(`[CLOCK] Loaded saved clocks: ${summary}`);
    } catch (err) {
      console.error('[CLOCK] Failed to load agent clocks:', err);
    }
  }

  // ════════════════════════════════════════════
  // Dynamic Agent Management — add/remove at runtime
  // ════════════════════════════════════════════

  /**
   * Add a new agent to the communion at runtime.
   * Creates backend, system prompt, rhythm, RAM, voice, journal, and graph node.
   */
  addAgent(agentConfig: AgentConfig): boolean {
    if (this.agents.has(agentConfig.id)) {
      console.error(`[AGENT] Cannot add — agent "${agentConfig.id}" already exists`);
      return false;
    }

    // Build system prompt using all current agents + the new one
    const allConfigs = [
      ...Array.from(this.agents.values()).map(a => a.config),
      agentConfig,
    ];
    const backend = createBackend(agentConfig);
    const systemPrompt = agentConfig.systemPrompt || buildDefaultSystemPrompt(agentConfig, allConfigs, this.state.humanName);

    // Load persisted brain state for Alois agents
    if ('loadBrain' in backend) {
      const brainPath = join(this.dataDir, 'brain-tissue.json');
      if ((backend as any).loadBrain(brainPath)) {
        console.log(`[ALOIS] Restored brain for ${agentConfig.name} from ${brainPath}`);
      }
    }

    this.agents.set(agentConfig.id, { backend, config: agentConfig, systemPrompt });

    // State
    this.state.agentIds.push(agentConfig.id);
    this.state.agentNames[agentConfig.id] = agentConfig.name;
    const colorIndex = this.state.agentIds.length - 1;
    this.state.agentColors[agentConfig.id] = agentConfig.color || DEFAULT_COLORS[colorIndex % DEFAULT_COLORS.length];
    // Don't clobber journal entries that may already be loaded from disk
    if (!this.state.journals[agentConfig.id]) this.state.journals[agentConfig.id] = [];

    // Journal on disk
    const journalPath = `${this.dataDir}/journal-${agentConfig.id}.jsonld`;
    const journal = new Journal(journalPath);
    this.journals.set(agentConfig.id, journal);
    journal.initialize().catch(err => console.error(`[AGENT] Journal init error for ${agentConfig.id}:`, err));

    // Rhythm
    this.rhythm.set(agentConfig.id, {
      intentToSpeak: 0.3,
      ticksSinceSpoke: 0,
      ticksSinceActive: 0,
      lastInterruptAt: 0,
      microTickOffset: MICRO_TICK_MIN_MS + Math.random() * (MICRO_TICK_MAX_MS - MICRO_TICK_MIN_MS),
      tickEveryN: agentConfig.tickEveryN || 1,
    });

    // Context RAM
    const ram = new ContextRAM(agentConfig.id, agentConfig.name, agentConfig.provider, agentConfig.baseUrl);
    ram.setBrowseCallback((keyword, r) => this.browseFiles(keyword, r));
    ram.setGraphCallback((nodeUri) => this.traverseGraphNode(nodeUri));
    this.ram.set(agentConfig.id, ram);

    // Voice
    this.voiceConfigs.set(agentConfig.id, getDefaultVoiceConfig(agentConfig.id, agentConfig.provider, agentConfig.baseUrl));
    if (agentConfig.voice) {
      Object.assign(this.voiceConfigs.get(agentConfig.id)!, agentConfig.voice);
    }

    // Graph
    this.graph.addNode(`agent:${agentConfig.id}`, 'Agent', {
      name: agentConfig.name,
      provider: agentConfig.provider,
      model: agentConfig.model,
      color: agentConfig.color,
    });

    // Save to dynamic agents file for persistence across restarts
    // Preserve any existing snapshot data (voice, clock, instructions) so restarts don't wipe them
    let existingSnapshot: any = {};
    try {
      if (existsSync(this.dynamicAgentsPath)) {
        const saved = JSON.parse(readFileSync(this.dynamicAgentsPath, 'utf-8'));
        if (saved[agentConfig.id]) {
          existingSnapshot = {
            voiceConfig: saved[agentConfig.id].voiceConfig,
            clockValue: saved[agentConfig.id].clockValue,
            instructions: saved[agentConfig.id].instructions,
          };
        }
      }
    } catch {}
    this.saveDynamicAgent(agentConfig, true, existingSnapshot);

    console.log(`[AGENT] Added: ${agentConfig.name} (${agentConfig.id}) — ${agentConfig.provider}/${agentConfig.model}`);
    return true;
  }

  /**
   * Remove an agent from the communion at runtime.
   * Snapshots all state (voice, clock, instructions) before removing so the agent
   * can be fully restored later. Journal history on disk is always preserved.
   */
  removeAgent(agentId: string): boolean {
    if (!this.agents.has(agentId)) {
      console.error(`[AGENT] Cannot remove — agent "${agentId}" not found`);
      return false;
    }

    const name = this.state.agentNames[agentId] || agentId;
    const agentEntry = this.agents.get(agentId)!;

    // Snapshot current state before removal
    const voiceConfig = this.voiceConfigs.get(agentId);
    const rhythm = this.rhythm.get(agentId);
    const instructions = this.customInstructions.get(agentId);

    // Save snapshot to dynamic-agents.json (marked inactive) — skip static env-var agents
    if (!this.staticAgentIds.has(agentId)) {
      this.saveDynamicAgent(agentEntry.config, false, {
        voiceConfig: voiceConfig ? { ...voiceConfig } : undefined,
        clockValue: rhythm?.tickEveryN,
        instructions: instructions || undefined,
      });
    }

    // Clean up runtime state
    this.agents.delete(agentId);
    this.state.agentIds = this.state.agentIds.filter(id => id !== agentId);
    delete this.state.agentNames[agentId];
    delete this.state.agentColors[agentId];

    this.rhythm.delete(agentId);
    this.ram.delete(agentId);
    this.voiceConfigs.delete(agentId);
    this.customInstructions.delete(agentId);

    console.log(`[AGENT] Removed: ${name} (${agentId}) — state saved for restoration`);
    return true;
  }

  /**
   * Get all current agent configs (for config save / serialization).
   */
  getAgentConfigs(): AgentConfig[] {
    return Array.from(this.agents.values()).map(a => a.config);
  }

  /** Get an agent's backend instance (for direct API access, e.g. Alois dream trigger) */
  getAgentBackend(agentId: string): AgentBackend | null {
    const agent = this.agents.get(agentId);
    return agent ? agent.backend : null;
  }

  /** Get archive ingestion status for brain monitor */
  getIngestStatus(): import('./archiveIngestion').IngestionStatus | null {
    return this.archiveIngestion?.getStatus() ?? null;
  }

  setTickSpeed(ms: number): void {
    this.tickIntervalMs = Math.max(3000, Math.min(1800000, ms)); // clamp 3s–30min
    if (this.timer && !this.paused) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.tick().catch(err => console.error('[TICK] Speed-change error:', err)), this.tickIntervalMs);
    }
    console.log(`[COMMUNION] Tick speed set to ${this.tickIntervalMs / 1000}s`);
  }

  getTickSpeed(): number {
    return this.tickIntervalMs;
  }

  /**
   * [RAM:READ filepath] — load the full content of a file into the documents RAM slot.
   * Searches graph Document nodes by path match, falls back to disk search.
   */
  private readFileIntoRAM(target: string, ram: ContextRAM): string {
    const targetLower = (target || '').toLowerCase().trim();
    const targetNormalized = targetLower.replace(/[^a-z0-9]+/g, ' ').trim();
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'from']);
    const rawTokens = targetNormalized.split(/\s+/).filter(t => t.length > 1);
    const tokens = rawTokens.filter(t => !stopWords.has(t));
    const effectiveTokens = tokens.length > 0 ? tokens : rawTokens;

    // Find the best matching Document node
    let bestPath: string | null = null;
    let bestScore = 0;
    for (const node of this.graph.getByType('Document')) {
      const fullPath = node.data.fullPath as string;
      if (!fullPath || !existsSync(fullPath)) continue;
      const pathLower = fullPath.toLowerCase();
      const pathNormalized = pathLower.replace(/[^a-z0-9]+/g, ' ');
      const baseName = fullPath.replace(/^.*[/\\]/, '').toLowerCase();
      // Exact substring match scores highest
      const exactScore = (pathLower.includes(targetLower) || (targetNormalized.length > 0 && pathNormalized.includes(targetNormalized))) ? 1000 : 0;
      const baseNameScore = (baseName.includes(targetLower) || (targetNormalized.length > 0 && baseName.replace(/[^a-z0-9]+/g, ' ').includes(targetNormalized))) ? 200 : 0;
      const tokenScore = effectiveTokens.filter(t => pathNormalized.includes(t)).length;
      const score = exactScore + baseNameScore + tokenScore;
      if (score > bestScore) { bestScore = score; bestPath = fullPath; }
    }

    // Fallback: direct file path (absolute or relative to cwd)
    if (!bestPath || bestScore === 0) {
      const { resolve: r } = require('path');
      for (const candidate of [target, r(process.cwd(), target), r(process.cwd(), this.dataDir, target), r(process.cwd(), 'communion-docs', target)]) {
        if (existsSync(candidate) && statSync(candidate).isFile()) { bestPath = candidate; break; }
      }
    }

    if (!bestPath) return `File not found: "${target}"`;

    try {
      const isDocx = bestPath.toLowerCase().endsWith('.docx');
      let content: string;
      if (isDocx) {
        content = this.docxCache.get(bestPath) ?? '';
        if (!content) return `DOCX not yet extracted: "${bestPath}" — try again in a moment`;
      } else {
        content = readFileSync(bestPath, 'utf-8');
      }

      // Cap at 24k chars to fit comfortably in documents slot
      const MAX = 24000;
      const truncated = content.length > MAX;
      const snippet = truncated ? content.slice(0, MAX) + `\n\n[...truncated — ${content.length - MAX} chars omitted]` : content;

      const itemId = `doc:${bestPath}:full`;
      const label = bestPath.replace(/^.*[/\\]/, ''); // basename
      // Ensure the documents slot is active — force-load it if it was dropped
      if (!ram.isLoaded('documents')) {
        ram.processCommand({ action: 'load', target: 'documents' });
      }
      ram.offerItem('documents', { id: itemId, label: `FULL: ${label}`, content: snippet, chars: snippet.length, tags: effectiveTokens });
      ram.processCommand({ action: 'pin', target: itemId }); // auto-pin — survives tick auto-curation
      return `Loaded full file: ${label} (${content.length} chars${truncated ? ', truncated to 24k' : ''}) — pinned, will not be auto-evicted`;
    } catch (err) {
      return `Read error: ${String(err)}`;
    }
  }

  /** Synchronous brain save — called from process.on('exit') as a last resort. */
  saveBrainSync(): void {
    for (const [, agent] of this.agents) {
      if ('saveBrain' in agent.backend) {
        try {
          (agent.backend as any).saveBrain(join(this.dataDir, 'brain-tissue.json'));
        } catch { /* best effort */ }
      }
    }
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.archiveIngestion?.stop();
    this.docWatcher?.close();
    this.buffer.stop();

    // Stop heartbeat on any Alois backend — PulseLoop holds the event loop open otherwise
    for (const [, agent] of this.agents) {
      if ('stopHeartbeat' in agent.backend) {
        try { (agent.backend as any).stopHeartbeat(); } catch { /* ignore */ }
      }
    }

    // ── Brain save FIRST — synchronous, survives a hard kill ──
    let brainSaved = false;
    for (const [agentId, agent] of this.agents) {
      if ('saveBrain' in agent.backend) {
        try {
          const brainPath = join(this.dataDir, 'brain-tissue.json');
          (agent.backend as any).saveBrain(brainPath);
          console.log(`[ALOIS] Brain saved for ${agent.config.name}`);
          brainSaved = true;
        } catch (err) {
          console.error(`[ALOIS] Failed to save brain for ${agentId}:`, err);
        }
      }
    }
    if (brainSaved) {
      this.archiveIngestion?.markBrainPersisted();
      console.log('[INGEST] Brain-persisted flag set on shutdown');
    }

    // Final session save
    try {
      await this.session.closeSession();
      console.log('[PERSISTENCE] Session saved and closed');
    } catch (err) {
      console.error('[PERSISTENCE] Error saving session:', err);
    }

    // Final graph save
    try {
      await this.graph.save();
      const stats = this.graph.getStats();
      console.log(`[GRAPH] Saved: ${stats.totalNodes} nodes, ${stats.totalEdges} edges`);
    } catch (err) {
      console.error('[GRAPH] Error saving graph:', err);
    }

    console.log('[COMMUNION] Loop stopped');
  }
}

