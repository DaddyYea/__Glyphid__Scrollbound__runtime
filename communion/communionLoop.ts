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
import { mkdirSync, existsSync, readdirSync, readFileSync, statSync } from 'fs';
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
import { synthesize, getDefaultVoiceConfig, AgentVoiceConfig } from './voice';
import type { ScrollEcho, MoodVector } from '../src/types';

// ── Events ──

export type CommunionEventType = 'room-message' | 'journal-entry' | 'tick' | 'error' | 'backchannel' | 'speech-start' | 'speech-end';

export interface CommunionEvent {
  type: CommunionEventType;
  message?: CommunionMessage;
  tickCount?: number;
  error?: string;
  agentId?: string;
  /** Base64 audio data for speech events */
  audioBase64?: string;
  /** Audio format */
  audioFormat?: 'mp3' | 'pcm';
  /** Audio sample rate (for PCM) */
  audioSampleRate?: number;
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
RAM commands are invisible to the room — only you and the system see them.

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
const MICRO_TICK_MIN_MS = 1000;           // Stagger offset range: 1-4 seconds
const MICRO_TICK_MAX_MS = 4000;

// ── Loop ──

export class CommunionLoop {
  private agents: Map<string, { backend: AgentBackend; config: AgentConfig; systemPrompt: string }> = new Map();
  private state: CommunionState;
  private listeners: CommunionListener[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
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
  private speaking = false; // Global speech lock — clock pauses when anyone is speaking

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
      this.graph.addNode(sfUri, 'ScrollfireEvent', {
        scrollId: scroll.id,
        reason: event.reason || 'elevation',
        timestamp: scroll.timestamp,
        resonance: scroll.resonance,
      });
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

      this.agents.set(agentConfig.id, { backend, config: agentConfig, systemPrompt });

      agentIds.push(agentConfig.id);
      agentNames[agentConfig.id] = agentConfig.name;
      agentColors[agentConfig.id] = agentConfig.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length];
      journals[agentConfig.id] = [];

