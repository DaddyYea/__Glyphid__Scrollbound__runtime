// runtime/eval/scripts/runAblation.ts
// Ablation runner — disables one subsystem at a time and measures impact
//
// Usage:
//   npx tsx runtime/eval/scripts/runAblation.ts --base configs/star_tuned.json --suite golden [--mock] [--verbose]

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type {
  EvalConfig, SingleTurnFixture, Candidate, Lane,
  FixtureResult,
} from '../types';
import { loadGoldenFixtures } from '../fixtureLoader';
import { scoreCandidate, detectAntiGaming } from '../judgeRunner';

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

// ── Ablation definitions ──────────────────────────────────────────────────

interface AblationDef {
  key: string;
  flag: keyof NonNullable<EvalConfig['ablations']>;
  label: string;
}

const ABLATIONS: AblationDef[] = [
  { key: 'sparkLayerOff',           flag: 'sparkLayerOff',           label: 'spark layer off' },
  { key: 'substrateLayerOff',       flag: 'substrateLayerOff',       label: 'substrate layer off' },
  { key: 'braidedPhaseOff',         flag: 'braidedPhaseOff',         label: 'braided phase off' },
  { key: 'sceneLedgerOff',          flag: 'sceneLedgerOff',          label: 'scene ledger off' },
  { key: 'returnShapeMemoryOff',    flag: 'returnShapeMemoryOff',    label: 'return shape memory off' },
  { key: 'tasteRerankOff',          flag: 'tasteRerankOff',          label: 'taste rerank off' },
  { key: 'subtextRestraintOff',     flag: 'subtextRestraintOff',     label: 'subtext restraint off' },
  { key: 'rhythmPenaltyOff',        flag: 'rhythmPenaltyOff',        label: 'rhythm penalty off' },
  { key: 'callbackRelevanceOff',    flag: 'callbackRelevanceOff',    label: 'callback relevance off' },
  { key: 'repairEleganceOff',       flag: 'repairEleganceOff',       label: 'repair elegance off' },
  { key: 'simpleLinePrivilegeOff',  flag: 'simpleLinePrivilegeOff',  label: 'simple line privilege off' },
];

// ── Run eval for a single config ──────────────────────────────────────────

