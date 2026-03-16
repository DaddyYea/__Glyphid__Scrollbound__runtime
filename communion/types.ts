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
  provider: 'anthropic' | 'openai-compatible' | 'lmstudio' | 'alois' | 'brain-local';
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
  /** Max provider context window (prompt + completion). */
  maxContextTokens?: number;
  /** Safety margin reserved for tokenizer/provider overhead (default 512). */
  safetyTokens?: number;
  /** Token estimation mode for context budgeting. */
  tokenEstimationMode?: 'heuristic';
  /** Voice configuration */
  voice?: {
    voiceId: string;
    enabled: boolean;
  };
  /** Per-agent clock multiplier — agent ticks every N master ticks (default 1 = every tick) */
  tickEveryN?: number;
  routerModel?: string;
  routerMode?: 'heuristic' | 'phi';
  routerModelSource?: 'local' | 'huggingface' | 'ollama' | 'lmstudio';
  routerModelPath?: string;
  routerModelBackend?: 'llamacpp' | 'ollama' | 'openai-compatible' | 'lmstudio';
  languageModel?: string;
  languageModelSource?: 'local' | 'huggingface' | 'ollama' | 'lmstudio';
  languageModelPath?: string;
  languageModelBackend?: 'llamacpp' | 'ollama' | 'openai-compatible' | 'lmstudio';
}

export interface CommunionMessage {
  id: string;
  speaker: string; // agent ID or 'human'
  speakerName: string; // display name
  text: string;
  visibleText?: string;
  anchoredAfterMessageId?: string;
  timestamp: string;
  type: 'room' | 'journal';
  /** Monotonic sequence number assigned at ingestion time (human turns only). */
  humanTurnSequence?: number;
  /** True when validation modified/rejected the original model output. Excluded from prompt history. */
  rejected?: boolean;
}

export interface TickDecision {
  action: ActionChoice;
  text?: string;
}

// ── Golden Set Types ──────────────────────────────────────────────────────

export type GoldenCaptureMode = 'good' | 'bad' | 'pair';

export interface GoldenExample {
  id: string;
  createdAt: string;
  captureMode: GoldenCaptureMode;
  sessionId: string;
  conversationId: string;
  turnId: string;
  messageId: string;
  userTurnText: string;
  assistantReplyText: string;
  localWindow: Array<{ role: string; text: string }>;
  laneProfile: string;
  responseFrame: string;
  turnFamily: string;
  detectedPhase: string;
  phaseConfidence: number;
  tags: string[];
  note: string | null;
  traceSnapshot: Record<string, unknown> | null;
  runtimeVersion: string;
  model: string;
  promotedByUser: boolean;
  pairGroupId: string | null;
  preferredOverExampleId: string | null;
  rejectedAlternativeIds: string[] | null;
  outcome: GoldenOutcome | null;
}

export interface GoldenOutcome {
  userRepliedAfter: boolean;
  replyLatencyMs: number;
  nextUserTurnLength: number;
  quotebackDetected: boolean;
  laughDetected: boolean;
  correctionDetected: boolean;
  sparkEventDetected: boolean;
  boredomEventDetected: boolean;
  depthEventDetected: boolean;
  pivotAwayDetected: boolean;
}

export interface GoldenEnrichment {
  type: 'golden_enrichment';
  exampleId: string;
  updatedAt: string;
  outcome: Partial<GoldenOutcome>;
}

export interface PreferencePair {
  id: string;
  createdAt: string;
  leftExampleId: string;
  rightExampleId: string;
  preference: 'left' | 'right';
  preferenceStrength: number;
  sourceType: 'explicit' | 'manual' | 'weak';
  lane: string;
  phase: string;
  contextSimilarity: number | null;
}

export interface UserPreferenceProfile {
  version: number;
  updatedAt: string;
  totalPromotions: number;
  totalGood: number;
  totalBad: number;
  totalPair: number;
  tagCounts: Record<string, number>;
  laneGoodCounts: Record<string, number>;
  laneBadCounts: Record<string, number>;
  phaseGoodCounts: Record<string, number>;
  phaseBadCounts: Record<string, number>;
  replyShapeAffinity: Record<string, number>;
  sparksPerLane: Record<string, number>;
  flatsPerLane: Record<string, number>;
}

export interface ScoringBundle {
  version: number;
  createdAt: string;
  label: string;
  weights: Record<string, number>;
  laneWeights: Record<string, Record<string, number>>;
  thresholds: Record<string, number>;
  laneThresholds: Record<string, Record<string, number>>;
  derivedFromExampleCount: number;
  evalRunId: string | null;
  evalDelta: number | null;
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
