/**
 * Chat History Import Types
 *
 * Shared types for importing chat history from various platforms
 * (ChatGPT/OpenAI, xAI/Grok, Anthropic/Claude) into the communion memory systems.
 */

/**
 * A single message extracted from any platform's export
 */
export interface ImportedMessage {
  /** Unique ID (from source platform or generated) */
  id: string;
  /** 'user' | 'assistant' | 'system' | 'tool' */
  role: string;
  /** Display name of the speaker */
  speakerName: string;
  /** Message content (text only) */
  content: string;
  /** ISO timestamp */
  timestamp: string;
  /** Which model generated it (if known) */
  model?: string;
}

/**
 * A conversation (thread) from any platform
 */
export interface ImportedConversation {
  /** Platform conversation ID */
  id: string;
  /** Conversation title */
  title: string;
  /** ISO timestamp of creation */
  created: string;
  /** ISO timestamp of last update */
  updated: string;
  /** Ordered messages (chronological) */
  messages: ImportedMessage[];
  /** Source platform */
  source: ImportSource;
  /** Model used (if consistent across convo) */
  model?: string;
  /** Raw metadata from the platform */
  metadata?: Record<string, unknown>;
}

/**
 * Supported import sources
 */
export type ImportSource = 'chatgpt' | 'anthropic' | 'xai' | 'openai-api';

/**
 * Import result summary
 */
export interface ImportResult {
  source: ImportSource;
  totalConversations: number;
  totalMessages: number;
  skippedMessages: number;
  dateRange: { earliest: string; latest: string };
  conversationTitles: string[];
  errors: string[];
}

/**
 * Options for controlling import behavior
 */
export interface ImportOptions {
  /** Only import conversations after this date (ISO string) */
  after?: string;
  /** Only import conversations before this date (ISO string) */
  before?: string;
  /** Only import conversations matching these title patterns (regex) */
  titleFilter?: string;
  /** Maximum number of conversations to import */
  maxConversations?: number;
  /** Maximum messages per conversation */
  maxMessagesPerConversation?: number;
  /** Skip system messages */
  skipSystem?: boolean;
  /** Skip tool/function call messages */
  skipTool?: boolean;
  /** Custom speaker name for 'user' role */
  userName?: string;
  /** Custom speaker name for 'assistant' role */
  assistantName?: string;
  /** Dry run — parse and report without persisting */
  dryRun?: boolean;
}
