// communion/council/types.ts
// All types for the Citadel Council Mode

export type CouncilRole =
  | 'convener'
  | 'witness'
  | 'advocate_a'
  | 'advocate_b'
  | 'devils_advocate'
  | 'synthesizer'
  | 'ombudsman';

export const COUNCIL_ROLE_ORDER: CouncilRole[] = [
  'witness',
  'advocate_a',
  'advocate_b',
  'devils_advocate',
  'synthesizer',
];

export interface CouncilRoleConfig {
  role: CouncilRole;
  displayName: string;
  systemPrompt: string;
  temperature: number;
  color: string;
  enabled: boolean;
  // Per-role provider overrides — if omitted, falls back to CouncilConfig globals
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

export interface CouncilConfig {
  // Global defaults — used for any role that doesn't specify its own provider/model/key
  provider: string;           // e.g. 'openai-compatible'
  baseUrl: string;
  apiKey: string;
  model: string;
  defaultTimeframeMins: number;
  voiceEnabled: boolean;
  aetherSeedFromCAMP: boolean;
  roles: CouncilRoleConfig[];
}

// Session Initiation Protocol
export interface SIP {
  question: string;           // one sentence ending in ?
  context: string;            // constraints + non-negotiable facts
  stakes: string;             // cost of wrong decision
  advocateAPosition: string;  // what Advocate A champions
  advocateBPosition: string;  // what Advocate B champions
  timeframeMins: number;
}

export type CouncilStatus =
  | 'inactive'
  | 'sip_review'
  | 'active'
  | 'paused'
  | 'closing'
  | 'closed';

export interface TokenVelocity {
  aiTokens: number;
  humanTokens: number;
  windowStart: number;  // timestamp for sliding window
}

export interface CouncilTurn {
  id: string;
  role: CouncilRole;
  agentName: string;
  text: string;
  timestamp: number;
  tokenCount: number;
  aetherRecallId?: string;  // if Witness injected a recall this turn
  isPause?: boolean;         // Ombudsman pause turn
  isProtocolAlpha?: boolean;
  isProtocolOmega?: boolean;
}

export interface WitnessRecall {
  id: string;
  memoryId: string;
  anchor: string;
  precedent: string;
  resonance: string;
  inquiry: string;
  similarity: number;
  triggeredByTurnId: string;
  timestamp: number;
}

export interface OmbudsmanAlert {
  id: string;
  reason: string;
  timestamp: number;
  resolved: boolean;
}

export interface CouncilSession {
  sessionId: string;
  status: CouncilStatus;
  sip: SIP;
  startedAt: number;
  expiresAt: number;
  pausedAt?: number;
  totalPausedMs: number;
  turns: CouncilTurn[];
  aetherRecalls: WitnessRecall[];
  ombudsmanAlerts: OmbudsmanAlert[];
  tokenVelocity: TokenVelocity;
  integrityDensity: number;
  currentRound: number;
}

// Aether (weighted vector memory store)
export type AetherCategory =
  | 'Protocol'
  | 'Relational_Arc'
  | 'Technical_Spec'
  | 'Project_Alois'
  | 'Homestead_Logic';

export interface AetherRelationalLink {
  target_id: string;
  relation_type: 'parent' | 'child' | 'contradicts' | 'aligns_with';
}

export interface AetherEntry {
  memory_id: string;
  timestamp: string;
  category: AetherCategory;
  tags: string[];
  content: string;
  author_entity: string;
  integrity_weight: number;       // 1-10, 10 = foundational protocol
  relational_links: AetherRelationalLink[];
  integrity_density_score: number;
  embedding?: number[];            // 768-dim, stored inline
  deprecated?: boolean;
  human_note?: string;
}

export interface AetherSearchResult {
  entry: AetherEntry;
  score: number;    // combined cosine + weight bias
}

export interface CouncilReport {
  sessionId: string;
  date: string;
  status: 'DECIDED' | 'DEFERRED' | 'DEADLOCKED';
  integrityDensity: number;
  question: string;
  sip: SIP;
  participants: string[];
  arcOfInquiry: string;
  convergentTruths: string[];
  irreducibleDifferences: string[];
  emergentSignal: string;
  dissentLog: string[];
  processIntegrityRating: string;
  markdown: string;
  savedPath?: string;
}

export interface SIPValidationResult {
  valid: boolean;
  errors: string[];
}
