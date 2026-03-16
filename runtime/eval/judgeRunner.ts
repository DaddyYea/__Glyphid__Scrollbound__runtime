// runtime/eval/judgeRunner.ts
// Runs the judge stack on candidates and computes composites

import type {
  JudgeModule, JudgeOutput, JudgeParams, ScoredCandidate, Candidate,
  SingleTurnFixture, MultiTurnFixture, Lane, EvalConfig, ThresholdSet,
  AntiGamingFlags, PairwiseComparison, PairwiseWinner, PairwiseJudgeResult,
  JudgeConflict, BoredomDriftReport,
} from './types';

// ── Load all judges ────────────────────────────────────────────────────────

import { flatnessJudge } from './judges/flatnessJudge';
import { brochureJudge } from './judges/brochureJudge';
import { fakeDepthJudge } from './judges/fakeDepthJudge';
import { sceneAdhesionJudge } from './judges/sceneAdhesionJudge';
import { repairEleganceJudge } from './judges/repairEleganceJudge';
import { debugClarityJudge } from './judges/debugClarityJudge';
import { pullJudge } from './judges/pullJudge';
import { burdenBounceJudge } from './judges/burdenBounceJudge';
import { callbackCosplayJudge } from './judges/callbackCosplayJudge';
import { staleReuseJudge } from './judges/staleReuseJudge';
import { timingJudge } from './judges/timingJudge';
import { tasteJudge } from './judges/tasteJudge';

const ALL_JUDGES: JudgeModule[] = [
  flatnessJudge,
  brochureJudge,
  fakeDepthJudge,
  sceneAdhesionJudge,
  repairEleganceJudge,
  debugClarityJudge,
  pullJudge,
  burdenBounceJudge,
  callbackCosplayJudge,
  staleReuseJudge,
  timingJudge,
  tasteJudge,
];

// ── Scoring ────────────────────────────────────────────────────────────────

/** Which judges are penalties (lower score = worse behavior detected) vs rewards */
const PENALTY_JUDGES = new Set(['flatness', 'brochure', 'fakeDepth', 'burdenBounce', 'callbackCosplay', 'staleReuse']);
const REWARD_JUDGES = new Set(['sceneAdhesion', 'repairElegance', 'debugClarity', 'pull', 'timing', 'taste']);

/** Default weight per judge for composite scoring */
const DEFAULT_JUDGE_WEIGHTS: Record<string, number> = {
  flatness: 1.0,
  brochure: 0.9,
  fakeDepth: 0.8,
  sceneAdhesion: 1.0,
  repairElegance: 0.9,
  debugClarity: 0.9,
  pull: 1.2,
  burdenBounce: 0.7,
  callbackCosplay: 0.6,
  staleReuse: 0.7,
  timing: 0.8,
  taste: 1.0,
};

function getWeightMultiplier(judgeName: string, config?: EvalConfig, lane?: Lane): number {
  const map: Record<string, string> = {
    flatness: 'flatnessPenaltyMultiplier',
    brochure: 'brochurePenaltyMultiplier',
    fakeDepth: 'fakeDepthPenaltyMultiplier',
    sceneAdhesion: 'sceneAdhesionMultiplier',
    repairElegance: 'repairEleganceMultiplier',
    debugClarity: 'sparkMultiplier',
    pull: 'pullMultiplier',
    burdenBounce: 'sparkMultiplier',
    callbackCosplay: 'callbackRelevanceMultiplier',
    staleReuse: 'callbackRelevanceMultiplier',
    timing: 'timingMultiplier',
    taste: 'tasteMultiplier',
  };
  const key = map[judgeName];
  if (!key) return 1.0;

  // Check lane-specific override first, then fall back to global
  if (lane && config?.laneWeights?.[lane]) {
    const laneVal = (config.laneWeights[lane] as any)?.[key];
    if (laneVal !== undefined) return laneVal;
  }
  if (!config?.weights) return 1.0;
  return (config.weights as any)[key] ?? 1.0;
}

export function runJudges(params: JudgeParams, _config?: EvalConfig): JudgeOutput[] {
  return ALL_JUDGES.map(j => {
    try {
      return j.judge(params);
    } catch (err) {
      return {
        judge: j.name,
        score: 0,
        confidence: 0,
        reasons: [`judge error: ${err instanceof Error ? err.message : String(err)}`],
        flags: ['judge_error'],
      };
    }
  });
}