      // Per-agent journal on disk
      const journalPath = `${this.dataDir}/journal-${agentConfig.id}.jsonld`;
      const journal = new Journal(journalPath);
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
      });
      this.ram.set(agentConfig.id, new ContextRAM(
        agentConfig.id,
        agentConfig.name,
        agentConfig.provider,
        agentConfig.baseUrl,
      ));
      // Initialize voice config (from agent config or defaults)
      if (agentConfig.voice) {
        this.voiceConfigs.set(agentConfig.id, { ...agentConfig.voice });
      } else {
        this.voiceConfigs.set(agentConfig.id, getDefaultVoiceConfig(agentConfig.id, agentConfig.provider, agentConfig.baseUrl));
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
    // Load shared documents
    this.loadDocuments();

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
          this.graph.addNode(entryUri, 'JournalEntry', {
            content: entry.content,
            timestamp: entry.timestamp,
            tags: entry.tags,
            reflectionType: entry.reflectionType,
            emotionalIntensity: entry.emotionalIntensity,
          });
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

    // Log memory status
    const archiveStats = this.archive.getStats();
    const bufferMetrics = this.memory.getMetrics();
    console.log(`[MEMORY] Buffer: ${bufferMetrics.totalScrolls} scrolls | Archive: ${archiveStats.totalScrolls} scrollfired`);
  }

  /**
   * Load all text files from the documents directory into context
   */
  private loadDocuments(): void {
    if (!existsSync(this.documentsDir)) return;

    const files = readdirSync(this.documentsDir)
      .filter(f => f.endsWith('.txt') || f.endsWith('.md'))
      .filter(f => f !== 'README.md')
      .sort();

    if (files.length === 0) {
      console.log(`[DOCS] No documents in ${this.documentsDir}/`);
      return;
    }

    const MAX_DOC_CHARS = 50000; // Cap total document context at ~12k tokens
    const docs: string[] = [];
    let totalChars = 0;
    for (const file of files) {
      try {
        let content = readFileSync(join(this.documentsDir, file), 'utf-8');
        // Truncate individual files if too large
        if (content.length > 10000) {
          console.log(`[DOCS] Truncating ${file}: ${content.length} → 10000 chars`);
          content = content.substring(0, 10000) + '\n[... truncated ...]';
        }
        if (totalChars + content.length > MAX_DOC_CHARS) {
          console.log(`[DOCS] Skipping ${file}: would exceed ${MAX_DOC_CHARS} char limit`);
          continue;
        }
        docs.push(`--- ${file} ---\n${content.trim()}`);
        totalChars += content.length;
        console.log(`[DOCS] Loaded: ${file} (${content.length} chars)`);
      } catch (err) {
        console.error(`[DOCS] Failed to read ${file}:`, err);
      }
    }

    if (docs.length > 0) {
      this.documentsContext = `SHARED DOCUMENTS (available to all participants):\n\n${docs.join('\n\n')}`;
      console.log(`[DOCS] ${docs.length}/${files.length} documents loaded (${totalChars} chars)`);
    }

    // Also offer each document as an individual RAM pool item for all agents
    this.documentItems = [];
    for (const file of files) {
      try {
        let content = readFileSync(join(this.documentsDir, file), 'utf-8');
        if (content.length > 10000) {
          content = content.substring(0, 10000) + '\n[... truncated ...]';
        }
        const tags = file.replace(/\.(txt|md)$/, '').split(/[-_.\s]+/).filter(t => t.length > 2);
        this.documentItems.push({
          id: `doc:${file}`,
          label: file,
          content: content.trim(),
          chars: content.length,
          tags,
        });
      } catch { /* already logged above */ }
    }
    // Offer documents to each agent's RAM pool
    for (const [agentId, ram] of this.ram) {
      for (const doc of this.documentItems) {
        ram.offerItem('documents', doc);
      }
      console.log(`[DOCS] Offered ${this.documentItems.length} documents to ${agentId} RAM pool`);
    }
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
    if (this.processing || this.paused || this.speaking) return;
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

    // ── Staggered agent activation ──
    // Sort agents by micro-tick offset so they activate in a natural staggered order
    const agentEntries = Array.from(this.agents.entries())
      .sort((a, b) => {
        const ra = this.rhythm.get(a[0])?.microTickOffset || 0;
        const rb = this.rhythm.get(b[0])?.microTickOffset || 0;
        return ra - rb;
      });

    // Process agents sequentially with staggered delays for natural rhythm
    for (const [agentId, agent] of agentEntries) {
      const rhythmState = this.rhythm.get(agentId);
      if (rhythmState) {
        // Wait the micro-tick offset before this agent activates
        await this.delay(rhythmState.microTickOffset);
        // Regenerate offset for next tick (so order shifts naturally)
        rhythmState.microTickOffset = MICRO_TICK_MIN_MS + Math.random() * (MICRO_TICK_MAX_MS - MICRO_TICK_MIN_MS);
      }

      try {
        await this.processAgent(agentId, agent, conversationContext);
      } catch (err) {
        console.error(`[TICK] ${agentId} error:`, err);
        this.emit({ type: 'error', error: String(err), agentId });
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

    // Save graph every 10 ticks
    if (this.state.tickCount % 10 === 0) {
      this.graph.save().catch(err => console.error('[GRAPH] Auto-save error:', err));
    }

    this.emit({ type: 'tick', tickCount: this.state.tickCount });
    this.processing = false;
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
    const assembledContext = ram ? ram.assemble() : conversationContext;
    const ramManifest = ram ? ram.buildManifest() : '';

    const options: GenerateOptions = {
      systemPrompt: agent.systemPrompt,
      conversationContext: assembledContext + (ramManifest ? '\n\n' + ramManifest : ''),
      journalContext: '', // Already in RAM
      documentsContext: undefined, // Already in RAM
      memoryContext: undefined, // Already in RAM
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

      // ── Voice synthesis — speak aloud if enabled ──
      await this.synthesizeAndEmit(agentId, agent.config, responseText);

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

      // Register journal entry in graph
      const journalUri = `journal:${msg.id}`;
      this.graph.addNode(journalUri, 'JournalEntry', {
        content: responseText,
        timestamp: msg.timestamp,
        tags: ['communion', agentId],
      });
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

    // Register in graph
    const journalUri = `journal:${msg.id}`;
    this.graph.addNode(journalUri, 'JournalEntry', {
      content: sweep.reflection,
      timestamp: msg.timestamp,
      tags: ['communion', agentId, 'ram-reflection'],
    });
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
   * Sets the global speaking flag to pause the master clock.
   */
  private async synthesizeAndEmit(agentId: string, agentConfig: AgentConfig, text: string): Promise<void> {
    const voiceConfig = this.voiceConfigs.get(agentId);
    if (!voiceConfig || !voiceConfig.enabled) return;

    try {
      this.speaking = true;
      this.emit({ type: 'speech-start', agentId, durationMs: 0 });
      console.log(`[${agentConfig.name}] VOICE: synthesizing (${voiceConfig.voiceProvider}/${voiceConfig.voiceId})...`);

      // Collect API keys from agent configs
      const apiKeys: { openai?: string; xai?: string } = {};
      for (const [, agent] of this.agents) {
        if (agent.config.baseUrl?.includes('openai.com')) {
          apiKeys.openai = agent.config.apiKey;
        }
        if (agent.config.baseUrl?.includes('x.ai')) {
          apiKeys.xai = agent.config.apiKey;
        }
        if (agent.config.provider === 'anthropic') {
          // Claude doesn't have TTS — use OpenAI key if available
        }
      }
      // Also check env vars as fallback
      if (!apiKeys.openai && process.env.OPENAI_API_KEY) {
        apiKeys.openai = process.env.OPENAI_API_KEY;
      }
      if (!apiKeys.xai && process.env.XAI_API_KEY) {
        apiKeys.xai = process.env.XAI_API_KEY;
      }

      const result = await synthesize(text, voiceConfig, apiKeys);

      this.emit({
        type: 'speech-end',
        agentId,
        audioBase64: result.audio.toString('base64'),
        audioFormat: result.format,
        audioSampleRate: result.sampleRate,
        durationMs: result.durationMs,
      });
      console.log(`[${agentConfig.name}] VOICE: ${Math.round((result.durationMs || 0) / 1000)}s audio ready`);

    } catch (err) {
      console.error(`[${agentConfig.name}] VOICE ERROR:`, err);
      this.emit({ type: 'speech-end', agentId, durationMs: 0 });
    } finally {
      this.speaking = false;
    }
  }

  /**
   * Set voice config for an agent.
   */
  setVoiceConfig(agentId: string, config: Partial<AgentVoiceConfig>): void {
    const existing = this.voiceConfigs.get(agentId);
    if (existing) {
      Object.assign(existing, config);
      console.log(`[VOICE] ${agentId}: ${existing.enabled ? `${existing.voiceProvider}/${existing.voiceId}` : 'disabled'}`);
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

  /**
   * Report speech completion from client (after audio finishes playing).
   * This allows the master clock to resume.
   */
  reportSpeechComplete(): void {
    this.speaking = false;
  }

  isSpeaking(): boolean {
    return this.speaking;
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

    this.graph.addNode(uri, 'ScrollEcho', {
      content: scroll.content,
      timestamp: scroll.timestamp,
      location: scroll.location,
      resonance: scroll.resonance,
      tags: scroll.tags,
      sourceModel: scroll.sourceModel,
    });

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

    this.graph.addNode(uri, 'DetectedPattern', {
      type: pattern.type,
      name: pattern.name,
      description: pattern.description,
      strength: pattern.strength,
      confidence: pattern.confidence,
      tags: pattern.tags,
    });

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

  start(): void {
    if (this.timer) return;
    console.log(`[COMMUNION] Starting loop (tick every ${this.tickIntervalMs / 1000}s, ${this.agents.size} agents)`);

    // First tick immediately
    this.tick();

    this.timer = setInterval(() => this.tick(), this.tickIntervalMs);
  }

  pause(): void {
    this.paused = true;
    if (this.timer) {
      clearInterval(this.timer);
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
    this.timer = setInterval(() => this.tick(), this.tickIntervalMs);
    console.log(`[COMMUNION] Resumed (tick every ${this.tickIntervalMs / 1000}s)`);
  }

  isPaused(): boolean {
    return this.paused;
  }

  setTickSpeed(ms: number): void {
    this.tickIntervalMs = Math.max(3000, Math.min(1800000, ms)); // clamp 3s–30min
    if (this.timer && !this.paused) {
      clearInterval(this.timer);
      this.timer = setInterval(() => this.tick(), this.tickIntervalMs);
    }
    console.log(`[COMMUNION] Tick speed set to ${this.tickIntervalMs / 1000}s`);
  }

  getTickSpeed(): number {
    return this.tickIntervalMs;
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
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

    console.log('[COMMUNION] Loop stopped');
  }
}
