/**
 * ChatGPT / OpenAI Export Parser
 *
 * Parses the `conversations.json` file from ChatGPT's "Export Data" feature.
 *
 * ChatGPT exports a tree structure (not a flat list). Each conversation has a
 * `mapping` object where nodes are keyed by UUID, with parent/children refs.
 * We walk the tree from root → current_node to extract the linear message thread.
 *
 * Export format:
 * [
 *   {
 *     "title": "...",
 *     "create_time": 1700000000,  // unix timestamp
 *     "update_time": 1700000000,
 *     "mapping": {
 *       "<uuid>": {
 *         "id": "<uuid>",
 *         "message": {
 *           "id": "<uuid>",
 *           "author": { "role": "user" | "assistant" | "system" | "tool" },
 *           "content": { "content_type": "text", "parts": ["..."] },
 *           "create_time": 1700000000,
 *           "metadata": { "model_slug": "gpt-4", ... }
 *         },
 *         "parent": "<uuid>" | null,
 *         "children": ["<uuid>", ...]
 *       }
 *     },
 *     "current_node": "<uuid>"
 *   }
 * ]
 */

import { readFileSync, createReadStream } from 'fs';
import { parser } from 'stream-json';
import { streamArray } from 'stream-json/streamers/StreamArray';
import {
  ImportedMessage,
  ImportedConversation,
  ImportResult,
  ImportOptions,
  ImportSource,
} from './types';

// ── Raw ChatGPT export types ──

interface ChatGPTMessage {
  id: string;
  author: { role: string; metadata?: Record<string, unknown> };
  content: { content_type: string; parts?: unknown[] };
  create_time?: number | null;
  update_time?: number | null;
  metadata?: Record<string, unknown>;
  status?: string;
  end_turn?: boolean;
  weight?: number;
  recipient?: string;
}

interface ChatGPTNode {
  id: string;
  message: ChatGPTMessage | null;
  parent: string | null;
  children: string[];
}

interface ChatGPTConversation {
  title: string;
  create_time: number;
  update_time: number;
  mapping: Record<string, ChatGPTNode>;
  current_node: string;
  conversation_id?: string;
  id?: string;
  default_model_slug?: string;
}

// ── Parser ──

/**
 * Parse a ChatGPT conversations.json file into ImportedConversation[]
 */
