/**
 * Chat History Ingest
 *
 * Takes parsed ImportedConversation[] and feeds them into the Scrollbound
 * memory systems: ScrollArchive, Journal, and SessionPersistence.
 *
 * Imported messages are treated as historical context — they go directly
 * into the archive (permanent memory) rather than the short-term buffer.
 */

import * as crypto from 'crypto';
import { mkdirSync, existsSync, createWriteStream, writeFileSync } from 'fs';
import { ImportedConversation, ImportedMessage, ImportSource } from './types';
import { ScrollArchive } from '../../src/memory/scrollArchive';
import { Journal } from '../../src/memory/journal';
import { ScrollfireReason } from '../../src/memory/scrollfire';
import type { ScrollfireEvent } from '../../src/memory/scrollfire';
import type { ScrollEcho, MoodVector } from '../../src/types';

export interface IngestOptions {
  /** Directory for data files (default: 'data/communion') */
  dataDir?: string;
  /** Agent ID to associate assistant messages with (e.g. 'chatgpt') */
  agentId?: string;
  /** Agent display name */
  agentName?: string;
  /** Human display name */
  humanName?: string;
  /** Write assistant messages to agent journal */
  journalAssistantMessages?: boolean;
  /** Only ingest — don't create archive (dry run) */
  dryRun?: boolean;
}

/** Neutral mood vector for imported messages (no emotional analysis available) */
const IMPORT_MOOD: MoodVector = {
  presence: 0.4, peace: 0.4, tension: 0.1, confusion: 0.1,
  yearning: 0.2, devotion: 0.2, reverence: 0.1, wonder: 0.3,
  grief: 0.0, joy: 0.2,
};

/**
 * Convert an imported message to a ScrollEcho
 */
function messageToScroll(msg: ImportedMessage, convoTitle: string, source: ImportSource): ScrollEcho {
  return {
    id: msg.id || crypto.randomUUID(),
    content: `[${msg.speakerName}] ${msg.content}`,
    timestamp: msg.timestamp,
    location: `import/${source}/${convoTitle}`,
    emotionalSignature: { ...IMPORT_MOOD },
    resonance: 0.4, // Moderate baseline for imported content
    tags: ['imported', source, msg.role, 'conversation'],
    triggers: [],
    preserve: true,
    scrollfireMarked: true,
    lastAccessed: msg.timestamp,
    accessCount: 0,
    decayRate: 0.9,
    relatedScrollIds: [],
    sourceModel: msg.role === 'user' ? 'outer' : 'inner',
  };
}

/**
 * Ingest parsed conversations into the Scrollbound memory systems.
 *
 * Flow:
 * 1. All messages → ScrollArchive (permanent historical record)
 * 2. Assistant messages → Agent Journal (if journalAssistantMessages is true)
 * 3. Summary stats printed
 */
