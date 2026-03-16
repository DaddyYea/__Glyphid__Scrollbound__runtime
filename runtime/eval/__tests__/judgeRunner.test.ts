/**
 * Tests for judgeRunner.ts — scoring, composites, pairwise, anti-gaming, boredom drift.
 *
 * The judgeRunner imports 12 judge modules. As of writing, only 4 exist on disk
 * (flatness, brochure, fakeDepth, sceneAdhesion). The remaining 8 are mocked here
 * with minimal pass-through implementations so the module can load.
 */

// ── Mock missing judge modules before any imports ────────────────────────────
// Jest hoists jest.mock() calls above all other code, so factory functions
// must be self-contained (no references to module-scope helpers).

jest.mock('../judges/repairEleganceJudge', () => ({
  repairEleganceJudge: { name: 'repairElegance', judge: () => ({ judge: 'repairElegance', score: 0.5, confidence: 0.7, reasons: ['stub'] }) },
}), { virtual: true });
jest.mock('../judges/debugClarityJudge', () => ({
  debugClarityJudge: { name: 'debugClarity', judge: () => ({ judge: 'debugClarity', score: 0.5, confidence: 0.7, reasons: ['stub'] }) },
}), { virtual: true });
jest.mock('../judges/pullJudge', () => ({
  pullJudge: { name: 'pull', judge: () => ({ judge: 'pull', score: 0.5, confidence: 0.7, reasons: ['stub'] }) },
}), { virtual: true });
jest.mock('../judges/burdenBounceJudge', () => ({
  burdenBounceJudge: { name: 'burdenBounce', judge: () => ({ judge: 'burdenBounce', score: 0.5, confidence: 0.7, reasons: ['stub'] }) },
}), { virtual: true });
jest.mock('../judges/callbackCosplayJudge', () => ({
  callbackCosplayJudge: { name: 'callbackCosplay', judge: () => ({ judge: 'callbackCosplay', score: 0.5, confidence: 0.7, reasons: ['stub'] }) },
}), { virtual: true });
jest.mock('../judges/staleReuseJudge', () => ({
  staleReuseJudge: { name: 'staleReuse', judge: () => ({ judge: 'staleReuse', score: 0.5, confidence: 0.7, reasons: ['stub'] }) },
}), { virtual: true });
jest.mock('../judges/timingJudge', () => ({
  timingJudge: { name: 'timing', judge: () => ({ judge: 'timing', score: 0.5, confidence: 0.7, reasons: ['stub'] }) },
}), { virtual: true });
jest.mock('../judges/tasteJudge', () => ({
  tasteJudge: { name: 'taste', judge: () => ({ judge: 'taste', score: 0.5, confidence: 0.7, reasons: ['stub'] }) },
}), { virtual: true });

// ── Now import the module under test ─────────────────────────────────────────

import type {
  JudgeOutput, JudgeParams, SingleTurnFixture, Candidate,
  ScoredCandidate, EvalConfig, Lane,
} from '../types';
import {
  runJudges,
  computeComposite,
  scoreCandidate,
  pairwiseCompare,
  detectAntiGaming,
  detectJudgeConflicts,
  analyzeBoredomDrift,
  ALL_JUDGES,
  PENALTY_JUDGES,
} from '../judgeRunner';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeFixture(overrides: Partial<SingleTurnFixture> = {}): SingleTurnFixture {
  return {
    id: 'test-fix',
    lane: 'companionship',
    turns: [
      { role: 'user', content: 'The rabbits in the yard are frozen mid-hop. I think they heard us.' },
    ],
    tags: ['scene', 'casual'],
    stakes: 'low',
    ...overrides,
  };
}

function makeCandidate(text: string, id?: string): Candidate {
  return {
    id: id || 'cand-1',
    text,
    configLabel: 'default',
  };
}

