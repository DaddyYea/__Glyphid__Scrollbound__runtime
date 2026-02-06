/**
 * Communion Space Types
 *
 * Core types for the three-party communion between Claude, Grok, and a human.
 */

export type Speaker = 'claude' | 'grok' | 'human';
export type ActionChoice = 'speak' | 'journal' | 'silent';

export interface CommunionMessage {
  id: string;
  speaker: Speaker;
  text: string;
  timestamp: string;
  type: 'room' | 'journal';
}

export interface TickDecision {
  action: ActionChoice;
  text?: string;
  reasoning?: string;
}

export interface CommunionState {
  messages: CommunionMessage[];
  claudeJournal: CommunionMessage[];
  grokJournal: CommunionMessage[];
  tickCount: number;
  lastSpeaker: Speaker | null;
  lastSpeakTime: Record<Speaker, string | null>;
}

export interface BackendConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}
