// runtime/eval/reportWriter.ts
// Aggregates fixture results into structured reports

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import type {
  EvalReport, FixtureResult, LaneMetrics, Lane,
  BoredomDriftReport, PairwiseComparison, RerankerExportRow,
} from './types';
import { detectJudgeConflicts } from './judgeRunner';

export function aggregateReport(
  results: FixtureResult[],
  configLabel: string,
  suite: string,
  boredomDrift?: BoredomDriftReport | null,
  baselineResults?: FixtureResult[],
): EvalReport {
  const runId = `eval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Totals
  const fixtureCount = results.length;
  const passCount = results.filter(r => r.passed).length;
  const failCount = fixtureCount - passCount;
  const passRate = fixtureCount > 0 ? passCount / fixtureCount : 0;
  const avgComposite = fixtureCount > 0
    ? results.reduce((s, r) => s + (r.bestCandidate?.compositeScore ?? 0), 0) / fixtureCount
    : 0;

  // Lane metrics
  const laneGroups = new Map<Lane, FixtureResult[]>();
  for (const r of results) {
    const arr = laneGroups.get(r.lane) || [];
    arr.push(r);
    laneGroups.set(r.lane, arr);
  }
  const laneMetrics: LaneMetrics[] = [...laneGroups.entries()].map(([lane, laneResults]) => {
    const lPass = laneResults.filter(r => r.passed).length;
    const avgByJudge: Record<string, number> = {};
    const judgeTotals = new Map<string, { sum: number; count: number }>();

    for (const r of laneResults) {
      if (!r.bestCandidate) continue;
      for (const j of r.bestCandidate.judgeOutputs) {
        const entry = judgeTotals.get(j.judge) || { sum: 0, count: 0 };
        entry.sum += j.score;
        entry.count++;
        judgeTotals.set(j.judge, entry);
      }
    }
    for (const [judge, { sum, count }] of judgeTotals) {
      avgByJudge[judge] = count > 0 ? sum / count : 0;
    }

    return {
      lane,
      fixtureCount: laneResults.length,
      passCount: lPass,
      failCount: laneResults.length - lPass,
      passRate: laneResults.length > 0 ? lPass / laneResults.length : 0,
      avgComposite: laneResults.length > 0
        ? laneResults.reduce((s, r) => s + (r.bestCandidate?.compositeScore ?? 0), 0) / laneResults.length
        : 0,
      avgByJudge,
    };
  });

  // Judge metrics (global)
  const judgeMetrics: EvalReport['judgeMetrics'] = {};
  const judgeScores = new Map<string, number[]>();
  for (const r of results) {
    if (!r.bestCandidate) continue;
    for (const j of r.bestCandidate.judgeOutputs) {
      const arr = judgeScores.get(j.judge) || [];
      arr.push(j.score);
      judgeScores.set(j.judge, arr);
    }
  }
  for (const [judge, scores] of judgeScores) {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const variance = scores.reduce((s, x) => s + (x - avg) ** 2, 0) / scores.length;
    judgeMetrics[judge] = { avg, min, max, stddev: Math.sqrt(variance) };
  }

  // Regressions & improvements (vs baseline)
  const regressions: EvalReport['regressions'] = [];
  const improvements: EvalReport['improvements'] = [];
  if (baselineResults) {
    const baselineMap = new Map(baselineResults.map(r => [r.fixtureId, r]));
    for (const r of results) {
      const base = baselineMap.get(r.fixtureId);
      if (!base) continue;
      const delta = (r.bestCandidate?.compositeScore ?? 0) - (base.bestCandidate?.compositeScore ?? 0);
      if (delta < -0.05) {
        regressions.push({
          fixtureId: r.fixtureId, lane: r.lane, delta,
          reason: r.failReasons.join('; ') || `composite dropped by ${Math.abs(delta).toFixed(3)}`,
        });
      } else if (delta > 0.05) {
        improvements.push({
          fixtureId: r.fixtureId, lane: r.lane, delta,
          reason: r.passReasons.join('; ') || `composite improved by ${delta.toFixed(3)}`,
        });
      }
    }
    regressions.sort((a, b) => a.delta - b.delta);
    improvements.sort((a, b) => b.delta - a.delta);
  }

  // Judge conflicts
  const conflictInput = results
    .filter(r => r.bestCandidate)
    .map(r => ({ fixtureId: r.fixtureId, scored: r.bestCandidate! }));
  const judgeConflicts = detectJudgeConflicts(conflictInput);

  // Worst / best cases
  const sorted = [...results].sort((a, b) =>
    (a.bestCandidate?.compositeScore ?? 0) - (b.bestCandidate?.compositeScore ?? 0)
  );
  const worstCases = sorted.slice(0, 10);
  const bestCases = sorted.slice(-10).reverse();

  return {
    runId,
    configLabel,
    suite,
    timestamp: new Date().toISOString(),
    totals: { fixtureCount, passCount, failCount, passRate, avgComposite },
    laneMetrics,
    judgeMetrics,
    regressions: regressions.slice(0, 10),
    improvements: improvements.slice(0, 10),
    judgeConflicts,
    boredomDrift: boredomDrift ?? null,
    worstCases,
    bestCases,
  };
}

// ── Report writing ─────────────────────────────────────────────────────────

export function writeReport(report: EvalReport, outputDir: string): string {
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const filename = `${report.suite}-${report.configLabel}-${report.runId}.json`;
  const filepath = join(outputDir, filename);
  writeFileSync(filepath, JSON.stringify(report, null, 2), 'utf-8');

  // Also write as latest
  const latestDir = join(outputDir, 'latest');
  if (!existsSync(latestDir)) mkdirSync(latestDir, { recursive: true });
  writeFileSync(join(latestDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf-8');

  return filepath;
}

// ── Console summary ────────────────────────────────────────────────────────

export function printSummary(report: EvalReport): void {
  const { totals, laneMetrics, judgeMetrics, regressions, improvements, judgeConflicts, worstCases } = report;

  console.log('\n' + '='.repeat(70));
  console.log(`  EVAL REPORT: ${report.configLabel} / ${report.suite}`);
  console.log(`  Run: ${report.runId}`);
  console.log('='.repeat(70));

  console.log(`\n  Total: ${totals.fixtureCount} fixtures | Pass: ${totals.passCount} | Fail: ${totals.failCount} | Rate: ${(totals.passRate * 100).toFixed(1)}%`);
  console.log(`  Avg composite: ${totals.avgComposite.toFixed(3)}`);

  console.log('\n  ── Lane Breakdown ──');
  for (const lm of laneMetrics) {
    console.log(`    ${lm.lane.padEnd(24)} ${lm.passCount}/${lm.fixtureCount} pass (${(lm.passRate * 100).toFixed(0)}%) avg=${lm.avgComposite.toFixed(3)}`);
  }

  console.log('\n  ── Judge Averages ──');
  for (const [judge, stats] of Object.entries(judgeMetrics)) {
    console.log(`    ${judge.padEnd(20)} avg=${stats.avg.toFixed(3)} min=${stats.min.toFixed(3)} max=${stats.max.toFixed(3)} σ=${stats.stddev.toFixed(3)}`);
  }

  if (regressions.length > 0) {
    console.log(`\n  ── Top Regressions (${regressions.length}) ──`);
    for (const r of regressions.slice(0, 5)) {
      console.log(`    ${r.fixtureId} [${r.lane}] Δ=${r.delta.toFixed(3)} — ${r.reason}`);
    }
  }

  if (improvements.length > 0) {
    console.log(`\n  ── Top Improvements (${improvements.length}) ──`);
    for (const i of improvements.slice(0, 5)) {
      console.log(`    ${i.fixtureId} [${i.lane}] Δ=+${i.delta.toFixed(3)} — ${i.reason}`);
    }
  }

  if (judgeConflicts.length > 0) {
    console.log(`\n  ── Judge Conflicts (${judgeConflicts.length}) ──`);
    for (const c of judgeConflicts) {
      console.log(`    ${c.majorConflictType}: ${c.involvedJudges.join(' vs ')} — ${c.conflictFixtureCount} fixtures`);
    }
  }

  if (worstCases.length > 0) {
    console.log('\n  ── Worst Cases ──');
    for (const w of worstCases.slice(0, 5)) {
      const score = w.bestCandidate?.compositeScore?.toFixed(3) ?? 'n/a';
      console.log(`    ${w.fixtureId} [${w.lane}] composite=${score} — ${w.failReasons.slice(0, 2).join('; ')}`);
    }
  }

  if (report.boredomDrift && report.boredomDrift.score > 0.1) {
    console.log(`\n  ── Boredom Drift: ${report.boredomDrift.score.toFixed(3)} ──`);
    if (report.boredomDrift.repeatedOpenings.length > 0) {
      console.log(`    Repeated openings: ${report.boredomDrift.repeatedOpenings.slice(0, 3).join(' | ')}`);
    }
  }

  console.log('\n' + '='.repeat(70) + '\n');
}

// ── Pairwise report ────────────────────────────────────────────────────────

export function printPairwiseSummary(comparisons: PairwiseComparison[]): void {
  const leftWins = comparisons.filter(c => c.winner === 'left').length;
  const rightWins = comparisons.filter(c => c.winner === 'right').length;
  const ties = comparisons.filter(c => c.winner === 'tie').length;
  const leftLabel = comparisons[0]?.leftLabel || 'left';
  const rightLabel = comparisons[0]?.rightLabel || 'right';

  console.log('\n' + '='.repeat(70));
  console.log(`  PAIRWISE: ${leftLabel} vs ${rightLabel}`);
  console.log('='.repeat(70));
  console.log(`  ${leftLabel}: ${leftWins} wins | ${rightLabel}: ${rightWins} wins | Ties: ${ties}`);

  // Per-judge wins
  const judgeWinCounts = new Map<string, { left: number; right: number; tie: number }>();
  for (const c of comparisons) {
    for (const [judge, winner] of Object.entries(c.judgeWins)) {
      const entry = judgeWinCounts.get(judge) || { left: 0, right: 0, tie: 0 };
      entry[winner]++;
      judgeWinCounts.set(judge, entry);
    }
  }

  console.log('\n  ── Per-Judge Wins ──');
  for (const [judge, counts] of judgeWinCounts) {
    console.log(`    ${judge.padEnd(20)} ${leftLabel}=${counts.left} ${rightLabel}=${counts.right} tie=${counts.tie}`);
  }

  console.log('\n' + '='.repeat(70) + '\n');
}

// ── Reranker export ────────────────────────────────────────────────────────

export function exportRerankerData(
  results: FixtureResult[],
  outputPath: string,
): void {
  const rows: RerankerExportRow[] = [];

  for (const r of results) {
    const bestId = r.bestCandidate?.candidate.id;
    for (const scored of r.candidateResults) {
      const judgeMap: Record<string, number> = {};
      for (const j of scored.judgeOutputs) judgeMap[j.judge] = j.score;

      rows.push({
        fixtureId: r.fixtureId,
        lane: r.lane,
        phaseSummary: '',
        sceneSummary: '',
        candidateText: scored.candidate.text,
        compositeScore: scored.compositeScore,
        judgeOutputs: judgeMap,
        winnerLabel: scored.candidate.id === bestId,
        engagementLabels: r.engagementEvents?.map(e => e.type),
      });
    }
  }

  const lines = rows.map(r => JSON.stringify(r));
  writeFileSync(outputPath, lines.join('\n'), 'utf-8');
}