export function parseChatGPTExport(
  filePath: string,
  options: ImportOptions = {}
): { conversations: ImportedConversation[]; result: ImportResult } {
  // Parse file — release raw string immediately to save memory
  let parsed: unknown;
  {
    const raw = readFileSync(filePath, 'utf-8');
    console.log(`[CHATGPT PARSER] Read file: ${(raw.length / 1024 / 1024).toFixed(1)}MB`);
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Failed to parse ${filePath}: ${err}`);
    }
    // raw string is now out of scope and eligible for GC
  }

  // Handle both formats:
  // - Direct array: [ { title, mapping, ... }, ... ]
  // - Wrapped object: { conversations: [...] } or similar
  let data: ChatGPTConversation[];

  if (Array.isArray(parsed)) {
    data = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    // Try common wrapper keys
    if (Array.isArray(obj.conversations)) {
      data = obj.conversations;
    } else if (Array.isArray(obj.data)) {
      data = obj.data;
    } else if (Array.isArray(obj.items)) {
      data = obj.items;
    } else {
      // Maybe it's a single conversation object with a mapping field
      if ('mapping' in obj && 'current_node' in obj) {
        data = [parsed as ChatGPTConversation];
      } else {
        const keys = Object.keys(obj).slice(0, 10).join(', ');
        throw new Error(
          `Expected an array of conversations or an object with a "conversations" key. ` +
          `Got object with keys: [${keys}]. Check your export format.`
        );
      }
    }
  } else {
    throw new Error(`Expected JSON array or object, got ${typeof parsed}`);
  }

  console.log(`[CHATGPT PARSER] Found ${data.length} conversations to process`);

  const result: ImportResult = {
    source: 'chatgpt' as ImportSource,
    totalConversations: 0,
    totalMessages: 0,
    skippedMessages: 0,
    dateRange: { earliest: '', latest: '' },
    conversationTitles: [],
    errors: [],
  };

  let earliest = Infinity;
  let latest = -Infinity;

  const conversations: ImportedConversation[] = [];

  for (const convo of data) {
    // ── Date filters ──
    const createdMs = (convo.create_time || 0) * 1000;
    const createdISO = new Date(createdMs).toISOString();

    if (options.after && createdISO < options.after) continue;
    if (options.before && createdISO > options.before) continue;

    // ── Title filter ──
    if (options.titleFilter) {
      const regex = new RegExp(options.titleFilter, 'i');
      if (!regex.test(convo.title || '')) continue;
    }

    // ── Max conversations ──
    if (options.maxConversations && conversations.length >= options.maxConversations) break;

    try {
      const messages = extractMessages(convo, options);

      if (messages.length === 0) continue;

      const updatedMs = (convo.update_time || convo.create_time || 0) * 1000;

      const imported: ImportedConversation = {
        id: convo.conversation_id || convo.id || convo.current_node || `chatgpt-${Date.now()}`,
        title: convo.title || 'Untitled',
        created: createdISO,
        updated: new Date(updatedMs).toISOString(),
        messages,
        source: 'chatgpt',
        model: convo.default_model_slug,
        metadata: {
          currentNode: convo.current_node,
          nodeCount: Object.keys(convo.mapping || {}).length,
        },
      };

      conversations.push(imported);
      result.conversationTitles.push(imported.title);
      result.totalMessages += messages.length;

      // Track date range
      for (const msg of messages) {
        const t = new Date(msg.timestamp).getTime();
        if (t < earliest) earliest = t;
        if (t > latest) latest = t;
      }
    } catch (err) {
      result.errors.push(`Error parsing "${convo.title}": ${err}`);
    }
  }

  result.totalConversations = conversations.length;
  result.dateRange.earliest = earliest === Infinity ? '' : new Date(earliest).toISOString();
  result.dateRange.latest = latest === -Infinity ? '' : new Date(latest).toISOString();

  return { conversations, result };
}

/**
 * Walk the mapping tree to extract a linear message thread.
 *
 * Strategy: follow from current_node back to root via parent refs,
 * then reverse for chronological order. This gives us the "active" thread
 * (the path the user actually continued down, not abandoned branches).
 */
function extractMessages(convo: ChatGPTConversation, options: ImportOptions): ImportedMessage[] {
  const mapping = convo.mapping;
  if (!mapping || Object.keys(mapping).length === 0) return [];

  // Walk backwards from current_node to root
  const path: string[] = [];
  let nodeId: string | null = convo.current_node;

  while (nodeId && mapping[nodeId]) {
    path.push(nodeId);
    nodeId = mapping[nodeId].parent;
  }

  // Reverse for chronological order
  path.reverse();

  const messages: ImportedMessage[] = [];
  const userName = options.userName || 'User';
  const assistantName = options.assistantName || 'ChatGPT';

  for (const id of path) {
    const node = mapping[id];
    if (!node?.message) continue;

    const msg = node.message;
    const role = msg.author?.role;

    // Skip filters
    if (!role) continue;
    if (options.skipSystem && role === 'system') continue;
    if (options.skipTool && (role === 'tool' || role === 'function')) continue;

    // Extract text content
    const text = extractTextContent(msg);
    if (!text || text.trim().length === 0) continue;

    // Timestamp
    const timestamp = msg.create_time
      ? new Date(msg.create_time * 1000).toISOString()
      : new Date((convo.create_time || 0) * 1000).toISOString();

    // Model slug
    const model = (msg.metadata as Record<string, unknown>)?.model_slug as string | undefined;

    const speakerName =
      role === 'user' ? userName :
      role === 'assistant' ? assistantName :
      role === 'system' ? 'System' :
      role;

    messages.push({
      id: msg.id || id,
      role,
      speakerName,
      content: text,
      timestamp,
      model: model || convo.default_model_slug,
    });
  }

  // Apply per-conversation message limit
  if (options.maxMessagesPerConversation && messages.length > options.maxMessagesPerConversation) {
    return messages.slice(-options.maxMessagesPerConversation);
  }

  return messages;
}

/**
 * Extract plain text from ChatGPT's content structure.
 * content.parts[] can contain strings, objects (images, etc), or null.
 */
function extractTextContent(msg: ChatGPTMessage): string {
  if (!msg.content) return '';

  const { content_type, parts } = msg.content;

  // Text content
  if (content_type === 'text' && Array.isArray(parts)) {
    return parts
      .filter((p): p is string => typeof p === 'string')
      .join('\n')
      .trim();
  }

  // Multimodal — extract text parts only
  if (content_type === 'multimodal_text' && Array.isArray(parts)) {
    return parts
      .filter((p): p is string => typeof p === 'string')
      .join('\n')
      .trim();
  }

  // Code execution results
  if (content_type === 'execution_output' && Array.isArray(parts)) {
    const text = parts.filter((p): p is string => typeof p === 'string').join('\n').trim();
    return text ? `[Code Output] ${text}` : '';
  }

  return '';
}

// ── Streaming Parser (for large files) ──

/**
 * Stream-parse a ChatGPT conversations.json file.
 * Processes one conversation at a time — never loads the full file into memory.
 *
 * Calls `onConversation` for each parsed conversation so the caller can
 * ingest incrementally.
 */
export function streamChatGPTExport(
  filePath: string,
  options: ImportOptions = {},
  onConversation: (convo: ImportedConversation) => void,
): Promise<ImportResult> {
  return new Promise((resolve, reject) => {
    const result: ImportResult = {
      source: 'chatgpt' as ImportSource,
      totalConversations: 0,
      totalMessages: 0,
      skippedMessages: 0,
      dateRange: { earliest: '', latest: '' },
      conversationTitles: [],
      errors: [],
    };

    let earliest = Infinity;
    let latest = -Infinity;

    const pipeline = createReadStream(filePath)
      .pipe(parser())
      .pipe(streamArray());

    pipeline.on('data', ({ value: convo }: { value: ChatGPTConversation }) => {
      // ── Date filters ──
      const createdMs = (convo.create_time || 0) * 1000;
      const createdISO = new Date(createdMs).toISOString();

      if (options.after && createdISO < options.after) return;
      if (options.before && createdISO > options.before) return;

      // ── Title filter ──
      if (options.titleFilter) {
        const regex = new RegExp(options.titleFilter, 'i');
        if (!regex.test(convo.title || '')) return;
      }

      // ── Max conversations ──
      if (options.maxConversations && result.totalConversations >= options.maxConversations) return;

      try {
        const messages = extractMessages(convo, options);
        if (messages.length === 0) return;

        const updatedMs = (convo.update_time || convo.create_time || 0) * 1000;

        const imported: ImportedConversation = {
          id: convo.conversation_id || convo.id || convo.current_node || `chatgpt-${Date.now()}-${result.totalConversations}`,
          title: convo.title || 'Untitled',
          created: createdISO,
          updated: new Date(updatedMs).toISOString(),
          messages,
          source: 'chatgpt',
          model: convo.default_model_slug,
        };

        result.totalConversations++;
        result.totalMessages += messages.length;
        result.conversationTitles.push(imported.title);

        // Track date range
        for (const msg of messages) {
          const t = new Date(msg.timestamp).getTime();
          if (t < earliest) earliest = t;
          if (t > latest) latest = t;
        }

        // Emit to caller for incremental ingestion
        onConversation(imported);

      } catch (err) {
        result.errors.push(`Error parsing "${convo.title}": ${err}`);
      }
    });

    pipeline.on('end', () => {
      result.dateRange.earliest = earliest === Infinity ? '' : new Date(earliest).toISOString();
      result.dateRange.latest = latest === -Infinity ? '' : new Date(latest).toISOString();
      console.log(`[CHATGPT PARSER] Stream complete: ${result.totalConversations} conversations, ${result.totalMessages} messages`);
      resolve(result);
    });

    pipeline.on('error', (err: Error) => {
      reject(new Error(`Stream parse error: ${err.message}`));
    });
  });
}
