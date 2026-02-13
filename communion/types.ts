/**
 * Communion Space Types
 *
 * Core types for N-party communion. Any number of AI agents + a human.
 */

export type ActionChoice = 'speak' | 'journal' | 'silent';

/**
 * Agent configuration — define any agent with a provider + model + name
 */
export interface AgentConfig {
  /** Unique ID for this agent (e.g. 'claude', 'grok', 'openai') */
  id: string;
  /** Display name shown in the room */
  name: string;
  /** API provider type */
  provider: 'anthropic' | 'openai-compatible' | 'alois';
  /** API key */
  apiKey: string;
  /** Model identifier */
  model: string;
  /** Base URL for the API (required for openai-compatible) */
  baseUrl?: string;
  /** System prompt override (optional — a default is generated) */
  systemPrompt?: string;
  /** Color for UI display (hex) */
  color?: string;
  /** Temperature (default 0.8) */
  temperature?: number;
  /** Max tokens per response (default 512) */
  maxTokens?: number;
  /** Voice configuration */
  voice?: {
    voiceId: string;
    enabled: boolean;
  };
  /** Per-agent clock multiplier — agent ticks every N master ticks (default 1 = every tick) */
  tickEveryN?: number;
}

export interface CommunionMessage {
  id: string;
  speaker: string; // agent ID or 'human'
  speakerName: string; // display name
  text: string;
  timestamp: string;
  type: 'room' | 'journal';
}

export interface TickDecision {
  action: ActionChoice;
  text?: string;
}

export interface CommunionConfig {
  /** Human participant name */
  humanName: string;
  /** Agents in the communion */
  agents: AgentConfig[];
  /** Tick interval in ms (default 15000) */
  tickIntervalMs?: number;
  /** Data directory for persistence (default 'data/communion') */
  dataDir?: string;
  /** Max room messages to keep in context (default 30) */
  contextWindow?: number;
  /** Max journal entries to show in context (default 10) */
  journalContextWindow?: number;
  /** Directory for shared documents all agents can read (default 'communion-docs') */
  documentsDir?: string;
}