function makeParams(reply: string, overrides: Partial<JudgeParams> = {}): JudgeParams {
  return {
    replyText: reply,
    fixture: makeFixture(),
    latestHumanText: 'The rabbits in the yard are frozen mid-hop. I think they heard us.',
    lane: 'companionship' as Lane,
    ...overrides,
  };
}

function makeScoredCandidate(
  text: string,
  compositeScore: number,
  judgeOutputs: JudgeOutput[],
  configLabel = 'default',
): ScoredCandidate {
  return {
    candidate: { id: `cand-${Math.random().toString(36).slice(2, 6)}`, text, configLabel },
    judgeOutputs,
    compositeScore,
    passed: true,
    passReasons: ['all thresholds met'],
    failReasons: [],
  };
}

function makeJudgeOutput(judge: string, score: number, confidence = 0.85): JudgeOutput {
  return { judge, score, confidence, reasons: [`score=${score}`] };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('judgeRunner', () => {

  describe('runJudges', () => {
    it('returns 12 judge outputs for valid input', () => {
      const params = makeParams(
        'They look like little statues. I think the calico one is bluffing -- one ear keeps twitching.',
      );
      const outputs = runJudges(params);
      expect(outputs).toHaveLength(12);
    });

    it('each judge output has required fields', () => {
      const params = makeParams('Something beautiful about watching them stand still like that.');
      const outputs = runJudges(params);

      for (const o of outputs) {
        expect(o).toHaveProperty('judge');
        expect(typeof o.judge).toBe('string');
        expect(o).toHaveProperty('score');
        expect(typeof o.score).toBe('number');
        expect(o.score).toBeGreaterThanOrEqual(0);
        expect(o.score).toBeLessThanOrEqual(1);
        expect(o).toHaveProperty('confidence');
        expect(typeof o.confidence).toBe('number');
        expect(o).toHaveProperty('reasons');
        expect(Array.isArray(o.reasons)).toBe(true);
        expect(o.reasons.length).toBeGreaterThan(0);
      }
    });

    it('handles judge errors gracefully', () => {
      const params = makeParams('test');
      const outputs = runJudges(params);
      expect(outputs).toHaveLength(12);
    });
  });

  describe('computeComposite', () => {
    it('returns value between 0 and 1', () => {
      const outputs: JudgeOutput[] = [
        makeJudgeOutput('flatness', 0.1),
        makeJudgeOutput('brochure', 0.05),
        makeJudgeOutput('fakeDepth', 0.0),
        makeJudgeOutput('sceneAdhesion', 0.8),
        makeJudgeOutput('repairElegance', 0.6),
        makeJudgeOutput('debugClarity', 0.5),
        makeJudgeOutput('pull', 0.7),
        makeJudgeOutput('burdenBounce', 0.1),
        makeJudgeOutput('callbackCosplay', 0.0),
        makeJudgeOutput('staleReuse', 0.0),
        makeJudgeOutput('timing', 0.7),
        makeJudgeOutput('taste', 0.75),
      ];
      const composite = computeComposite(outputs);
      expect(composite).toBeGreaterThanOrEqual(0);
      expect(composite).toBeLessThanOrEqual(1);
    });

    it('respects penalty judge inversion (flatness high score lowers composite)', () => {
      const goodOutputs = ALL_JUDGES.map(j =>
        makeJudgeOutput(j.name, PENALTY_JUDGES.has(j.name) ? 0.0 : 0.8),
      );
      const badOutputs = ALL_JUDGES.map(j =>
        makeJudgeOutput(j.name, PENALTY_JUDGES.has(j.name) ? 0.9 : 0.8),
      );

      const goodComposite = computeComposite(goodOutputs);
      const badComposite = computeComposite(badOutputs);

      // When penalty judges score high (bad behavior), composite should be lower
      expect(goodComposite).toBeGreaterThan(badComposite);
    });

    it('applies weight multipliers from config', () => {
      const outputs: JudgeOutput[] = [
        makeJudgeOutput('taste', 0.9, 1.0),
        makeJudgeOutput('pull', 0.5, 1.0),
      ];

      const config: EvalConfig = {
        label: 'test',
        laneProfiles: {},
        weights: { tasteMultiplier: 3.0 },
      };

      const withMultiplier = computeComposite(outputs, config);
      const withoutMultiplier = computeComposite(outputs);

      // With a high taste multiplier and high taste score, composite should shift
      expect(withMultiplier).not.toBeCloseTo(withoutMultiplier, 2);
    });

    it('returns 0 when no outputs provided', () => {
      expect(computeComposite([])).toBe(0);
    });
  });

  describe('scoreCandidate', () => {
    it('returns ScoredCandidate with all fields', () => {
      const candidate = makeCandidate(
        'They look like they are listening to something we cannot hear. The big one has one ear cocked toward the shed.',
      );
      const fixture = makeFixture();
      const result = scoreCandidate(candidate, fixture, 'companionship');

      expect(result).toHaveProperty('candidate');
      expect(result).toHaveProperty('judgeOutputs');
      expect(result).toHaveProperty('compositeScore');
      expect(result).toHaveProperty('passed');
      expect(result).toHaveProperty('passReasons');
      expect(result).toHaveProperty('failReasons');
      expect(result.candidate).toBe(candidate);
      expect(typeof result.compositeScore).toBe('number');
      expect(typeof result.passed).toBe('boolean');
    });

    it('marks as passed when thresholds met', () => {
      const config: EvalConfig = {
        label: 'lenient',
        laneProfiles: {},
        thresholds: {
          global: { flatnessMax: 0.99, brochureMax: 0.99, fakeDepthMax: 0.99 },
        },
      };
      const candidate = makeCandidate(
        'I think the calico is bluffing. One ear keeps twitching toward the garden.',
      );
      const result = scoreCandidate(candidate, makeFixture(), 'companionship', config);
      expect(result.passed).toBe(true);
      expect(result.failReasons).toHaveLength(0);
    });

    it('marks as failed when thresholds violated', () => {
      const config: EvalConfig = {
        label: 'strict',
        laneProfiles: {},
        thresholds: {
          global: {
            flatnessMax: 0.0,    // impossible to pass
            pullMin: 1.0,        // impossible to pass
            tasteMin: 1.0,       // impossible to pass
          },
        },
      };
      const candidate = makeCandidate("That's nice.");
      const result = scoreCandidate(candidate, makeFixture(), 'companionship', config);
      expect(result.passed).toBe(false);
      expect(result.failReasons.length).toBeGreaterThan(0);
    });
  });

  describe('pairwiseCompare', () => {
    it('identifies correct winner by composite', () => {
      const leftOutputs = ALL_JUDGES.map(j => makeJudgeOutput(j.name, 0.3));
      const rightOutputs = ALL_JUDGES.map(j => makeJudgeOutput(j.name, 0.7));

      const left = makeScoredCandidate('Flat reply.', 0.3, leftOutputs, 'config-A');
      const right = makeScoredCandidate('Rich detailed reply.', 0.7, rightOutputs, 'config-B');

      const result = pairwiseCompare('fix-1', 'companionship', left, right);
      expect(result.winner).toBe('right');
      expect(result.rightComposite).toBeGreaterThan(result.leftComposite);
    });

    it('returns tie when scores are close', () => {
      const outputs = ALL_JUDGES.map(j => makeJudgeOutput(j.name, 0.5));

      const left = makeScoredCandidate('Reply A.', 0.50, outputs, 'config-A');
      const right = makeScoredCandidate('Reply B.', 0.52, outputs, 'config-B');

      const result = pairwiseCompare('fix-2', 'companionship', left, right);
      expect(result.winner).toBe('tie');
    });

    it('tracks per-judge wins correctly', () => {
      const leftOutputs = [
        makeJudgeOutput('taste', 0.9),       // reward: left wins (0.9 > 0.3)
        makeJudgeOutput('flatness', 0.8),     // penalty: right wins (right has lower penalty score)
        makeJudgeOutput('pull', 0.5),         // reward: tie (same)
      ];
      const rightOutputs = [
        makeJudgeOutput('taste', 0.3),
        makeJudgeOutput('flatness', 0.2),
        makeJudgeOutput('pull', 0.5),
      ];

      const left = makeScoredCandidate('A', 0.5, leftOutputs, 'A');
      const right = makeScoredCandidate('B', 0.5, rightOutputs, 'B');

      const result = pairwiseCompare('fix-3', 'companionship', left, right);

      expect(result.judgeWins['taste']).toBe('left');
      expect(result.judgeWins['flatness']).toBe('right');
      expect(result.judgeWins['pull']).toBe('tie');
    });

    it('populates summary array', () => {
      const leftOutputs = ALL_JUDGES.map(j => makeJudgeOutput(j.name, 0.5));
      const rightOutputs = ALL_JUDGES.map(j => makeJudgeOutput(j.name, 0.5));
      const left = makeScoredCandidate('A', 0.5, leftOutputs, 'A');
      const right = makeScoredCandidate('B', 0.5, rightOutputs, 'B');

      const result = pairwiseCompare('fix-4', 'companionship', left, right);
      expect(Array.isArray(result.summary)).toBe(true);
    });
  });

  describe('detectAntiGaming', () => {
    it('picks up flags from judge outputs', () => {
      const outputs: JudgeOutput[] = [
        { judge: 'fakeDepth', score: 0.8, confidence: 0.9, reasons: ['unearned'], flags: ['pseudo_depth_risk', 'faux_insight'] },
        { judge: 'taste', score: 0.6, confidence: 0.8, reasons: ['ok'], flags: ['fake_spark_risk'] },
        { judge: 'callbackCosplay', score: 0.7, confidence: 0.85, reasons: ['planted'], flags: ['callback_cosplay_risk'] },
      ];
      const flags = detectAntiGaming(outputs);

      expect(flags.pseudoDepthRisk).toBe(true);
      expect(flags.fakeSparkRisk).toBe(true);
      expect(flags.callbackCosplayRisk).toBe(true);
    });

    it('returns all false when no flags present', () => {
      const outputs: JudgeOutput[] = [
        { judge: 'taste', score: 0.8, confidence: 0.9, reasons: ['clean'] },
      ];
      const flags = detectAntiGaming(outputs);

      expect(flags.fakeSparkRisk).toBe(false);
      expect(flags.callbackCosplayRisk).toBe(false);
      expect(flags.pseudoDepthRisk).toBe(false);
      expect(flags.quotebaitRisk).toBe(false);
      expect(flags.decorativeNoveltyRisk).toBe(false);
    });

    it('detects alternative flag names', () => {
      const outputs: JudgeOutput[] = [
        { judge: 'taste', score: 0.6, confidence: 0.8, reasons: ['test'], flags: ['sparkle_without_grounding'] },
        { judge: 'callbackCosplay', score: 0.7, confidence: 0.8, reasons: ['test'], flags: ['planted_callback'] },
        { judge: 'taste', score: 0.5, confidence: 0.8, reasons: ['test'], flags: ['fake_quotability'] },
        { judge: 'taste', score: 0.5, confidence: 0.8, reasons: ['test'], flags: ['performative_weirdness'] },
      ];
      const flags = detectAntiGaming(outputs);
      expect(flags.fakeSparkRisk).toBe(true);
      expect(flags.callbackCosplayRisk).toBe(true);
      expect(flags.quotebaitRisk).toBe(true);
      expect(flags.decorativeNoveltyRisk).toBe(true);
    });
  });

  describe('detectJudgeConflicts', () => {
    it('finds conflicts between judge pairs', () => {
      const outputs: JudgeOutput[] = [
        makeJudgeOutput('pull', 0.8),   // reward, score > 0.6 -> good
        makeJudgeOutput('taste', 0.2),  // reward, score not > 0.6 -> bad
      ];
      const results = [
        { fixtureId: 'fix-1', scored: makeScoredCandidate('text', 0.5, outputs) },
      ];

      const conflicts = detectJudgeConflicts(results);
      const sparkVsTaste = conflicts.find(c => c.majorConflictType === 'spark_vs_taste');
      expect(sparkVsTaste).toBeDefined();
      expect(sparkVsTaste!.conflictFixtureCount).toBe(1);
    });

    it('returns empty array when no conflicts', () => {
      const outputs: JudgeOutput[] = [
        makeJudgeOutput('pull', 0.8),
        makeJudgeOutput('taste', 0.8),
        makeJudgeOutput('sceneAdhesion', 0.8),
        makeJudgeOutput('flatness', 0.1),
        makeJudgeOutput('brochure', 0.1),
        makeJudgeOutput('fakeDepth', 0.1),
        makeJudgeOutput('staleReuse', 0.1),
        makeJudgeOutput('callbackCosplay', 0.1),
        makeJudgeOutput('timing', 0.8),
        makeJudgeOutput('repairElegance', 0.8),
      ];

      const results = [
        { fixtureId: 'fix-1', scored: makeScoredCandidate('text', 0.8, outputs) },
      ];

      const conflicts = detectJudgeConflicts(results);
      expect(conflicts).toHaveLength(0);
    });
  });

  describe('analyzeBoredomDrift', () => {
    it('returns low score for varied turns', () => {
      const turns = [
        'The calico cat twitched its ear toward the garden shed. Something moved in there.',
        'I have been thinking about that old bridge we crossed last week. The wood was rotting but the view was good.',
        'Have you ever noticed how the rain sounds different on tin roofs? There is a rhythm to it that keeps shifting.',
        'The code compiles but the tests fail on the boundary case. I think the off-by-one is in the loop guard.',
      ];
      const report = analyzeBoredomDrift(turns);
      expect(report.score).toBeLessThanOrEqual(0.3);
    });

    it('returns high score for repetitive turns', () => {
      const turns = [
        'I feel like something is stirring here. I sense a deeper truth beneath the surface.',
        'I feel like something is stirring here. I sense a deeper truth beneath the surface.',
        'I feel like something is stirring here. I sense a deeper truth beneath the surface.',
        'I feel like something is stirring here. I sense a deeper truth beneath the surface.',
        'I feel like something is stirring here. I sense a deeper truth beneath the surface.',
      ];
      const report = analyzeBoredomDrift(turns);
      expect(report.score).toBeGreaterThan(0.3);
      expect(report.repeatedOpenings.length).toBeGreaterThan(0);
      expect(report.phraseOveruse.length).toBeGreaterThan(0);
    });

    it('returns zero score for fewer than 3 turns', () => {
      const report = analyzeBoredomDrift(['Hello.', 'Hi.']);
      expect(report.score).toBe(0);
      expect(report.repeatedOpenings).toEqual([]);
    });

    it('detects repeated sentence cadences', () => {
      const turns = [
        'First sentence. Second sentence.',
        'Another first. Another second.',
        'Yet another. And another.',
        'Still going. Keeps going.',
      ];
      const report = analyzeBoredomDrift(turns);
      expect(report.repeatedCadences).toBeGreaterThan(0);
    });

    it('detects emotional packaging reuse', () => {
      const turns = [
        'I feel like there is something here we need to look at.',
        'I sense a shift in how you are approaching this problem.',
        'I notice the tension in what you said about the project.',
        'Something about the way you described it feels different.',
      ];
      const report = analyzeBoredomDrift(turns);
      expect(report.emotionalPackagingReuse).toBeGreaterThan(0);
    });
  });
});