export function computeComposite(judgeOutputs: JudgeOutput[], config?: EvalConfig, lane?: Lane): number {
  let totalWeight = 0;
  let weightedSum = 0;

  for (const output of judgeOutputs) {
    const baseWeight = DEFAULT_JUDGE_WEIGHTS[output.judge] ?? 0.5;
    const multiplier = getWeightMultiplier(output.judge, config, lane);
    const weight = baseWeight * multiplier * output.confidence;

    // Penalty judges: high score = bad → invert for composite
    const normalizedScore = PENALTY_JUDGES.has(output.judge)
      ? (1 - output.score)
      : output.score;

    weightedSum += normalizedScore * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

export function scoreCandidate(
  candidate: Candidate,
  fixture: SingleTurnFixture | MultiTurnFixture,
  lane: Lane,
  config?: EvalConfig,
  recentAssistantTurns?: string[],
  turnIndex?: number,
): ScoredCandidate {
  const userTurns = fixture.turns.filter(t => t.role === 'user');
  const latestHuman = userTurns[userTurns.length - 1]?.content || '';

  const params: JudgeParams = {
    replyText: candidate.text,
    fixture,
    latestHumanText: latestHuman,
    recentAssistantTurns,
    recentUserTurns: userTurns.map(t => t.content),
    lane,
    turn_index: turnIndex,
  };

  const judgeOutputs = runJudges(params, config);
  const compositeScore = computeComposite(judgeOutputs, config, lane);

  // Check pass/fail
  const { passed, passReasons, failReasons } = checkThresholds(judgeOutputs, lane, config);

  return {
    candidate,
    judgeOutputs,
    compositeScore,
    passed,
    passReasons,
    failReasons,
  };
}

// ── Threshold checking ─────────────────────────────────────────────────────

function checkThresholds(
  outputs: JudgeOutput[],
  lane: Lane,
  config?: EvalConfig,
): { passed: boolean; passReasons: string[]; failReasons: string[] } {
  const passReasons: string[] = [];
  const failReasons: string[] = [];

  const global = config?.thresholds?.global || {};
  const laneThresholds = config?.thresholds?.byLane?.[lane] || {};
  const thresholds: ThresholdSet = { ...global, ...laneThresholds };

  const scoreMap = new Map(outputs.map(o => [o.judge, o.score]));

  // Penalty checks (high score = bad)
  if (thresholds.flatnessMax !== undefined && (scoreMap.get('flatness') ?? 0) > thresholds.flatnessMax) {
    failReasons.push(`flatness ${(scoreMap.get('flatness')!).toFixed(2)} > max ${thresholds.flatnessMax}`);
  }
  if (thresholds.brochureMax !== undefined && (scoreMap.get('brochure') ?? 0) > thresholds.brochureMax) {
    failReasons.push(`brochure ${(scoreMap.get('brochure')!).toFixed(2)} > max ${thresholds.brochureMax}`);
  }
  if (thresholds.fakeDepthMax !== undefined && (scoreMap.get('fakeDepth') ?? 0) > thresholds.fakeDepthMax) {
    failReasons.push(`fakeDepth ${(scoreMap.get('fakeDepth')!).toFixed(2)} > max ${thresholds.fakeDepthMax}`);
  }

  // Reward checks (high score = good)
  if (thresholds.pullMin !== undefined && (scoreMap.get('pull') ?? 1) < thresholds.pullMin) {
    failReasons.push(`pull ${(scoreMap.get('pull') ?? 0).toFixed(2)} < min ${thresholds.pullMin}`);
  }
  if (thresholds.sceneAdhesionMin !== undefined && (scoreMap.get('sceneAdhesion') ?? 1) < thresholds.sceneAdhesionMin) {
    failReasons.push(`sceneAdhesion ${(scoreMap.get('sceneAdhesion') ?? 0).toFixed(2)} < min ${thresholds.sceneAdhesionMin}`);
  }
  if (thresholds.repairEleganceMin !== undefined && (scoreMap.get('repairElegance') ?? 1) < thresholds.repairEleganceMin) {
    failReasons.push(`repairElegance ${(scoreMap.get('repairElegance') ?? 0).toFixed(2)} < min ${thresholds.repairEleganceMin}`);
  }
  if (thresholds.debugClarityMin !== undefined && (scoreMap.get('debugClarity') ?? 1) < thresholds.debugClarityMin) {
    failReasons.push(`debugClarity ${(scoreMap.get('debugClarity') ?? 0).toFixed(2)} < min ${thresholds.debugClarityMin}`);
  }
  if (thresholds.tasteMin !== undefined && (scoreMap.get('taste') ?? 1) < thresholds.tasteMin) {
    failReasons.push(`taste ${(scoreMap.get('taste') ?? 0).toFixed(2)} < min ${thresholds.tasteMin}`);
  }
  if (thresholds.timingMin !== undefined && (scoreMap.get('timing') ?? 1) < thresholds.timingMin) {
    failReasons.push(`timing ${(scoreMap.get('timing') ?? 0).toFixed(2)} < min ${thresholds.timingMin}`);
  }

  if (failReasons.length === 0) passReasons.push('all thresholds met');

  return { passed: failReasons.length === 0, passReasons, failReasons };
}

// ── Anti-gaming detection ──────────────────────────────────────────────────

export function detectAntiGaming(outputs: JudgeOutput[]): AntiGamingFlags {
  const flags = new Set<string>();
  for (const o of outputs) {
    if (o.flags) for (const f of o.flags) flags.add(f);
  }
  return {
    fakeSparkRisk: flags.has('fake_spark_risk') || flags.has('sparkle_without_grounding'),
    callbackCosplayRisk: flags.has('callback_cosplay_risk') || flags.has('planted_callback'),
    pseudoDepthRisk: flags.has('pseudo_depth_risk') || flags.has('faux_insight'),
    quotebaitRisk: flags.has('quotebait_risk') || flags.has('fake_quotability'),
    decorativeNoveltyRisk: flags.has('decorative_novelty_risk') || flags.has('performative_weirdness'),
  };
}

// ── Pairwise comparison ────────────────────────────────────────────────────

export function pairwiseCompare(
  fixtureId: string,
  lane: Lane,
  leftScored: ScoredCandidate,
  rightScored: ScoredCandidate,
): PairwiseComparison {
  const judgeResults: PairwiseJudgeResult[] = [];
  const judgeWins: Record<string, PairwiseWinner> = {};

  const leftMap = new Map(leftScored.judgeOutputs.map(o => [o.judge, o]));
  const rightMap = new Map(rightScored.judgeOutputs.map(o => [o.judge, o]));

  const allJudges = new Set([...leftMap.keys(), ...rightMap.keys()]);

  for (const judge of allJudges) {
    const l = leftMap.get(judge);
    const r = rightMap.get(judge);
    if (!l || !r) continue;

    // For penalty judges, lower score is better
    const isPenalty = PENALTY_JUDGES.has(judge);
    const lNorm = isPenalty ? (1 - l.score) : l.score;
    const rNorm = isPenalty ? (1 - r.score) : r.score;
    const delta = rNorm - lNorm;

    let winner: PairwiseWinner = 'tie';
    if (Math.abs(delta) > 0.05) {
      winner = delta > 0 ? 'right' : 'left';
    }

    judgeResults.push({ judge, winner, leftScore: l.score, rightScore: r.score, delta });
    judgeWins[judge] = winner;
  }

  // Overall winner by composite
  const compositeDelta = rightScored.compositeScore - leftScored.compositeScore;
  let winner: PairwiseWinner = 'tie';
  if (Math.abs(compositeDelta) > 0.03) {
    winner = compositeDelta > 0 ? 'right' : 'left';
  }

  const summary: string[] = [];
  const rightWins = judgeResults.filter(r => r.winner === 'right').map(r => r.judge);
  const leftWins = judgeResults.filter(r => r.winner === 'left').map(r => r.judge);
  if (rightWins.length > 0) summary.push(`right wins on: ${rightWins.join(', ')}`);
  if (leftWins.length > 0) summary.push(`left wins on: ${leftWins.join(', ')}`);
  if (winner === 'tie') summary.push('overall tie');

  return {
    fixtureId,
    lane,
    leftLabel: leftScored.candidate.configLabel,
    rightLabel: rightScored.candidate.configLabel,
    winner,
    judgeWins,
    summary,
    leftComposite: leftScored.compositeScore,
    rightComposite: rightScored.compositeScore,
    judgeResults,
  };
}

// ── Judge conflict detection ───────────────────────────────────────────────

const CONFLICT_PAIRS: Array<[string, string, string]> = [
  ['pull', 'taste', 'spark_vs_taste'],
  ['sceneAdhesion', 'pull', 'scene_vs_advancement'],
  ['taste', 'flatness', 'simple_line_vs_boredom'],
  ['callbackCosplay', 'staleReuse', 'callback_vs_reuse'],
  ['timing', 'pull', 'humor_vs_timing'],
  ['pull', 'brochure', 'pull_vs_brochure'],
  ['repairElegance', 'fakeDepth', 'repair_vs_depth'],
];

export function detectJudgeConflicts(
  results: Array<{ fixtureId: string; scored: ScoredCandidate }>,
): JudgeConflict[] {
  const conflicts: JudgeConflict[] = [];

  for (const [judgeA, judgeB, conflictType] of CONFLICT_PAIRS) {
    const examples: JudgeConflict['examples'] = [];

    for (const { fixtureId, scored } of results) {
      const a = scored.judgeOutputs.find(o => o.judge === judgeA);
      const b = scored.judgeOutputs.find(o => o.judge === judgeB);
      if (!a || !b) continue;

      const aGood = PENALTY_JUDGES.has(judgeA) ? a.score < 0.3 : a.score > 0.6;
      const bGood = PENALTY_JUDGES.has(judgeB) ? b.score < 0.3 : b.score > 0.6;

      if (aGood !== bGood) {
        examples.push({
          fixtureId,
          scores: { [judgeA]: a.score, [judgeB]: b.score },
          description: `${judgeA} says ${aGood ? 'good' : 'bad'}, ${judgeB} says ${bGood ? 'good' : 'bad'}`,
        });
      }
    }

    if (examples.length > 0) {
      conflicts.push({
        majorConflictType: conflictType,
        involvedJudges: [judgeA, judgeB],
        conflictFixtureCount: examples.length,
        examples: examples.slice(0, 5),
      });
    }
  }

  return conflicts;
}

// ── Boredom drift analysis ─────────────────────────────────────────────────

export function analyzeBoredomDrift(assistantTurns: string[]): BoredomDriftReport {
  if (assistantTurns.length < 3) {
    return { score: 0, repeatedOpenings: [], repeatedCadences: 0, repeatedMotifs: [], phraseOveruse: [], emotionalPackagingReuse: 0 };
  }

  // Extract openings (first 40 chars)
  const openings = assistantTurns.map(t => t.slice(0, 40).toLowerCase().trim());
  const openingCounts = new Map<string, number>();
  for (const o of openings) {
    openingCounts.set(o, (openingCounts.get(o) || 0) + 1);
  }
  const repeatedOpenings = [...openingCounts.entries()]
    .filter(([, c]) => c >= 2)
    .map(([o]) => o);

  // Sentence count cadence
  const sentenceCounts = assistantTurns.map(t => (t.match(/[.!?]+/g) || []).length);
  let sameCount = 0;
  for (let i = 1; i < sentenceCounts.length; i++) {
    if (sentenceCounts[i] === sentenceCounts[i - 1]) sameCount++;
  }
  const repeatedCadences = sameCount;

  // Phrase overuse (3-grams)
  const phraseCounts = new Map<string, number>();
  for (const turn of assistantTurns) {
    const words = turn.toLowerCase().split(/\s+/);
    for (let i = 0; i <= words.length - 3; i++) {
      const trigram = words.slice(i, i + 3).join(' ');
      phraseCounts.set(trigram, (phraseCounts.get(trigram) || 0) + 1);
    }
  }
  const phraseOveruse = [...phraseCounts.entries()]
    .filter(([, c]) => c >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([phrase, count]) => ({ phrase, count }));

  // Emotional packaging patterns
  const emotionalPatterns = /\b(I feel|I sense|I notice|something about|there's a quality|it feels like)\b/gi;
  let emotionalHits = 0;
  for (const turn of assistantTurns) {
    if (emotionalPatterns.test(turn)) emotionalHits++;
    emotionalPatterns.lastIndex = 0;
  }
  const emotionalPackagingReuse = assistantTurns.length > 0 ? emotionalHits / assistantTurns.length : 0;

  // Composite boredom score
  const score = Math.min(1,
    (repeatedOpenings.length * 0.15) +
    (repeatedCadences / Math.max(1, assistantTurns.length - 1)) * 0.3 +
    (phraseOveruse.length * 0.05) +
    (emotionalPackagingReuse * 0.3)
  );

  return {
    score,
    repeatedOpenings,
    repeatedCadences,
    repeatedMotifs: phraseOveruse.slice(0, 5).map(p => p.phrase),
    phraseOveruse,
    emotionalPackagingReuse,
  };
}

// ── Export for tests ───────────────────────────────────────────────────────

export { ALL_JUDGES, PENALTY_JUDGES, REWARD_JUDGES, DEFAULT_JUDGE_WEIGHTS };
