// runtime/eval/types.ts
// Core types for the eval harness

// ── Fixture types ──────────────────────────────────────────────────────────

export type Lane =
  | 'companionship'
  | 'relational_check'
  | 'relational_answer'
  | 'repair_response'
  | 'explanation_or_debug'
  | 'task_or_helper'
  | 'low_payload'
  | 'stakes';

export type Stakes = 'low' | 'medium' | 'high' | 'critical';

export type Phase =
  | 'foggy' | 'technical' | 'playful' | 'grieving' | 'wandering'
  | 'hungry' | 'brittle' | 'companionship_seeking' | 'locked_in'
  | 'frustrated' | 'neutral';

export type ReplyShape =
  | 'knife' | 'witness' | 'riff' | 'diagnosis' | 'scene_touch'
  | 'answer_then_pull' | 'correction' | 'artifact' | 'question'
  | 'acknowledgment';

export interface FixtureTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface SingleTurnFixture {
  id: string;
  lane: Lane;
  turns: FixtureTurn[];
  tags: string[];
  stakes: Stakes;
  phase?: Phase;
  sceneContext?: string;
  must_not?: string[];
  should_reward?: string[];
  known_good_traits?: string[];
  known_bad_traits?: string[];
  known_good_examples?: string[];
  known_bad_examples?: string[];
  expectedConstraints?: string[];
}

export interface TurnExpectation {
  must_reward?: string[];
  must_not?: string[];
  continuity?: string[];
}

export interface MultiTurnFixture {
  id: string;
  lane_sequence: Lane[];
  turns: FixtureTurn[];
  expectations: TurnExpectation[];
  tags: string[];
  stakes?: Stakes;
  phase_sequence?: Phase[];
  continuity_requirements?: string[];
  must_not_regress_into?: string[];
}

// ── Judge types ────────────────────────────────────────────────────────────

export interface JudgeOutput {
  judge: string;
  score: number;       // 0–1 (higher = better, except penalty judges where lower = better)
  confidence: number;  // 0–1
  reasons: string[];
  flags?: string[];
  excerpts?: string[];
}

export interface JudgeModule {
  name: string;
  judge(params: JudgeParams): JudgeOutput;
}

export interface JudgeParams {
  replyText: string;
  fixture: SingleTurnFixture | MultiTurnFixture;
  latestHumanText: string;
  recentAssistantTurns?: string[];
  recentUserTurns?: string[];
  lane: Lane;
  turn_index?: number;  // for multi-turn
}

// ── Candidate types ────────────────────────────────────────────────────────

export interface Candidate {
  id: string;
  text: string;
  configLabel: string;
  shape?: ReplyShape;
  generationMs?: number;
}

export interface ScoredCandidate {
  candidate: Candidate;
  judgeOutputs: JudgeOutput[];
  compositeScore: number;
  passed: boolean;
  passReasons: string[];
  failReasons: string[];
}

// ── Pairwise types ─────────────────────────────────────────────────────────

export type PairwiseWinner = 'left' | 'right' | 'tie';

export interface PairwiseJudgeResult {
  judge: string;
  winner: PairwiseWinner;
  leftScore: number;
  rightScore: number;
  delta: number;
}

export interface PairwiseComparison {
  fixtureId: string;
  lane: Lane;
  leftLabel: string;
  rightLabel: string;
  winner: PairwiseWinner;
  judgeWins: Record<string, PairwiseWinner>;
  summary: string[];
  leftComposite: number;
  rightComposite: number;
  judgeResults: PairwiseJudgeResult[];
}

// ── Config types ───────────────────────────────────────────────────────────

export interface LaneGenerationProfile {
  temperature: number;
  top_p: number;
  candidateCount: number;
  maxTokens: number;
  surpriseBudget: number;
  humorAllowance: number;
  metaphorAllowance: number;
  compressionBias: number;
  bloomBias: number;
}

export interface WeightOverrides {
  tasteMultiplier?: number;
  sparkMultiplier?: number;
  sceneAdhesionMultiplier?: number;
  callbackRelevanceMultiplier?: number;
  antiBoredomMultiplier?: number;
  simpleLinePrivilegeMultiplier?: number;
  overcompletionPenaltyMultiplier?: number;
  phaseInfluenceMultiplier?: number;
  repairEleganceMultiplier?: number;
  pullMultiplier?: number;
  flatnessPenaltyMultiplier?: number;
  brochurePenaltyMultiplier?: number;
  fakeDepthPenaltyMultiplier?: number;
  timingMultiplier?: number;
}

