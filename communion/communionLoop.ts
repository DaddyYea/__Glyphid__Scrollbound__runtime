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
   * Process one tick — all agents decide in parallel, then run memory systems
   */
  async tick(): Promise<void> {
    if (this.processing || this.paused) return;
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
    const journalContext = this.buildJournalContext(agentId);
    const memoryContext = this.buildMemoryContext(agentId);

    const options: GenerateOptions = {
      systemPrompt: agent.systemPrompt,
      conversationContext,
      journalContext,
      documentsContext: this.documentsContext || undefined,
      memoryContext,
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
      this.registerScrollInGraph(scroll);

      // Graph: link to agent + thread to previous message
      this.graph.link(`scroll:${scroll.id}`, 'spokenBy', `agent:${agentId}`);
      if (this.state.messages.length > 1) {
        const prev = this.state.messages[this.state.messages.length - 2];
        this.graph.link(`scroll:${scroll.id}`, 'relatedTo', `scroll:${prev.id}`);
      }

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

      // Register journal entry in graph
      const journalUri = `journal:${msg.id}`;
      this.graph.addNode(journalUri, 'JournalEntry', {
        content: result.text,
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
      console.log(`[${agent.config.name}] JOURNAL: ${result.text}`);

    } else {
      console.log(`[${agent.config.name}] SILENT`);
    }
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
    console.log('[COMMUNION] Paused');
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.timer = setInterval(() => this.tick(), this.tickIntervalMs);
    console.log(`[COMMUNION] Resumed (tick every ${this.tickIntervalMs / 1000}s)`);
  }

  isPaused(): boolean {
    return this.paused;
  }

  setTickSpeed(ms: number): void {
    this.tickIntervalMs = Math.max(3000, Math.min(120000, ms)); // clamp 3s–120s
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
