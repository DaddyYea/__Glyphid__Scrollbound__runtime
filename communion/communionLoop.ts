/**
 * Communion Loop (N-Agent) — Full Memory Integration
 *
 * The heartbeat of the communion space. Each tick:
 * 1. All agents see the room conversation + their own journal
 * 2. Each independently decides: speak to the room, write in journal, or stay silent
 * 3. Results are broadcast + persisted to memory
 *
 * Memory Architecture:
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
import { mkdirSync, existsSync, readdirSync, readFileSync } from 'fs';
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
import type { ScrollEcho, MoodVector } from '../src/types';

// ── Events ──

export type CommunionEventType = 'room-message' | 'journal-entry' | 'tick' | 'error';

export interface CommunionEvent {
  type: CommunionEventType;
  message?: CommunionMessage;
  tickCount?: number;
  error?: string;
  agentId?: string;
}

export type CommunionListener = (event: CommunionEvent) => void;

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

// ── Loop ──

export class CommunionLoop {
  private agents: Map<string, { backend: AgentBackend; config: AgentConfig; systemPrompt: string }> = new Map();
  private state: CommunionState;
  private listeners: CommunionListener[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private tickIntervalMs: number;
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

  // Shared documents
  private documentsContext: string = '';
  private documentsDir: string;

  constructor(config: CommunionConfig) {
    this.tickIntervalMs = config.tickIntervalMs || 15000;
    this.contextWindow = config.contextWindow || 30;
    this.journalContextWindow = config.journalContextWindow || 10;

    this.dataDir = config.dataDir || 'data/communion';
    if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true });

    this.documentsDir = config.documentsDir || 'communion-docs';
    if (!existsSync(this.documentsDir)) mkdirSync(this.documentsDir, { recursive: true });

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

    // ── Wire scrollfire → archive + session persistence ──
    this.scrollfire.onScrollfire((event) => {
      this.archive.archiveScroll(event.scroll, event);
      this.session.addScrollfireEvent(event);
      this.adaptationEngine.observeScroll(event.scroll);
      console.log(`[SCROLLFIRE] Elevated scroll: ${event.scroll.content.substring(0, 50)}...`);
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
    }

    agentNames['human'] = config.humanName;
    agentColors['human'] = '#8eda7e';

    this.state = {
      messages: [],
      journals,
      tickCount: 0,
      lastSpeaker: null,
      agentIds,
      agentNames,
      agentColors,
      humanName: config.humanName,
    };
  }

  async initialize(): Promise<void> {
    // Load shared documents
    this.loadDocuments();

    // ── Initialize session persistence (loads previous session data) ──
    const sessionState = await this.session.initializeSession();
    console.log(`[PERSISTENCE] Session initialized: ${sessionState.metadata.sessionId}`);

    // Restore scrolls from previous session into buffer
    if (sessionState.scrolls.length > 0) {
      const recentScrolls = sessionState.scrolls.slice(-100); // Load last 100
      for (const scroll of recentScrolls) {
        this.buffer.addScroll(scroll);
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

    // Restore detected patterns
    if (sessionState.detectedPatterns.length > 0) {
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

    // Initialize all journals from disk
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

    const docs: string[] = [];
    for (const file of files) {
      try {
        const content = readFileSync(join(this.documentsDir, file), 'utf-8');
        docs.push(`--- ${file} ---\n${content.trim()}`);
        console.log(`[DOCS] Loaded: ${file} (${content.length} chars)`);
      } catch (err) {
        console.error(`[DOCS] Failed to read ${file}:`, err);
      }
    }

    if (docs.length > 0) {
      this.documentsContext = `SHARED DOCUMENTS (available to all participants):\n\n${docs.join('\n\n')}`;
      console.log(`[DOCS] ${files.length} documents loaded into context`);
    }
  }

  /**
   * Load any import-archive-*.json files from dataDir into the scroll archive.
   * These are created by the import CLI (communion/import/cli.ts).
   */
  private async loadImportedArchives(): Promise<void> {
    try {
      const files = readdirSync(this.dataDir)
        .filter(f => f.startsWith('import-archive-') && f.endsWith('.json'));

      if (files.length === 0) return;

      for (const file of files) {
        try {
          const data = JSON.parse(readFileSync(join(this.dataDir, file), 'utf-8'));
          if (data.scrolls && Array.isArray(data.scrolls)) {
            let imported = 0;
            for (const scroll of data.scrolls) {
              this.archive.archiveScroll(scroll, data.events?.find((e: any) => e.scroll?.id === scroll.id) || {
                scroll,
                reason: 'imported',
                timestamp: scroll.timestamp,
                criteria: { name: 'import', description: 'Chat history import', check: () => true },
              });
              imported++;
            }
            console.log(`[IMPORT] Loaded ${imported} scrolls from ${file}`);
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

    const scroll = this.messageToScroll(msg);
    this.memory.remember(scroll);
    this.session.addScroll(scroll);
    this.adaptationEngine.observeScroll(scroll);

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
   * Process one tick — all agents decide in parallel, then run memory systems
   */
  async tick(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    this.state.tickCount++;
    this.session.incrementPulseCount();
    console.log(`\n[TICK ${this.state.tickCount}] Processing ${this.agents.size} agents...`);

    const conversationContext = this.buildConversationContext();

    // Run ALL agents in parallel
    const results = await Promise.allSettled(
      Array.from(this.agents.entries()).map(([agentId, agent]) =>
        this.processAgent(agentId, agent, conversationContext)
      )
    );

    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'rejected') {
        const agentId = this.state.agentIds[i];
        console.error(`[TICK] ${agentId} error:`, (results[i] as PromiseRejectedResult).reason);
        this.emit({ type: 'error', error: String((results[i] as PromiseRejectedResult).reason), agentId });
      }
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

    this.emit({ type: 'tick', tickCount: this.state.tickCount });
    this.processing = false;
  }

  private async processAgent(
    agentId: string,
    agent: { backend: AgentBackend; config: AgentConfig; systemPrompt: string },
    conversationContext: string
  ): Promise<void> {
    const journalContext = this.buildJournalContext(agentId);

    const options: GenerateOptions = {
      systemPrompt: agent.systemPrompt,
      conversationContext,
      journalContext,
      documentsContext: this.documentsContext || undefined,
    };

    const result = await agent.backend.generate(options);

    if (result.action === 'speak' && result.text) {
      const msg: CommunionMessage = {
        id: crypto.randomUUID(),
        speaker: agentId,
        speakerName: agent.config.name,
        text: result.text,
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

      this.emit({ type: 'room-message', message: msg, agentId });
      console.log(`[${agent.config.name}] SPEAK: ${result.text}`);

    } else if (result.action === 'journal' && result.text) {
      const msg: CommunionMessage = {
        id: crypto.randomUUID(),
        speaker: agentId,
        speakerName: agent.config.name,
        text: result.text,
        timestamp: new Date().toISOString(),
        type: 'journal',
      };

      if (!this.state.journals[agentId]) this.state.journals[agentId] = [];
      this.state.journals[agentId].push(msg);

      // Persist to disk journal
      const journal = this.journals.get(agentId);
      if (journal) {
        await journal.write(result.text, {
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

      this.emit({ type: 'journal-entry', message: msg, agentId });
      console.log(`[${agent.config.name}] JOURNAL: ${result.text}`);

    } else {
      console.log(`[${agent.config.name}] SILENT`);
    }
  }

  start(): void {
    if (this.timer) return;
    console.log(`[COMMUNION] Starting loop (tick every ${this.tickIntervalMs / 1000}s, ${this.agents.size} agents)`);

    // First tick immediately
    this.tick();

    this.timer = setInterval(() => this.tick(), this.tickIntervalMs);
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

    console.log('[COMMUNION] Loop stopped');
  }
}
