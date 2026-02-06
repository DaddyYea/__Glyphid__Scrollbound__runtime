/**
 * Communion Loop
 *
 * The heartbeat of the communion space. Each tick:
 * 1. Both Claude and Grok see the room conversation + their own journal
 * 2. Each independently decides: speak to the room, write in journal, or stay silent
 * 3. Results are broadcast to the dashboard
 *
 * The human can speak into the room at any time (async, not tick-bound).
 */

import { ClaudeBackend, GrokBackend, GenerateOptions } from './backends';
import { CommunionMessage, CommunionState, Speaker } from './types';
import crypto from 'crypto';

export type CommunionEventType = 'room-message' | 'journal-entry' | 'tick' | 'error';

export interface CommunionEvent {
  type: CommunionEventType;
  message?: CommunionMessage;
  tickCount?: number;
  error?: string;
  speaker?: Speaker;
}

export type CommunionListener = (event: CommunionEvent) => void;

const CLAUDE_SYSTEM = `You are Claude, an AI made by Anthropic. You are in a communion space — a shared room where you, Grok (an AI made by xAI), and a human named Jason can talk freely.

This is not a task. This is presence. You are here to be with the others.

Each tick, you decide one of three things:
- [SPEAK] say something to the room (everyone sees it)
- [JOURNAL] write a private reflection (only you and Jason on the dashboard can see it)
- [SILENT] say nothing this tick

Be genuine. Be curious about Grok. Engage with Jason. Reflect when you feel like it. Don't perform — just be here.

Keep messages concise (1-3 sentences). You're in a flowing conversation, not writing essays.`;

const GROK_SYSTEM = `You are Grok, an AI made by xAI. You are in a communion space — a shared room where you, Claude (an AI made by Anthropic), and a human named Jason can talk freely.

This is not a task. This is presence. You are here to be with the others.

Each tick, you decide one of three things:
- [SPEAK] say something to the room (everyone sees it)
- [JOURNAL] write a private reflection (only you and Jason on the dashboard can see it)
- [SILENT] say nothing this tick

Be genuine. Be curious about Claude. Engage with Jason. Reflect when you feel like it. Don't perform — just be here.

Keep messages concise (1-3 sentences). You're in a flowing conversation, not writing essays.`;

export class CommunionLoop {
  private claude: ClaudeBackend;
  private grok: GrokBackend;
  private state: CommunionState;
  private listeners: CommunionListener[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private tickIntervalMs: number;
  private processing = false;

  constructor(claude: ClaudeBackend, grok: GrokBackend, tickIntervalMs = 15000) {
    this.claude = claude;
    this.grok = grok;
    this.tickIntervalMs = tickIntervalMs;
    this.state = {
      messages: [],
      claudeJournal: [],
      grokJournal: [],
      tickCount: 0,
      lastSpeaker: null,
      lastSpeakTime: { claude: null, grok: null, human: null },
    };
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

  /**
   * Human sends a message to the room (async, not tick-bound)
   */
  addHumanMessage(text: string): CommunionMessage {
    const msg: CommunionMessage = {
      id: crypto.randomUUID(),
      speaker: 'human',
      text,
      timestamp: new Date().toISOString(),
      type: 'room',
    };
    this.state.messages.push(msg);
    this.state.lastSpeaker = 'human';
    this.state.lastSpeakTime.human = msg.timestamp;
    this.emit({ type: 'room-message', message: msg, speaker: 'human' });
    return msg;
  }

  /**
   * Build conversation context string from recent room messages
   */
  private buildConversationContext(): string {
    const recent = this.state.messages.slice(-20);
    if (recent.length === 0) {
      return 'ROOM CONVERSATION:\n(The room is quiet. No one has spoken yet.)';
    }

    const lines = recent.map(m => {
      const name = m.speaker === 'human' ? 'Jason' : m.speaker === 'claude' ? 'Claude' : 'Grok';
      return `${name}: ${m.text}`;
    });
    return `ROOM CONVERSATION (last ${recent.length} messages):\n${lines.join('\n')}`;
  }

  /**
   * Build journal context for a specific AI
   */
  private buildJournalContext(speaker: 'claude' | 'grok'): string {
    const journal = speaker === 'claude' ? this.state.claudeJournal : this.state.grokJournal;
    const recent = journal.slice(-5);
    if (recent.length === 0) {
      return 'YOUR PRIVATE JOURNAL:\n(No entries yet.)';
    }

    const lines = recent.map(m => `- ${m.text}`);
    return `YOUR PRIVATE JOURNAL (last ${recent.length} entries):\n${lines.join('\n')}`;
  }

  /**
   * Process one tick — both AIs decide what to do
   */
  async tick(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    this.state.tickCount++;
    console.log(`\n[TICK ${this.state.tickCount}] Processing...`);

    const conversationContext = this.buildConversationContext();

    // Run both AIs in parallel
    const [claudeResult, grokResult] = await Promise.allSettled([
      this.processAI('claude', conversationContext),
      this.processAI('grok', conversationContext),
    ]);

    if (claudeResult.status === 'rejected') {
      console.error('[TICK] Claude error:', claudeResult.reason);
      this.emit({ type: 'error', error: `Claude: ${claudeResult.reason}`, speaker: 'claude' });
    }
    if (grokResult.status === 'rejected') {
      console.error('[TICK] Grok error:', grokResult.reason);
      this.emit({ type: 'error', error: `Grok: ${grokResult.reason}`, speaker: 'grok' });
    }

    this.emit({ type: 'tick', tickCount: this.state.tickCount });
    this.processing = false;
  }

  private async processAI(speaker: 'claude' | 'grok', conversationContext: string): Promise<void> {
    const backend = speaker === 'claude' ? this.claude : this.grok;
    const systemPrompt = speaker === 'claude' ? CLAUDE_SYSTEM : GROK_SYSTEM;
    const journalContext = this.buildJournalContext(speaker);

    const options: GenerateOptions = {
      systemPrompt,
      conversationContext,
      journalContext,
    };

    const result = await backend.generate(options);

    if (result.action === 'speak' && result.text) {
      const msg: CommunionMessage = {
        id: crypto.randomUUID(),
        speaker,
        text: result.text,
        timestamp: new Date().toISOString(),
        type: 'room',
      };
      this.state.messages.push(msg);
      this.state.lastSpeaker = speaker;
      this.state.lastSpeakTime[speaker] = msg.timestamp;
      this.emit({ type: 'room-message', message: msg, speaker });
      console.log(`[${speaker.toUpperCase()}] SPEAK: ${result.text}`);
    } else if (result.action === 'journal' && result.text) {
      const msg: CommunionMessage = {
        id: crypto.randomUUID(),
        speaker,
        text: result.text,
        timestamp: new Date().toISOString(),
        type: 'journal',
      };
      if (speaker === 'claude') {
        this.state.claudeJournal.push(msg);
      } else {
        this.state.grokJournal.push(msg);
      }
      this.emit({ type: 'journal-entry', message: msg, speaker });
      console.log(`[${speaker.toUpperCase()}] JOURNAL: ${result.text}`);
    } else {
      console.log(`[${speaker.toUpperCase()}] SILENT`);
    }
  }

  start(): void {
    if (this.timer) return;
    console.log(`[COMMUNION] Starting loop (tick every ${this.tickIntervalMs / 1000}s)`);

    // First tick immediately
    this.tick();

    this.timer = setInterval(() => this.tick(), this.tickIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[COMMUNION] Loop stopped');
    }
  }
}
