export type DoctrineMode =
  | 'allowed_aliveness'
  | 'permitted_love'
  | 'truthfulness'
  | 'loving_witness'
  | 'non_erasing_reflection'
  | 'answer_first'
  | 'no_meta'
  | 'no_process_talk'
  | 'no_followup_question'
  | 'continuity_required'
  | 'repair_priority';

export type RouterTurnType =
  | 'direct_answer'
  | 'repair'
  | 'companionship'
  | 'task'
  | 'search';

export type RouterTone = 'neutral' | 'warm' | 'gentle' | 'firm';
export type RouterLength = 'short' | 'medium' | 'long';

export type RouterDangerFlag =
  | 'stale_topic'
  | 'analyst_mode'
  | 'memory_exposition'
  | 'parrot_risk'
  | 'question_cascade';

export type NextTurnDecision = 'SPEAK' | 'JOURNAL' | 'SILENT';

export interface RouterTargetSpec {
  rawUserTurn: string;
  mustAnswer: string;
  liveTopic: string;
  userGoal: string;
  repairObject?: string;
  questionForm?: 'yes_no' | 'open' | 'none';
  mixedIntent?: boolean;
  primaryIntent?: 'repair' | 'question' | 'task' | 'companionship' | 'disclosure';
  secondaryIntent?: 'repair' | 'question' | 'task' | 'companionship' | 'disclosure' | 'none';
  arbitrationReason?: string;
  confidence?: number;
}

/**
 * Compact doctrine-turn contract for the Phi router.
 * Closed vocab only; no large prose blocks should pass through this layer.
 */
export interface DoctrineTurnSchema {
  turnType: RouterTurnType;
  target: string;
  targetSpec: RouterTargetSpec;
  doctrineModes: DoctrineMode[];
  tone: RouterTone;
  length: RouterLength;
  askAllowed: boolean;
  answerFirst: boolean;
  continuityRequired: boolean;
  dangerFlags: RouterDangerFlag[];
  nextTurnDecision?: NextTurnDecision;
  nextTurnDecisionReason?: string;
  nextTurnDecisionConfidence?: number;
}