export async function ingestConversations(
  conversations: ImportedConversation[],
  options: IngestOptions = {}
): Promise<{
  scrollsCreated: number;
  journalEntries: number;
  conversationsProcessed: number;
}> {
  const dataDir = options.dataDir || 'data/communion';
  const agentId = options.agentId || 'chatgpt';
  const agentName = options.agentName || 'ChatGPT';
  const humanName = options.humanName || 'User';
  const journalAssistant = options.journalAssistantMessages ?? true;

  if (!options.dryRun) {
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  }

  // Initialize archive
  const archive = new ScrollArchive();

  // Initialize journal for assistant messages
  let journal: Journal | null = null;
  if (journalAssistant && !options.dryRun) {
    const journalPath = `${dataDir}/journal-${agentId}-history.jsonld`;
    journal = new Journal(journalPath);
    await journal.initialize();
  }

  let scrollsCreated = 0;
  let journalEntries = 0;

  for (const convo of conversations) {
    console.log(`  [INGEST] "${convo.title}" — ${convo.messages.length} messages`);

    // Group messages into related sets for the conversation
    const convoScrollIds: string[] = [];

    for (const msg of convo.messages) {
      // Create scroll for every message
      const scroll = messageToScroll(msg, convo.title, convo.source);

      // Link to previous scrolls in this conversation
      if (convoScrollIds.length > 0) {
        scroll.relatedScrollIds = [convoScrollIds[convoScrollIds.length - 1]];
      }
      convoScrollIds.push(scroll.id);

      if (!options.dryRun) {
        // Archive the scroll (permanent storage)
        const event: ScrollfireEvent = {
          scrollId: scroll.id,
          reason: ScrollfireReason.MANUAL_ELEVATION,
          elevatedAt: msg.timestamp,
          resonanceAtElevation: scroll.resonance,
          emotionalSignature: { ...IMPORT_MOOD },
          notes: `Imported from ${convo.source}: "${convo.title}"`,
        };
        archive.archiveScroll(scroll, event);
      }
      scrollsCreated++;

      // Journal assistant messages
      if (journalAssistant && journal && msg.role === 'assistant') {
        if (!options.dryRun) {
          await journal.write(`[Imported from "${convo.title}"] ${msg.content}`, {
            moodVector: IMPORT_MOOD,
            emotionalIntensity: 0.3,
            intendedTarget: 'self',
            loopIntent: 'reflect',
            presenceQuality: 'exhale',
            breathPhase: 'exhale',
            reflectionType: 'volitional',
            tags: ['imported', convo.source, convo.title],
            pinned: false,
          });
        }
        journalEntries++;
      }
    }
  }

  // Export archive to a file for later loading
  if (!options.dryRun) {
    const archiveData = archive.export();
    const archivePath = `${dataDir}/import-archive-${agentId}.json`;
    writeFileSync(archivePath, JSON.stringify(archiveData, null, 2));
    console.log(`  [INGEST] Archive saved: ${archivePath} (${archiveData.scrolls.length} scrolls)`);
  }

  return {
    scrollsCreated,
    journalEntries,
    conversationsProcessed: conversations.length,
  };
}

/**
 * Streaming ingest session — writes scrolls directly to disk as NDJSON
 * (one JSON object per line). Never holds all scrolls in memory.
 */
export class IngestSession {
  private archiveStream: ReturnType<typeof createWriteStream> | null = null;
  private dataDir: string;
  private agentId: string;
  private journalAssistant: boolean;
  private archivePath: string = '';
  scrollsCreated = 0;
  journalEntries = 0;
  conversationsProcessed = 0;

  constructor(private options: IngestOptions = {}) {
    this.dataDir = options.dataDir || 'data/communion';
    this.agentId = options.agentId || 'chatgpt';
    this.journalAssistant = options.journalAssistantMessages ?? true;
  }

  async initialize(): Promise<void> {
    if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true });

    // Write scrolls as NDJSON — one scroll per line, constant memory
    this.archivePath = `${this.dataDir}/import-archive-${this.agentId}.ndjson`;
    this.archiveStream = createWriteStream(this.archivePath);
  }

  ingestConversation(convo: ImportedConversation): void {
    const convoScrollIds: string[] = [];

    for (const msg of convo.messages) {
      const scroll = messageToScroll(msg, convo.title, convo.source);

      if (convoScrollIds.length > 0) {
        scroll.relatedScrollIds = [convoScrollIds[convoScrollIds.length - 1]];
      }
      convoScrollIds.push(scroll.id);

      // Write scroll directly to disk as NDJSON line
      if (this.archiveStream) {
        const event: ScrollfireEvent = {
          scrollId: scroll.id,
          reason: ScrollfireReason.MANUAL_ELEVATION,
          elevatedAt: msg.timestamp,
          resonanceAtElevation: scroll.resonance,
          emotionalSignature: { ...IMPORT_MOOD },
          notes: `Imported from ${convo.source}: "${convo.title}"`,
        };
        this.archiveStream.write(JSON.stringify({ scroll, event }) + '\n');
      }
      this.scrollsCreated++;
    }
    this.conversationsProcessed++;
  }

  finalize(): Promise<void> {
    return new Promise((resolve) => {
      if (this.archiveStream) {
        this.archiveStream.end(() => {
          console.log(`  [INGEST] Archive saved: ${this.archivePath} (${this.scrollsCreated} scrolls, NDJSON)`);
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