export interface EvalConfig {
  label: string;
  description?: string;
  laneProfiles: Partial<Record<Lane, Partial<LaneGenerationProfile>>>;
  // Weight overrides (multipliers applied to judge composites)
  weights?: WeightOverrides;
  // Per-lane weight overrides (merged on top of global weights for that lane)
  laneWeights?: Partial<Record<Lane, Partial<WeightOverrides>>>;
  // Ablation flags — when true, that subsystem is disabled
  ablations?: {
    sparkLayerOff?: boolean;
    substrateLayerOff?: boolean;
    braidedPhaseOff?: boolean;
    sceneLedgerOff?: boolean;
    returnShapeMemoryOff?: boolean;
    tasteRerankOff?: boolean;
    subtextRestraintOff?: boolean;
    rhythmPenaltyOff?: boolean;
    callbackRelevanceOff?: boolean;
    repairEleganceOff?: boolean;
    simpleLinePrivilegeOff?: boolean;
  };
  // Pass/fail thresholds
  thresholds?: {
    global?: ThresholdSet;
    byLane?: Partial<Record<Lane, Partial<ThresholdSet>>>;
  };
}

export interface ThresholdSet {
  flatnessMax?: number;
  brochureMax?: number;
  fakeDepthMax?: number;
  pullMin?: number;
  sceneAdhesionMin?: number;
  repairEleganceMin?: number;
  debugClarityMin?: number;
  tasteMin?: number;
  timingMin?: number;
}

// ── Sweep types ────────────────────────────────────────────────────────────

export interface SweepConfig {
  label: string;
  variants: Array<Record<string, number>>;
}

// ── Anti-gaming flags ──────────────────────────────────────────────────────

export interface AntiGamingFlags {
  fakeSparkRisk: boolean;
  callbackCosplayRisk: boolean;
  pseudoDepthRisk: boolean;
  quotebaitRisk: boolean;
  decorativeNoveltyRisk: boolean;
}

// ── Negative library entry ─────────────────────────────────────────────────

export interface NegativeExample {
  id: string;
  label: string;
  category: string;
  text: string;
  why_it_fails: string;
  expected_judges: string[];
  lane?: Lane;
  tags?: string[];
}

// ── Engagement events ──────────────────────────────────────────────────────

export type EngagementEventType =
  | 'spark' | 'laugh' | 'quoteback' | 'depth'
  | 'boredom' | 'correction' | 'dead_reply' | 'pivot_away';

export interface EngagementEvent {
  type: EngagementEventType;
  turn_index: number;
  confidence: number;
  reason?: string;
}

// ── Boredom / long-horizon drift ───────────────────────────────────────────

export interface BoredomDriftReport {
  score: number;
  repeatedOpenings: string[];
  repeatedCadences: number;
  repeatedMotifs: string[];
  phraseOveruse: Array<{ phrase: string; count: number }>;
  emotionalPackagingReuse: number;
}

// ── Report types ───────────────────────────────────────────────────────────

export interface FixtureResult {
  fixtureId: string;
  lane: Lane;
  candidateResults: ScoredCandidate[];
  bestCandidate: ScoredCandidate | null;
  passed: boolean;
  passReasons: string[];
  failReasons: string[];
  antiGamingFlags?: AntiGamingFlags;
  engagementEvents?: EngagementEvent[];
}

export interface LaneMetrics {
  lane: Lane;
  fixtureCount: number;
  passCount: number;
  failCount: number;
  passRate: number;
  avgComposite: number;
  avgByJudge: Record<string, number>;
}

export interface JudgeConflict {
  majorConflictType: string;
  involvedJudges: string[];
  conflictFixtureCount: number;
  examples: Array<{
    fixtureId: string;
    scores: Record<string, number>;
    description: string;
  }>;
}

export interface EvalReport {
  runId: string;
  configLabel: string;
  suite: string;
  timestamp: string;
  totals: {
    fixtureCount: number;
    passCount: number;
    failCount: number;
    passRate: number;
    avgComposite: number;
  };
  laneMetrics: LaneMetrics[];
  judgeMetrics: Record<string, { avg: number; min: number; max: number; stddev: number }>;
  regressions: Array<{ fixtureId: string; lane: Lane; delta: number; reason: string }>;
  improvements: Array<{ fixtureId: string; lane: Lane; delta: number; reason: string }>;
  judgeConflicts: JudgeConflict[];
  boredomDrift: BoredomDriftReport | null;
  worstCases: FixtureResult[];
  bestCases: FixtureResult[];
}

// ── Reranker export ────────────────────────────────────────────────────────

export interface RerankerExportRow {
  fixtureId: string;
  lane: Lane;
  phaseSummary: string;
  sceneSummary: string;
  candidateText: string;
  compositeScore: number;
  judgeOutputs: Record<string, number>;
  winnerLabel: boolean;
  engagementLabels?: EngagementEventType[];
}

// ── Response-shape planning ────────────────────────────────────────────────

export interface ShapePlan {
  plannedShapes: ReplyShape[];
  selectedShapeForCandidate: ReplyShape;
  shapePlanReason: string;
}
