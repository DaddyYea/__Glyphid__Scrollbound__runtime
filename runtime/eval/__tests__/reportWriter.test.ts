/**
 * Tests for reportWriter.ts — aggregation, file writing, console summary.
 *
 * reportWriter imports detectJudgeConflicts from judgeRunner, which imports
 * 12 judge modules. Mock the 8 missing ones so the module graph resolves.
 */

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

import { existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import type {
  FixtureResult, ScoredCandidate, JudgeOutput,
  BoredomDriftReport, Lane,
} from '../types';
import { aggregateReport, writeReport, printSummary } from '../reportWriter';

// ── Helpers ──────────────────────────────────────────────────────────────────

const TMP_DIR = join(__dirname, '__tmp_report_test__');

function makeJudgeOutput(judge: string, score: number, confidence = 0.85): JudgeOutput {
  return { judge, score, confidence, reasons: [`score=${score}`] };
}

function makeScoredCandidate(
  compositeScore: number,
  judgeOverrides: Array<[string, number]> = [],
): ScoredCandidate {
  const defaultJudges: Array<[string, number]> = [
    ['flatness', 0.1],
    ['brochure', 0.05],
    ['fakeDepth', 0.0],
    ['sceneAdhesion', 0.7],
    ['repairElegance', 0.5],
    ['debugClarity', 0.6],
    ['pull', 0.7],
    ['burdenBounce', 0.1],
    ['callbackCosplay', 0.0],
    ['staleReuse', 0.05],
    ['timing', 0.6],
    ['taste', 0.7],
  ];

  const judgeMap = new Map(defaultJudges);
  for (const [j, s] of judgeOverrides) judgeMap.set(j, s);

  const judgeOutputs = [...judgeMap.entries()].map(([j, s]) => makeJudgeOutput(j, s));

  return {
    candidate: { id: `cand-${Math.random().toString(36).slice(2, 6)}`, text: 'Test reply.', configLabel: 'default' },
    judgeOutputs,
    compositeScore,
    passed: compositeScore > 0.5,
    passReasons: compositeScore > 0.5 ? ['all thresholds met'] : [],
    failReasons: compositeScore <= 0.5 ? ['below threshold'] : [],
  };
}

function makeFixtureResult(
  fixtureId: string,
  lane: Lane,
  compositeScore: number,
  passed?: boolean,
  judgeOverrides: Array<[string, number]> = [],
): FixtureResult {
  const best = makeScoredCandidate(compositeScore, judgeOverrides);
  if (passed !== undefined) {
    best.passed = passed;
    best.passReasons = passed ? ['all thresholds met'] : [];
    best.failReasons = passed ? [] : ['threshold violated'];
  }
  return {
    fixtureId,
    lane,
    candidateResults: [best],
    bestCandidate: best,
    passed: best.passed,
    passReasons: best.passReasons,
    failReasons: best.failReasons,
  };
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

afterAll(() => {
  if (existsSync(TMP_DIR)) {
    rmSync(TMP_DIR, { recursive: true, force: true });
  }
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('reportWriter', () => {

  describe('aggregateReport', () => {
    it('produces valid EvalReport structure', () => {
      const results: FixtureResult[] = [
        makeFixtureResult('fix-1', 'companionship', 0.75, true),
      ];

      const report = aggregateReport(results, 'test-config', 'golden');

      expect(report).toHaveProperty('runId');
      expect(report).toHaveProperty('configLabel', 'test-config');
      expect(report).toHaveProperty('suite', 'golden');
      expect(report).toHaveProperty('timestamp');
      expect(report).toHaveProperty('totals');
      expect(report).toHaveProperty('laneMetrics');
      expect(report).toHaveProperty('judgeMetrics');
      expect(report).toHaveProperty('regressions');
      expect(report).toHaveProperty('improvements');
      expect(report).toHaveProperty('judgeConflicts');
      expect(report).toHaveProperty('boredomDrift');
      expect(report).toHaveProperty('worstCases');
      expect(report).toHaveProperty('bestCases');
    });

    it('calculates correct totals (passCount, failCount, passRate)', () => {
      const results: FixtureResult[] = [
        makeFixtureResult('fix-1', 'companionship', 0.8, true),
        makeFixtureResult('fix-2', 'companionship', 0.3, false),
        makeFixtureResult('fix-3', 'relational_check', 0.9, true),
        makeFixtureResult('fix-4', 'repair_response', 0.2, false),
      ];

      const report = aggregateReport(results, 'test', 'golden');

      expect(report.totals.fixtureCount).toBe(4);
      expect(report.totals.passCount).toBe(2);
      expect(report.totals.failCount).toBe(2);
      expect(report.totals.passRate).toBeCloseTo(0.5, 5);
    });

    it('groups lane metrics correctly', () => {
      const results: FixtureResult[] = [
        makeFixtureResult('fix-1', 'companionship', 0.8, true),
        makeFixtureResult('fix-2', 'companionship', 0.6, true),
        makeFixtureResult('fix-3', 'relational_check', 0.4, false),
      ];

      const report = aggregateReport(results, 'test', 'golden');

      const compMetrics = report.laneMetrics.find(lm => lm.lane === 'companionship');
      expect(compMetrics).toBeDefined();
      expect(compMetrics!.fixtureCount).toBe(2);
      expect(compMetrics!.passCount).toBe(2);
      expect(compMetrics!.passRate).toBeCloseTo(1.0, 5);

      const relMetrics = report.laneMetrics.find(lm => lm.lane === 'relational_check');
      expect(relMetrics).toBeDefined();
      expect(relMetrics!.fixtureCount).toBe(1);
      expect(relMetrics!.passCount).toBe(0);
      expect(relMetrics!.passRate).toBeCloseTo(0.0, 5);
    });

    it('computes judge metric averages', () => {
      const results: FixtureResult[] = [
        makeFixtureResult('fix-1', 'companionship', 0.7, true, [['taste', 0.8]]),
        makeFixtureResult('fix-2', 'companionship', 0.6, true, [['taste', 0.4]]),
      ];

      const report = aggregateReport(results, 'test', 'golden');

      expect(report.judgeMetrics['taste']).toBeDefined();
      expect(report.judgeMetrics['taste'].avg).toBeCloseTo(0.6, 5);
      expect(report.judgeMetrics['taste'].min).toBeCloseTo(0.4, 5);
      expect(report.judgeMetrics['taste'].max).toBeCloseTo(0.8, 5);
    });

    it('identifies regressions when baseline provided', () => {
      const current: FixtureResult[] = [
        makeFixtureResult('fix-1', 'companionship', 0.3, false),
      ];
      const baseline: FixtureResult[] = [
        makeFixtureResult('fix-1', 'companionship', 0.8, true),
      ];

      const report = aggregateReport(current, 'test', 'golden', null, baseline);
      expect(report.regressions.length).toBeGreaterThan(0);
      expect(report.regressions[0].fixtureId).toBe('fix-1');
      expect(report.regressions[0].delta).toBeLessThan(0);
    });

    it('identifies improvements when baseline provided', () => {
      const current: FixtureResult[] = [
        makeFixtureResult('fix-1', 'companionship', 0.9, true),
      ];
      const baseline: FixtureResult[] = [
        makeFixtureResult('fix-1', 'companionship', 0.3, false),
      ];

      const report = aggregateReport(current, 'test', 'golden', null, baseline);
      expect(report.improvements.length).toBeGreaterThan(0);
      expect(report.improvements[0].fixtureId).toBe('fix-1');
      expect(report.improvements[0].delta).toBeGreaterThan(0);
    });

    it('does not flag regressions/improvements when delta is small', () => {
      const current: FixtureResult[] = [
        makeFixtureResult('fix-1', 'companionship', 0.72, true),
      ];
      const baseline: FixtureResult[] = [
        makeFixtureResult('fix-1', 'companionship', 0.70, true),
      ];

      const report = aggregateReport(current, 'test', 'golden', null, baseline);
      expect(report.regressions).toHaveLength(0);
      expect(report.improvements).toHaveLength(0);
    });

    it('sorts worst/best cases', () => {
      const results: FixtureResult[] = [
        makeFixtureResult('fix-best', 'companionship', 0.95, true),
        makeFixtureResult('fix-mid', 'companionship', 0.50, true),
        makeFixtureResult('fix-worst', 'companionship', 0.10, false),
      ];

      const report = aggregateReport(results, 'test', 'golden');

      // worstCases is sorted ascending by composite
      expect(report.worstCases[0].fixtureId).toBe('fix-worst');
      // bestCases is sorted descending by composite
      expect(report.bestCases[0].fixtureId).toBe('fix-best');
    });

    it('handles empty results array', () => {
      const report = aggregateReport([], 'empty', 'golden');
      expect(report.totals.fixtureCount).toBe(0);
      expect(report.totals.passRate).toBe(0);
      expect(report.totals.avgComposite).toBe(0);
      expect(report.laneMetrics).toHaveLength(0);
    });

    it('includes boredom drift when provided', () => {
      const drift: BoredomDriftReport = {
        score: 0.45,
        repeatedOpenings: ['i feel like'],
        repeatedCadences: 3,
        repeatedMotifs: ['something about the'],
        phraseOveruse: [{ phrase: 'i feel like', count: 5 }],
        emotionalPackagingReuse: 0.6,
      };
      const report = aggregateReport(
        [makeFixtureResult('fix-1', 'companionship', 0.7, true)],
        'test', 'golden', drift,
      );
      expect(report.boredomDrift).toBe(drift);
    });
  });

  describe('writeReport', () => {
    it('creates file on disk', () => {
      const outputDir = join(TMP_DIR, 'write-test');
      const report = aggregateReport(
        [makeFixtureResult('fix-1', 'companionship', 0.7, true)],
        'test-config', 'golden',
      );

      const filepath = writeReport(report, outputDir);

      expect(existsSync(filepath)).toBe(true);

      const written = JSON.parse(readFileSync(filepath, 'utf-8'));
      expect(written.configLabel).toBe('test-config');
      expect(written.suite).toBe('golden');
      expect(written.totals.fixtureCount).toBe(1);
    });

    it('creates latest/summary.json', () => {
      const outputDir = join(TMP_DIR, 'write-latest-test');
      const report = aggregateReport(
        [makeFixtureResult('fix-1', 'companionship', 0.7, true)],
        'latest-test', 'golden',
      );

      writeReport(report, outputDir);

      const latestPath = join(outputDir, 'latest', 'summary.json');
      expect(existsSync(latestPath)).toBe(true);
    });
  });

  describe('printSummary', () => {
    it('does not throw', () => {
      const report = aggregateReport(
        [
          makeFixtureResult('fix-1', 'companionship', 0.7, true),
          makeFixtureResult('fix-2', 'relational_check', 0.3, false),
        ],
        'test-config', 'golden',
      );

      expect(() => printSummary(report)).not.toThrow();
    });

    it('does not throw with baseline regressions and improvements', () => {
      const current: FixtureResult[] = [
        makeFixtureResult('fix-1', 'companionship', 0.9, true),
        makeFixtureResult('fix-2', 'companionship', 0.2, false),
      ];
      const baseline: FixtureResult[] = [
        makeFixtureResult('fix-1', 'companionship', 0.3, false),
        makeFixtureResult('fix-2', 'companionship', 0.8, true),
      ];

      const report = aggregateReport(current, 'test', 'golden', null, baseline);
      expect(() => printSummary(report)).not.toThrow();
    });

    it('does not throw with boredom drift report', () => {
      const drift: BoredomDriftReport = {
        score: 0.55,
        repeatedOpenings: ['i feel like'],
        repeatedCadences: 4,
        repeatedMotifs: ['something about'],
        phraseOveruse: [{ phrase: 'i feel', count: 6 }],
        emotionalPackagingReuse: 0.7,
      };
      const report = aggregateReport(
        [makeFixtureResult('fix-1', 'companionship', 0.6, true)],
        'test', 'golden', drift,
      );
      expect(() => printSummary(report)).not.toThrow();
    });
  });
});
