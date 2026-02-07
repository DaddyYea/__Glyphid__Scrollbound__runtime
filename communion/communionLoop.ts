/**
 * Communion Loop (N-Agent)
 *
 * The heartbeat of the communion space. Each tick:
 * 1. All agents see the room conversation + their own journal
 * 2. Each independently decides: speak to the room, write in journal, or stay silent
 * 3. Results are broadcast + persisted to memory
 *
 * The human can speak into the room at any time (async, not tick-bound).
 * Memory: room messages become scrolls, journals are per-agent on disk.
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
import { Journal } from '../src/memory/journal';
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
  '#7eb8da', // blue
  '#da9a7e', // orange
  '#b87eda', // purple
  '#7edab8', // teal
  '#dada7e', // yellow
  '#da7e9a', // pink
  '#7edada', // cyan
  '#9ada7e', // green
];

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

  // Memory systems
  private memory: ScrollPulseMemory;
  private buffer: ScrollPulseBuffer;
  private archive: ScrollArchive;
  private scrollfire: ScrollfireEngine;
  private journals: Map<string, Journal> = new Map();

  // Shared documents
  private documentsContext: string = '';
  private documentsDir: string;

  constructor(config: CommunionConfig) {
    this.tickIntervalMs = config.tickIntervalMs || 15000;
    this.contextWindow = config.contextWindow || 30;
    this.journalContextWindow = config.journalContextWindow || 10;

    const dataDir = config.dataDir || 'data/communion';
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

    this.documentsDir = config.documentsDir || 'communion-docs';
    if (!existsSync(this.documentsDir)) mkdirSync(this.documentsDir, { recursive: true });

    // Initialize memory systems
    this.buffer = new ScrollPulseBuffer(200);
    this.archive = new ScrollArchive();
    this.scrollfire = new ScrollfireEngine();
    this.memory = new ScrollPulseMemory(this.buffer, this.archive, this.scrollfire);
    this.buffer.start();

    // Wire scrollfire → archive
    this.scrollfire.onScrollfire((event) => {
      this.archive.archiveScroll(event.scroll, event);
      console.log(`[SCROLLFIRE] Elevated scroll: ${event.scroll.content.substring(0, 50)}...`);
    });

    // Initialize state
    const agentIds: string[] = [];
    const agentNames: Record<string, string> = {};
    const agentColors: Record<string, string> = {};
    const journals: Record<string, CommunionMessage[]> = {};

    // Initialize agents
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
      const journalPath = `${dataDir}/journal-${agentConfig.id}.jsonld`;
      const journal = new Journal(journalPath);
      this.journals.set(agentConfig.id, journal);
    }

    // Human entries
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

    // Initialize all journals from disk
    for (const [agentId, journal] of this.journals) {
      await journal.initialize();
      // Load recent entries into state
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
   * Reload documents (can be called at runtime if docs change)
   */
  reloadDocuments(): void {
    this.loadDocuments();
  }

  on(listener: CommunionListener): void {
    this.listeners.push(listener);
  }

  private emit(event: CommunionEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[COMMUNION] Listener error:', err);
      }
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

    // Store as scroll
    this.memory.remember(this.messageToScroll(msg));

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

  /**
   * Build conversation context string from recent room messages
   */
  private buildConversationContext(): string {
    const recent = this.state.messages.slice(-this.contextWindow);
    if (recent.length === 0) {
      return 'ROOM CONVERSATION:\n(The room is quiet. No one has spoken yet.)';
    }

    const lines = recent.map(m => `${m.speakerName}: ${m.text}`);
    return `ROOM CONVERSATION (last ${recent.length} messages):\n${lines.join('\n')}`;
  }

  /**
   * Build journal context for a specific agent
   */
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
   * Process one tick — all agents decide in parallel
   */
  async tick(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    this.state.tickCount++;
    console.log(`\n[TICK ${this.state.tickCount}] Processing ${this.agents.size} agents...`);

    const conversationContext = this.buildConversationContext();

    // Run ALL agents in parallel
    const results = await Promise.allSettled(
      Array.from(this.agents.entries()).map(([agentId, agent]) =>
        this.processAgent(agentId, agent, conversationContext)
      )
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'rejected') {
        const agentId = this.state.agentIds[i];
        console.error(`[TICK] ${agentId} error:`, result.reason);
        this.emit({ type: 'error', error: String(result.reason), agentId });
      }
    }

    // Check scrollfire candidates
    const candidates = this.scrollfire.evaluateBatch(this.buffer.getActiveScrolls());
    if (candidates.length > 0) {
      this.scrollfire.autoElevateBatch(candidates);
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

      // Persist to scroll memory
      this.memory.remember(this.messageToScroll(msg));

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
          moodVector: undefined as any, // Journal entries don't need mood tracking in communion
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

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.buffer.stop();
    console.log('[COMMUNION] Loop stopped');
  }
}