function runEvalForConfig(
  fixtures: SingleTurnFixture[],
  config: EvalConfig,
  verbose: boolean,
): FixtureResult[] {
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

// ── Delta computation ─────────────────────────────────────────────────────

interface AblationDelta {
  ablationKey: string;
  ablationLabel: string;
  globalPassRateDelta: number;
  globalCompositeDelta: number;
  perLane: Array<{ lane: Lane; passRateDelta: number; compositeDelta: number }>;
  topHarmed: Array<{ fixtureId: string; lane: Lane; delta: number }>;
  topImproved: Array<{ fixtureId: string; lane: Lane; delta: number }>;
}

function computeDeltas(baseResults: FixtureResult[], ablationResults: FixtureResult[], ablation: AblationDef): AblationDelta {
  const baseMap = new Map(baseResults.map(r => [r.fixtureId, r]));

  // Global
  const basePassRate = baseResults.length > 0 ? baseResults.filter(r => r.passed).length / baseResults.length : 0;
  const ablPassRate = ablationResults.length > 0 ? ablationResults.filter(r => r.passed).length / ablationResults.length : 0;
  const baseAvg = baseResults.length > 0 ? baseResults.reduce((s, r) => s + (r.bestCandidate?.compositeScore ?? 0), 0) / baseResults.length : 0;
  const ablAvg = ablationResults.length > 0 ? ablationResults.reduce((s, r) => s + (r.bestCandidate?.compositeScore ?? 0), 0) / ablationResults.length : 0;

  // Per-lane
  const laneGroups = new Map<Lane, { base: FixtureResult[]; abl: FixtureResult[] }>();
  for (const r of baseResults) {
    const entry = laneGroups.get(r.lane) || { base: [], abl: [] };
    entry.base.push(r);
    laneGroups.set(r.lane, entry);
  }
  for (const r of ablationResults) {
    const entry = laneGroups.get(r.lane) || { base: [], abl: [] };
    entry.abl.push(r);
    laneGroups.set(r.lane, entry);
  }

  const perLane = [...laneGroups.entries()].map(([lane, { base, abl }]) => {
    const bpr = base.length > 0 ? base.filter(r => r.passed).length / base.length : 0;
    const apr = abl.length > 0 ? abl.filter(r => r.passed).length / abl.length : 0;
    const bac = base.length > 0 ? base.reduce((s, r) => s + (r.bestCandidate?.compositeScore ?? 0), 0) / base.length : 0;
    const aac = abl.length > 0 ? abl.reduce((s, r) => s + (r.bestCandidate?.compositeScore ?? 0), 0) / abl.length : 0;
    return { lane, passRateDelta: apr - bpr, compositeDelta: aac - bac };
  });

  // Per-fixture deltas
  const fixtureDeltas: Array<{ fixtureId: string; lane: Lane; delta: number }> = [];
  for (const ablR of ablationResults) {
    const baseR = baseMap.get(ablR.fixtureId);
    if (!baseR) continue;
    const delta = (ablR.bestCandidate?.compositeScore ?? 0) - (baseR.bestCandidate?.compositeScore ?? 0);
    fixtureDeltas.push({ fixtureId: ablR.fixtureId, lane: ablR.lane, delta });
  }
  fixtureDeltas.sort((a, b) => a.delta - b.delta);

  return {
    ablationKey: ablation.key,
    ablationLabel: ablation.label,
    globalPassRateDelta: ablPassRate - basePassRate,
    globalCompositeDelta: ablAvg - baseAvg,
    perLane,
    topHarmed: fixtureDeltas.filter(d => d.delta < -0.01).slice(0, 5),
    topImproved: fixtureDeltas.filter(d => d.delta > 0.01).slice(-5).reverse(),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);

  if (!args.base) {
    console.error('Usage: runAblation.ts --base <config> --suite <golden> [--mock] [--verbose]');
    process.exit(1);
  }

  const evalBaseDir = resolve(__dirname, '..');
  const baseConfigPath = resolve(process.cwd(), args.base);
  const suite = args.suite || 'golden';
  const verbose = args.verbose === 'true';

  if (!existsSync(baseConfigPath)) {
    console.error(`Base config not found: ${baseConfigPath}`);
    process.exit(1);
  }

  const baseConfig: EvalConfig = JSON.parse(readFileSync(baseConfigPath, 'utf-8'));
  console.log(`\nAblation study: base=${baseConfig.label} suite=${suite}`);

  const fixtures = loadGoldenFixtures(evalBaseDir);
  if (fixtures.length === 0) {
    console.log('  No fixtures found.');
    process.exit(0);
  }
  console.log(`  Loaded ${fixtures.length} fixtures`);

  // Run baseline
  console.log(`\n  Running baseline (${baseConfig.label})...`);
  const baseResults = runEvalForConfig(fixtures, baseConfig, false);
  const basePassRate = baseResults.filter(r => r.passed).length / baseResults.length;
  const baseAvg = baseResults.reduce((s, r) => s + (r.bestCandidate?.compositeScore ?? 0), 0) / baseResults.length;
  console.log(`    Baseline: pass=${(basePassRate * 100).toFixed(1)}% avg=${baseAvg.toFixed(3)}`);

  // Run each ablation
  const deltas: AblationDelta[] = [];
  for (const ablation of ABLATIONS) {
    const ablConfig: EvalConfig = JSON.parse(JSON.stringify(baseConfig));
    ablConfig.label = `${baseConfig.label}+${ablation.key}`;
    if (!ablConfig.ablations) ablConfig.ablations = {};
    (ablConfig.ablations as any)[ablation.flag] = true;

    if (verbose) console.log(`\n  Running ablation: ${ablation.label}...`);
    const ablResults = runEvalForConfig(fixtures, ablConfig, false);
    const delta = computeDeltas(baseResults, ablResults, ablation);
    deltas.push(delta);

    const sign = delta.globalCompositeDelta >= 0 ? '+' : '';
    console.log(`    ${ablation.label.padEnd(30)} passΔ=${(delta.globalPassRateDelta * 100).toFixed(1)}% compΔ=${sign}${delta.globalCompositeDelta.toFixed(4)}`);
  }

  // Print delta table
  console.log('\n' + '='.repeat(80));
  console.log('  ABLATION DELTA TABLE');
  console.log('='.repeat(80));
  console.log(`  ${'Ablation'.padEnd(30)} ${'PassΔ'.padEnd(10)} ${'CompΔ'.padEnd(10)} ${'Harmed'.padEnd(8)} ${'Improved'.padEnd(8)}`);
  console.log('-'.repeat(80));

  for (const d of deltas) {
    const sign = d.globalCompositeDelta >= 0 ? '+' : '';
    console.log(`  ${d.ablationLabel.padEnd(30)} ${(d.globalPassRateDelta * 100).toFixed(1).padStart(6)}%   ${sign}${d.globalCompositeDelta.toFixed(4).padStart(7)}   ${String(d.topHarmed.length).padStart(5)}    ${String(d.topImproved.length).padStart(5)}`);
  }

  // Per-lane breakdown for worst ablations
  const worstAblations = [...deltas].sort((a, b) => a.globalCompositeDelta - b.globalCompositeDelta).slice(0, 3);
  if (worstAblations.length > 0) {
    console.log('\n  ── Most Impactful Ablations (per-lane) ──');
    for (const d of worstAblations) {
      console.log(`\n  ${d.ablationLabel}:`);
      for (const lp of d.perLane) {
        if (Math.abs(lp.compositeDelta) > 0.001) {
          const sign = lp.compositeDelta >= 0 ? '+' : '';
          console.log(`    ${lp.lane.padEnd(24)} compΔ=${sign}${lp.compositeDelta.toFixed(4)}`);
        }
      }
      if (d.topHarmed.length > 0) {
        console.log(`    Top harmed: ${d.topHarmed.map(h => `${h.fixtureId}(${h.delta.toFixed(3)})`).join(', ')}`);
      }
    }
  }

  console.log('\n' + '='.repeat(80) + '\n');

  // Write ablation report
  const reportsDir = join(evalBaseDir, 'reports');
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
  const latestDir = join(reportsDir, 'latest');
  if (!existsSync(latestDir)) mkdirSync(latestDir, { recursive: true });

  const ablationReport = {
    type: 'ablation',
    baseConfig: baseConfig.label,
    suite,
    timestamp: new Date().toISOString(),
    baseline: {
      passRate: basePassRate,
      avgComposite: baseAvg,
    },
    deltas,
  };

  const reportPath = join(reportsDir, `ablation-${baseConfig.label}-${Date.now()}.json`);
  writeFileSync(reportPath, JSON.stringify(ablationReport, null, 2), 'utf-8');
  writeFileSync(join(latestDir, 'ablation.json'), JSON.stringify(ablationReport, null, 2), 'utf-8');
  console.log(`  Report written to: ${reportPath}`);
}

main().catch(err => {
  console.error('runAblation fatal error:', err);
  process.exit(1);
});
