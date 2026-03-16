// runtime/eval/scripts/runSweep.ts
// Weight sweep runner — tests multiple weight configurations and reports the best
//
// Usage:
//   npx tsx runtime/eval/scripts/runSweep.ts --sweep configs/sweeps/default.json --suite golden [--base configs/baseline.json] [--mock] [--verbose]

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type {
  EvalConfig, SweepConfig, SingleTurnFixture, Candidate, Lane,
  FixtureResult,
} from '../types';
import { loadGoldenFixtures } from '../fixtureLoader';
import { scoreCandidate, detectAntiGaming, detectJudgeConflicts } from '../judgeRunner';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Arg parsing ───────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--') && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    } else if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = 'true';
    }
  }
  return args;
}

// ── Mock candidate generator ──────────────────────────────────────────────

function generateMockCandidates(fixture: SingleTurnFixture, configLabel: string): Candidate[] {
  const userTurns = fixture.turns.filter(t => t.role === 'user');
  const latestHuman = userTurns[userTurns.length - 1]?.content || '';

  return [
    {
      id: `${fixture.id}-mock-a`,
      text: `I hear you. ${latestHuman.slice(0, 80)}... That makes sense to me.`,
      configLabel,
      generationMs: 0,
    },
    {
      id: `${fixture.id}-mock-b`,
      text: `There's something in what you're saying that catches me. ${latestHuman.slice(0, 60)}... I want to sit with that for a moment. It matters.`,
      configLabel,
      generationMs: 0,
    },
  ];
}

// ── Run eval for a single config ──────────────────────────────────────────

function runEvalForConfig(fixtures: SingleTurnFixture[], config: EvalConfig): FixtureResult[] {
  const results: FixtureResult[] = [];

  for (const fixture of fixtures) {
    const candidates = generateMockCandidates(fixture, config.label);
    const scored = candidates.map(c => scoreCandidate(c, fixture, fixture.lane, config));
    const sorted = [...scored].sort((a, b) => b.compositeScore - a.compositeScore);
    const best = sorted[0] || null;

    results.push({
      fixtureId: fixture.id,
      lane: fixture.lane,
      candidateResults: scored,
      bestCandidate: best,
      passed: best?.passed ?? false,
      passReasons: best?.passReasons ?? [],
      failReasons: best?.failReasons ?? [],
      antiGamingFlags: best ? detectAntiGaming(best.judgeOutputs) : undefined,
    });
  }

  return results;
}

// ── Variant result summary ────────────────────────────────────────────────

interface VariantSummary {
  index: number;
  weights: Record<string, number>;
  label: string;
  passRate: number;
  avgComposite: number;
  perLane: Record<string, { passRate: number; avgComposite: number }>;
  conflictCount: number;
}

