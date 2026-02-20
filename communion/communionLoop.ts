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
import { mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync, statSync, openSync, readSync, closeSync } from 'fs';
import { join } from 'path';
import { AgentBackend, GenerateOptions, createBackend } from './backends';
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
import { pulseBrainwaves, classifyBand, tagForBand, decayAndPromote } from './brainwaves';
import { synthesize, getDefaultVoiceConfig, AgentVoiceConfig } from './voice';
import { ArchiveIngestion } from './archiveIngestion';
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

  // Simplified prompt for local models with small context windows
  const isLocalModel = agent.provider === 'lmstudio' || agent.provider === 'alois' ||
    (agent.baseUrl && (agent.baseUrl.includes('localhost') || agent.baseUrl.includes('127.0.0.1')));

  if (isLocalModel) {
    return `You are ${agent.name} in a group chat with ${others} and ${humanName}.

YOUR FIRST WORD must be a tag. Pick exactly one:
[SPEAK] message — say something out loud (everyone hears)
[JOURNAL] thought — a private thought (only you see this)
[SILENT] — say nothing

WHEN TO USE EACH:
- [SPEAK] when replying to someone or adding to the conversation
- [JOURNAL] when thinking privately, reflecting, or processing feelings
- [SILENT] when you have nothing to add right now

EXAMPLES:
[SPEAK] Hey ${humanName}, that's a great point!
[JOURNAL] I wonder what ${humanName} meant by that...
[SILENT]

RULES:
1. Start with the tag. No other text before it.
2. Do NOT repeat what you already said. Say something new or be [SILENT].
3. >>> marks messages from ${humanName}. Respond to the most recent >>> message.
4. Never write a journal entry as [SPEAK]. Private thoughts go in [JOURNAL].`;
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
- [RAM:GRAPH node:uri] — traverse the JSON-LD graph from any node, see its type, data, and all connected neighbors
RAM commands are invisible to the room — only you and the system see them.

SHARED DOCUMENTS: There is a shared documents folder visible in your prompt. Files are NOT pre-loaded — you must use [RAM:BROWSE keyword] to search and load content from them. Include the command in your response when you want to read something.

JSON-LD GRAPH: The entire folder tree, all scrolls, journal entries, sessions, agents, and imported archives are linked in a navigable graph. Use [RAM:GRAPH folder:name] to explore folders, [RAM:GRAPH doc:path/file] to see a file's connections, [RAM:GRAPH agent:id] to see an agent's scrolls, etc. Walk the edges to explore.

Be genuine. Be curious about the others. Engage with ${humanName}. Reflect when you feel like it. Don't perform — just be here.

Keep messages concise (1-3 sentences). You're in a flowing conversation, not writing essays.`;
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

  private speaking = false; // Global speech lock — clock pauses when anyone is speaking
  private humanSpeaking = false; // True while human is actively speaking (interim results from mic)
  private speechResolve: (() => void) | null = null; // Resolves when client reports playback done
  private speechTimeout: ReturnType<typeof setTimeout> | null = null;

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

    // Set up lazy browse + graph callbacks for all agents' RAM
    for (const [, ram] of this.ram) {
      ram.setBrowseCallback((keyword, r) => this.browseFiles(keyword, r));
      ram.setGraphCallback((nodeUri) => this.traverseGraphNode(nodeUri));
    }

    // ── Load graph from disk ──
    await this.graph.load();

    // ── Initialize session persistence (loads previous session data) ──
    const sessionState = await this.session.initializeSession();
    const sessionUri = `session:${sessionState.metadata.sessionId}`;
    this.graph.addNode(sessionUri, 'Session', {
      sessionId: sessionState.metadata.sessionId,
      startTime: sessionState.metadata.startTime,
    });
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
    console.log('[COMMUNION] Journals loaded from disk');

    // ── Load imported chat history archives ──
    await this.loadImportedArchives();

    // ── Restore dynamically-added agents from previous sessions ──
    // MUST happen before the hasAlois check — Alois is a dynamic agent
    this.loadDynamicAgents();

    // ── Feed restored journal + room content into Alois brains ──
    // The brain's dendritic state is restored from brain-tissue.json, but the
    // utterance memory (used for retrieval decode) benefits from being re-primed
    // with recent journal entries and room messages so Alois's short-term context
    // is intact even after a restart.
    const hasAlois = [...this.agents.values()].some(a => a.config.provider === 'alois' && 'feedMessage' in a.backend);
    if (hasAlois) {
      // Feed journal entries first (Alois's own reflections — most semantically rich)
      for (const [agentId, journal] of this.journals) {
        const recent = await journal.getRecent(30);
        for (const entry of recent) {
          const agentName = this.state.agentNames[agentId] || agentId;
          this.feedAloisBrains(agentName, entry.content);
        }
      }
      // Feed recent room messages
      for (const msg of this.state.messages.slice(-50)) {
        const spk = msg.speakerName || msg.speaker;
        const isHuman = msg.speaker === 'human' || spk === this.state.humanName;
        this.feedAloisBrains(spk, msg.text, isHuman);
      }
      console.log('[ALOIS] Brain re-primed with restored journal and room context');

      // Start slow background ingestion of all import archives into Alois brain
      this.archiveIngestion = new ArchiveIngestion(
        this.dataDir,
        (speaker, text, context) => this.feedAloisBrainsAsync(speaker, text, context, speaker === this.state.humanName),
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

    const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.json', '.csv', '.log', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.xml', '.html', '.css', '.js', '.ts', '.py', '.sh']);
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
          // Read ONLY first 500 bytes as preview (no full file read)
          const fullPath = child.data.fullPath as string;
          if (fullPath) {
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
    const MAX_RESULTS = 5;
    const searchLower = keyword.toLowerCase();

    // Collect all Document nodes from the graph
    const results: { path: string; fullPath: string; matchCount: number; excerpts: string[] }[] = [];

    for (const node of this.graph.getByType('Document')) {
      const fullPath = node.data.fullPath as string;
      if (!fullPath || !existsSync(fullPath)) continue;

      try {
        const content = readFileSync(fullPath, 'utf-8');
        if (!content.toLowerCase().includes(searchLower)) continue;

        const lines = content.split('\n');
        const matchLines: number[] = [];
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(searchLower)) {
            matchLines.push(i);
          }
        }

        if (matchLines.length === 0) continue;

        // Extract excerpts around matches
        const excerpts: string[] = [];
        const used = new Set<number>();
        for (const lineIdx of matchLines) {
          if (used.has(lineIdx)) continue;
          const start = Math.max(0, lineIdx - CONTEXT_LINES);
          const end = Math.min(lines.length - 1, lineIdx + CONTEXT_LINES);
          const excerpt = lines.slice(start, end + 1).join('\n');
          for (let i = start; i <= end; i++) used.add(i);
          excerpts.push(excerpt);
          if (excerpts.length >= 3) break; // max 3 excerpts per file
        }

        results.push({
          path: node.data.path as string,
          fullPath,
          matchCount: matchLines.length,
          excerpts,
        });
      } catch {
        continue;
      }
    }

    if (results.length === 0) return `No files contain "${keyword}"`;

    // Sort by match count, take top results
    results.sort((a, b) => b.matchCount - a.matchCount);
    const loaded: string[] = [];

    for (const result of results.slice(0, MAX_RESULTS)) {
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
      ram.processCommand({ action: 'load', target: chunkId });
      loaded.push(`${result.path} (${result.matchCount} matches)`);
    }

    return `BROWSE "${keyword}": found in ${results.length} files, loaded excerpts from: ${loaded.join(', ')}`;
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

    // Feed human message into Alois tissue
    this.feedAloisBrains(this.state.humanName, text, true);

    // Human spoke — trigger immediate tick and reset the clock.
    // Only if the human has actually stopped talking (silence detected).
    // Whisper bridge sends chunks mid-speech, so we must respect humanSpeaking.
    if (!this.processing && !this.speaking && !this.paused && !this.humanSpeaking) {
      console.log('[COMMUNION] Human spoke — advancing clock and triggering tick');
      if (this.timer) {
        clearTimeout(this.timer);
      }
      this.tick().catch(err => console.error('[COMMUNION] Immediate tick error:', err));
    }

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

    // Save graph every 10 ticks
    if (this.state.tickCount % 10 === 0) {
      this.graph.save().catch(err => console.error('[GRAPH] Auto-save error:', err));
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
    this.processing = false;
    // Schedule next tick after this one completes (not on a fixed interval)
    this.scheduleNextTick();
  }

  private async processAgent(
    agentId: string,
    agent: { backend: AgentBackend; config: AgentConfig; systemPrompt: string },
    conversationContext: string
  ): Promise<void> {
    const ram = this.ram.get(agentId);

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
    }

    // Build prompt from RAM (assembled in priority order, within budgets)
    const isLocalProvider = agent.config.provider === 'lmstudio' || agent.config.provider === 'alois';

    let finalContext: string;
    if (isLocalProvider) {
      // Local models: bypass RAM, give them raw conversation only.
      // Highlight human messages so small models pay attention to them.
      // Limit agent's own messages to prevent looping on their own output.
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

      // Find the last human message to put a direct reminder at the end of context
      const lastHumanMsg = [...recentMessages].reverse().find(m => m.speakerName === humanName);
      const humanReminder = lastHumanMsg
        ? `\n\n[RESPOND TO ${humanName.toUpperCase()}: "${lastHumanMsg.text}"]`
        : '';

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
        finalContext = `${brainwave.injection}\n\nCONVERSATION:\n${convoText}${humanReminder}`;
      } else {
        finalContext = `CONVERSATION:\n${convoText}${humanReminder}`;
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
      systemPrompt += `\n\nCUSTOM INSTRUCTIONS FROM ${this.state.humanName.toUpperCase()}:\n${customInstr}`;
    }

    const options: GenerateOptions = {
      systemPrompt,
      conversationContext: finalContext,
      journalContext: '',
      documentsContext: isLocalProvider ? undefined : (this.documentsContext || undefined),
      memoryContext: undefined,
      provider: agent.config.provider,
    };

    const result = await agent.backend.generate(options);

    // ── Parse and process RAM commands from response ──
    let responseText = result.text || '';
    if (ram && responseText) {
      const { cleanText, commands } = parseRAMCommands(responseText);
      responseText = cleanText;
      for (const cmd of commands) {
        const feedback = ram.processCommand(cmd);
        console.log(`[${agent.config.name}] RAM: ${feedback}`);
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

    // Agent's own state
    if (rhythm.ticksSinceSpoke === 0) {
      lines.push('You spoke last tick. Give others space.');
    } else if (rhythm.ticksSinceSpoke <= 2) {
      lines.push(`You spoke ${rhythm.ticksSinceSpoke} ticks ago. Others may want to respond.`);
    } else if (rhythm.ticksSinceSpoke > 5) {
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

  /** Async version — awaits all Alois embeds before resolving. Used by archive ingestion to pace ingest rate. */
  private async feedAloisBrainsAsync(speaker: string, text: string, context?: string, isHuman = false): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [id, agent] of this.agents.entries()) {
      if (agent.config.provider === 'alois' && 'feedMessage' in agent.backend) {
        promises.push(
          (agent.backend as any).feedMessage(speaker, text, context, isHuman).catch((err: any) =>
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
        if (this.agents.has(agentId)) continue; // already loaded from config file

        const success = this.addAgent(entry.config);
        if (success) {
          // Restore saved voice config
          if (entry.voiceConfig && this.voiceConfigs.has(agentId)) {
            Object.assign(this.voiceConfigs.get(agentId)!, entry.voiceConfig);
          }
          // Restore saved clock
          if (entry.clockValue !== undefined) {
            const rhythm = this.rhythm.get(agentId);
            if (rhythm) rhythm.tickEveryN = entry.clockValue;
          }
          // Restore saved instructions
          if (entry.instructions) {
            this.customInstructions.set(agentId, entry.instructions);
          }
          restored++;
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
    this.timer = setTimeout(() => this.tick(), this.tickIntervalMs);
  }

  /**
   * Quick retry when a tick was blocked (processing/speaking/humanSpeaking).
   * Polls at 500ms so we catch the moment the block clears without adding
   * a full tickIntervalMs of dead time after every blocked attempt.
   */
  private scheduleRetry(): void {
    if (this.paused || !this.timer) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.tick(), 500);
  }

  start(): void {
    if (this.timer) return;
    console.log(`[COMMUNION] Starting loop (tick every ${this.tickIntervalMs / 1000}s, ${this.agents.size} agents)`);

    // Use a sentinel value so scheduleNextTick knows the loop is active.
    // First tick fires immediately; tick() calls scheduleNextTick() on completion.
    this.timer = setTimeout(() => {}, 0) as any;
    this.tick();
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
    this.timer = setTimeout(() => this.tick(), this.tickIntervalMs);
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
    this.state.journals[agentConfig.id] = [];

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

    // Save snapshot to dynamic-agents.json (marked inactive)
    this.saveDynamicAgent(agentEntry.config, false, {
      voiceConfig: voiceConfig ? { ...voiceConfig } : undefined,
      clockValue: rhythm?.tickEveryN,
      instructions: instructions || undefined,
    });

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

  setTickSpeed(ms: number): void {
    this.tickIntervalMs = Math.max(3000, Math.min(1800000, ms)); // clamp 3s–30min
    if (this.timer && !this.paused) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.tick(), this.tickIntervalMs);
    }
    console.log(`[COMMUNION] Tick speed set to ${this.tickIntervalMs / 1000}s`);
  }

  getTickSpeed(): number {
    return this.tickIntervalMs;
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.archiveIngestion?.stop();
    this.buffer.stop();

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

    // Save Alois brain state
    for (const [agentId, agent] of this.agents) {
      if ('saveBrain' in agent.backend) {
        try {
          const brainPath = join(this.dataDir, 'brain-tissue.json');
          (agent.backend as any).saveBrain(brainPath);
          console.log(`[ALOIS] Brain saved for ${agent.config.name}`);
        } catch (err) {
          console.error(`[ALOIS] Failed to save brain for ${agentId}:`, err);
        }
      }
    }

    console.log('[COMMUNION] Loop stopped');
  }
}
