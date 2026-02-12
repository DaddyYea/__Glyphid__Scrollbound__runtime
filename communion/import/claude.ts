/**
 * Anthropic Claude Chat History Parser
 *
 * Parses Claude's conversations.json export (from Settings → Data & Privacy → Export).
 * The file is a top-level JSON array of conversation objects, each containing
 * a `chat_messages` array with `sender: "human" | "assistant"` messages.
 *
 * Supports both:
 *   - Bulk export (array of conversations)
 *   - Single conversation export (one object)
 *
 * Content types handled: text, thinking (chain-of-thought), tool_use (artifacts),
 * tool_result, voice_note. Only text content is extracted for scroll ingestion.
 */

import {
  ImportedMessage,
  ImportedConversation,
  ImportResult,
  ImportOptions,
  ImportSource,
} from './types';
import { streamJsonArray } from './jsonArraySplitter';

// ── Claude Export Types ──

interface ClaudeContentItem {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'voice_note';
  text?: string;
  thinking?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: Array<{ type?: string; text?: string }>;
  title?: string;
}

interface ClaudeChatMessage {
  uuid: string;
  index?: number;
  sender: 'human' | 'assistant';
  text?: string;
  content: ClaudeContentItem[];
  created_at: string;
  updated_at: string;
  truncated?: boolean;
  attachments?: unknown[];
  files?: unknown[];
  parent_message_uuid?: string;
}

interface ClaudeConversation {
  uuid: string;
  name: string;
  summary?: string;
  created_at: string;
  updated_at: string;
  model?: string;
  chat_messages: ClaudeChatMessage[];
  is_starred?: boolean;
  project_uuid?: string;
  account?: { uuid: string };
  settings?: Record<string, boolean>;
}

// ── Text Extraction ──

/**
 * Extract readable text from Claude's structured content array.
 * Skips tool_use, tool_result, and thinking blocks — only pulls text.
 */
function extractTextContent(msg: ClaudeChatMessage): string {
  // Prefer the flat `text` field if available (always present in older exports)
  if (msg.text && msg.text.trim()) {
    return msg.text.trim();
  }

  // Fall back to structured content array
  if (!msg.content || !Array.isArray(msg.content)) return '';

  const parts: string[] = [];

  for (const item of msg.content) {
    switch (item.type) {
      case 'text':
        if (item.text) parts.push(item.text);
        break;
      case 'voice_note':
        if (item.text) parts.push(`[Voice] ${item.text}`);
        break;
      // Skip thinking, tool_use, tool_result — not conversational content
    }
  }

  return parts.join('\n').trim();
}

// ── Message Extraction ──

/**
 * Extract ordered messages from a Claude conversation.
 */
function extractMessages(convo: ClaudeConversation, options: ImportOptions = {}): ImportedMessage[] {
  if (!convo.chat_messages || !Array.isArray(convo.chat_messages)) return [];

  const messages: ImportedMessage[] = [];
  const userName = options.userName || 'User';
  const assistantName = options.assistantName || 'Claude';

  // Messages are already in order (sorted by index/created_at)
  const sorted = [...convo.chat_messages].sort((a, b) => {
    // Sort by index if available, else by created_at
    if (a.index !== undefined && b.index !== undefined) return a.index - b.index;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  for (const msg of sorted) {
    // Skip by role
    if (options.skipTool && msg.content?.some(c => c.type === 'tool_use' || c.type === 'tool_result')) {
      // Only skip if the ENTIRE message is tool content (no text)
      const hasText = msg.content.some(c => c.type === 'text' && c.text?.trim());
      if (!hasText && !msg.text?.trim()) continue;
    }

    const text = extractTextContent(msg);
    if (!text) continue;

    const role = msg.sender === 'human' ? 'user' : 'assistant';
    const speakerName = role === 'user' ? userName : assistantName;

    messages.push({
      id: msg.uuid || `claude-msg-${messages.length}`,
      role,
      speakerName,
      content: text,
      timestamp: msg.created_at || convo.created_at,
      model: role === 'assistant' ? convo.model : undefined,
    });

    // Max messages per conversation
    if (options.maxMessagesPerConversation && messages.length >= options.maxMessagesPerConversation) break;
  }

  return messages;
}

// ── Streaming Parser ──

/**
 * Stream-parse a Claude conversations.json export.
 * Processes one conversation at a time via jsonArraySplitter — constant memory.
 *
 * Calls `onConversation` for each parsed conversation so the caller can
 * ingest incrementally.
 */
export async function streamClaudeExport(
  filePath: string,
  options: ImportOptions = {},
  onConversation: (convo: ImportedConversation) => void,
): Promise<ImportResult> {
  const result: ImportResult = {
    source: 'anthropic' as ImportSource,
    totalConversations: 0,
    totalMessages: 0,
    skippedMessages: 0,
    dateRange: { earliest: '', latest: '' },
    conversationTitles: [],
    errors: [],
  };

  let earliest = Infinity;
  let latest = -Infinity;

  await streamJsonArray(filePath, {
    onItem: (convo: ClaudeConversation, index: number) => {
      // Validate it's actually a Claude conversation
      if (!convo.chat_messages && !convo.uuid) return;

      // ── Date filters ──
      const createdISO = convo.created_at || '';
      if (options.after && createdISO < options.after) return;
      if (options.before && createdISO > options.before) return;

      // ── Title filter ──
      if (options.titleFilter) {
        const regex = new RegExp(options.titleFilter, 'i');
        if (!regex.test(convo.name || '')) return;
      }

      // ── Max conversations ──
      if (options.maxConversations && result.totalConversations >= options.maxConversations) return;

      try {
        const messages = extractMessages(convo, options);
        if (messages.length === 0) return;

        const imported: ImportedConversation = {
          id: convo.uuid || `claude-${Date.now()}-${result.totalConversations}`,
          title: convo.name || 'Untitled',
          created: convo.created_at,
          updated: convo.updated_at || convo.created_at,
          messages,
          source: 'anthropic',
          model: convo.model,
          metadata: convo.is_starred ? { starred: true } : undefined,
        };

        result.totalConversations++;
        result.totalMessages += messages.length;
        if (result.conversationTitles.length < 500) {
          result.conversationTitles.push(imported.title);
        }

        // Track date range
        if (messages.length > 0) {
          const first = new Date(messages[0].timestamp).getTime();
          const last = new Date(messages[messages.length - 1].timestamp).getTime();
          if (first < earliest) earliest = first;
          if (last > latest) latest = last;
        }

        onConversation(imported);

      } catch (err) {
        if (result.errors.length < 100) {
          result.errors.push(`Error parsing "${convo.name}": ${err}`);
        }
      }
    },
    onError: (err, index) => {
      if (result.errors.length < 100) {
        result.errors.push(`JSON parse error at item ${index}: ${err.message}`);
      }
    },
  });

  result.dateRange.earliest = earliest === Infinity ? '' : new Date(earliest).toISOString();
  result.dateRange.latest = latest === -Infinity ? '' : new Date(latest).toISOString();
  console.log(`[CLAUDE PARSER] Stream complete: ${result.totalConversations} conversations, ${result.totalMessages} messages`);

  return result;
}