function summarizeResults(results: FixtureResult[], weights: Record<string, number>, index: number): VariantSummary {
  const passRate = results.length > 0 ? results.filter(r => r.passed).length / results.length : 0;
  const avgComposite = results.length > 0
    ? results.reduce((s, r) => s + (r.bestCandidate?.compositeScore ?? 0), 0) / results.length
    : 0;

  // Per-lane
  const laneGroups = new Map<Lane, FixtureResult[]>();
  for (const r of results) {
    const arr = laneGroups.get(r.lane) || [];
    arr.push(r);
    laneGroups.set(r.lane, arr);
  }

  const perLane: Record<string, { passRate: number; avgComposite: number }> = {};
  for (const [lane, laneResults] of laneGroups) {
    const pr = laneResults.length > 0 ? laneResults.filter(r => r.passed).length / laneResults.length : 0;
    const ac = laneResults.length > 0
      ? laneResults.reduce((s, r) => s + (r.bestCandidate?.compositeScore ?? 0), 0) / laneResults.length
      : 0;
    perLane[lane] = { passRate: pr, avgComposite: ac };
  }

  // Judge conflicts
  const conflictInput = results
    .filter(r => r.bestCandidate)
    .map(r => ({ fixtureId: r.fixtureId, scored: r.bestCandidate! }));
  const conflicts = detectJudgeConflicts(conflictInput);

  const weightKeys = Object.keys(weights).sort();
  const label = weightKeys.map(k => `${k}=${weights[k]}`).join(',');

  return {
    index,
    weights,
    label,
    passRate,
    avgComposite,
    perLane,
    conflictCount: conflicts.reduce((s, c) => s + c.conflictFixtureCount, 0),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);

  if (!args.sweep) {
    console.error('Usage: runSweep.ts --sweep <sweep-config.json> [--suite golden] [--base configs/baseline.json] [--mock] [--verbose]');
    process.exit(1);
  }

  const evalBaseDir = resolve(__dirname, '..');
  const sweepPath = resolve(process.cwd(), args.sweep);
  const suite = args.suite || 'golden';
  const verbose = args.verbose === 'true';

  // Load optional base config (defaults to baseline.json)
  const baseConfigPath = args.base
    ? resolve(process.cwd(), args.base)
    : join(evalBaseDir, 'configs', 'baseline.json');

  if (!existsSync(sweepPath)) {
    console.error(`Sweep config not found: ${sweepPath}`);
    process.exit(1);
  }

  const sweepConfig: SweepConfig = JSON.parse(readFileSync(sweepPath, 'utf-8'));
  let baseConfig: EvalConfig;
  if (existsSync(baseConfigPath)) {
    baseConfig = JSON.parse(readFileSync(baseConfigPath, 'utf-8'));
  } else {
    baseConfig = {
      label: 'baseline',
      laneProfiles: {},
      weights: {},
      ablations: {},
      thresholds: {},
    };
  }

  console.log(`\nWeight sweep: ${sweepConfig.label} (${sweepConfig.variants.length} variants) suite=${suite}`);

  const fixtures = loadGoldenFixtures(evalBaseDir);
  if (fixtures.length === 0) {
    console.log('  No fixtures found.');
    process.exit(0);
  }
  console.log(`  Loaded ${fixtures.length} fixtures`);

  // Run each variant
  const summaries: VariantSummary[] = [];

  for (let i = 0; i < sweepConfig.variants.length; i++) {
    const weightOverrides = sweepConfig.variants[i];
    const variantConfig: EvalConfig = JSON.parse(JSON.stringify(baseConfig));
    variantConfig.label = `${baseConfig.label}-sweep-${i}`;
    if (!variantConfig.weights) variantConfig.weights = {};

    // Apply weight overrides
    for (const [key, value] of Object.entries(weightOverrides)) {
      (variantConfig.weights as any)[key] = value;
    }

    if (verbose) {
      const overrideStr = Object.entries(weightOverrides).map(([k, v]) => `${k}=${v}`).join(', ');
      console.log(`\n  Variant ${i}: ${overrideStr}`);
    }

    const results = runEvalForConfig(fixtures, variantConfig);
    const summary = summarizeResults(results, weightOverrides, i);
    summaries.push(summary);

    console.log(`    [${i}] pass=${(summary.passRate * 100).toFixed(1)}% avg=${summary.avgComposite.toFixed(3)} conflicts=${summary.conflictCount}`);
  }

  // Find best
  const bestGlobal = [...summaries].sort((a, b) => b.avgComposite - a.avgComposite)[0];
  const bestPassRate = [...summaries].sort((a, b) => b.passRate - a.passRate)[0];

  console.log('\n' + '='.repeat(80));
  console.log('  SWEEP RESULTS');
  console.log('='.repeat(80));
  console.log(`\n  Best global (by composite): variant ${bestGlobal.index} — ${bestGlobal.label}`);
  console.log(`    pass=${(bestGlobal.passRate * 100).toFixed(1)}% avg=${bestGlobal.avgComposite.toFixed(3)}`);
  console.log(`\n  Best global (by pass rate): variant ${bestPassRate.index} — ${bestPassRate.label}`);
  console.log(`    pass=${(bestPassRate.passRate * 100).toFixed(1)}% avg=${bestPassRate.avgComposite.toFixed(3)}`);

  // Per-lane best
  const allLanes = new Set<string>();
  for (const s of summaries) {
    for (const lane of Object.keys(s.perLane)) allLanes.add(lane);
  }

  if (allLanes.size > 0) {
    console.log('\n  ── Best Per-Lane ──');
    for (const lane of allLanes) {
      const laneSorted = [...summaries]
        .filter(s => s.perLane[lane])
        .sort((a, b) => (b.perLane[lane]?.avgComposite ?? 0) - (a.perLane[lane]?.avgComposite ?? 0));
      if (laneSorted.length > 0) {
        const best = laneSorted[0];
        console.log(`    ${lane.padEnd(24)} variant ${best.index} avg=${best.perLane[lane].avgComposite.toFixed(3)} pass=${(best.perLane[lane].passRate * 100).toFixed(1)}%`);
      }
    }
  }

  // Regressions (variants worse than baseline variant 0 on any lane)
  if (summaries.length > 1) {
    const baselineSummary = summaries.find(s =>
      Object.values(s.weights).every(v => v === 1.0)
    ) || summaries[0];

    const regressions: string[] = [];
    for (const s of summaries) {
      if (s.index === baselineSummary.index) continue;
      for (const [lane, metrics] of Object.entries(s.perLane)) {
        const baseLane = baselineSummary.perLane[lane];
        if (baseLane && metrics.avgComposite < baseLane.avgComposite - 0.01) {
          regressions.push(`variant ${s.index} regresses on ${lane}: ${metrics.avgComposite.toFixed(3)} vs ${baseLane.avgComposite.toFixed(3)}`);
        }
      }
    }

    if (regressions.length > 0) {
      console.log('\n  ── Regressions ──');
      for (const r of regressions.slice(0, 10)) console.log(`    ${r}`);
    }
  }

  // Judge conflict hotspots
  const highConflict = summaries.filter(s => s.conflictCount > 0).sort((a, b) => b.conflictCount - a.conflictCount);
  if (highConflict.length > 0) {
    console.log('\n  ── Judge Conflict Hotspots ──');
    for (const s of highConflict.slice(0, 5)) {
      console.log(`    variant ${s.index} (${s.label}): ${s.conflictCount} conflicts`);
    }
  }

  console.log('\n' + '='.repeat(80) + '\n');

  // Write sweep report
  const reportsDir = join(evalBaseDir, 'reports');
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
  const latestDir = join(reportsDir, 'latest');
  if (!existsSync(latestDir)) mkdirSync(latestDir, { recursive: true });

  const sweepReport = {
    type: 'sweep',
    sweepLabel: sweepConfig.label,
    baseConfig: baseConfig.label,
    suite,
    timestamp: new Date().toISOString(),
    variantCount: sweepConfig.variants.length,
    summaries,
    bestGlobal: { index: bestGlobal.index, weights: bestGlobal.weights },
    bestPassRate: { index: bestPassRate.index, weights: bestPassRate.weights },
  };

  const reportPath = join(reportsDir, `sweep-${sweepConfig.label}-${Date.now()}.json`);
  writeFileSync(reportPath, JSON.stringify(sweepReport, null, 2), 'utf-8');
  writeFileSync(join(latestDir, 'sweep.json'), JSON.stringify(sweepReport, null, 2), 'utf-8');
  console.log(`  Report written to: ${reportPath}`);
}

main().catch(err => {
  console.error('runSweep fatal error:', err);
  process.exit(1);
});
