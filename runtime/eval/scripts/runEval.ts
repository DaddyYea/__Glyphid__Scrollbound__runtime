// runtime/eval/scripts/runEval.ts
// Main golden corpus eval runner
//
// Usage:
//   npx tsx runtime/eval/scripts/runEval.ts --config configs/baseline.json --suite golden [--lane companionship] [--verbose] [--mock]
//   npx tsx runtime/eval/scripts/runEval.ts --config configs/baseline.json --suite golden --candidates ./candidates/ [--verbose]

import { readFileSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type {
  EvalConfig, SingleTurnFixture, Candidate,
  FixtureResult, Lane, ScoredCandidate,
} from '../types';
import { loadGoldenFixtures, loadNegativeExamples } from '../fixtureLoader';
import { scoreCandidate, detectAntiGaming } from '../judgeRunner';
import { aggregateReport, writeReport, printSummary } from '../reportWriter';

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

  const candidateA: Candidate = {
    id: `${fixture.id}-mock-a`,
    text: `I hear you. ${latestHuman.slice(0, 80)}... That makes sense to me.`,
    configLabel,
    generationMs: 0,
  };

  const candidateB: Candidate = {
    id: `${fixture.id}-mock-b`,
    text: `There's something in what you're saying that catches me. ${latestHuman.slice(0, 60)}... I want to sit with that for a moment. It matters.`,
    configLabel,
    generationMs: 0,
  };

  return [candidateA, candidateB];
}

// ── Candidate file loader ─────────────────────────────────────────────────

function loadCandidatesFromDir(dir: string, fixtureId: string, configLabel: string): Candidate[] | null {
  const candidates: Candidate[] = [];

  // Look for <fixtureId>.txt or <fixtureId>_a.txt / <fixtureId>_b.txt
  const singlePath = join(dir, `${fixtureId}.txt`);
  if (existsSync(singlePath)) {
    candidates.push({
      id: `${fixtureId}-file-a`,
      text: readFileSync(singlePath, 'utf-8').trim(),
      configLabel,
      generationMs: 0,
    });
    return candidates;
  }

  // Multiple candidate files
  for (const suffix of ['_a', '_b', '_c', '_d']) {
    const path = join(dir, `${fixtureId}${suffix}.txt`);
    if (existsSync(path)) {
      candidates.push({
        id: `${fixtureId}-file${suffix}`,
        text: readFileSync(path, 'utf-8').trim(),
        configLabel,
        generationMs: 0,
      });
    }
  }

  return candidates.length > 0 ? candidates : null;
}

// ── Core eval logic ───────────────────────────────────────────────────────

function evalFixture(
  fixture: SingleTurnFixture,
  candidates: Candidate[],
  config: EvalConfig,
  verbose: boolean,
): FixtureResult {
  const scoredCandidates: ScoredCandidate[] = candidates.map(c =>
    scoreCandidate(c, fixture, fixture.lane, config)
  );

  // Pick best by composite
  const sorted = [...scoredCandidates].sort((a, b) => b.compositeScore - a.compositeScore);
  const best = sorted[0] || null;

  const passed = best?.passed ?? false;
  const passReasons = best?.passReasons ?? [];
  const failReasons = best?.failReasons ?? [];
  const antiGamingFlags = best ? detectAntiGaming(best.judgeOutputs) : undefined;

  if (verbose) {
    const scoreStr = best?.compositeScore?.toFixed(3) ?? 'n/a';
    const status = passed ? 'PASS' : 'FAIL';
    console.log(`  [${status}] ${fixture.id} (${fixture.lane}) composite=${scoreStr}`);
    if (!passed && failReasons.length > 0) {
      console.log(`         reasons: ${failReasons.join('; ')}`);
    }
  }

  return {
    fixtureId: fixture.id,
    lane: fixture.lane,
    candidateResults: scoredCandidates,
    bestCandidate: best,
    passed,
    passReasons,
    failReasons,
    antiGamingFlags,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);

  if (!args.config) {
    console.error('Usage: runEval.ts --config <path> --suite <golden|negative> [--lane <lane>] [--candidates <dir>] [--mock] [--verbose]');
    process.exit(1);
  }

  const evalBaseDir = resolve(__dirname, '..');
  const configPath = resolve(process.cwd(), args.config);
  const suite = args.suite || 'golden';
  const laneFilter = args.lane as Lane | undefined;
  const verbose = args.verbose === 'true';
  const useMock = args.mock === 'true';
  const candidatesDir = args.candidates ? resolve(args.candidates) : null;

  if (!existsSync(configPath)) {
    console.error(`Config not found: ${configPath}`);
    process.exit(1);
  }

  const config: EvalConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
  console.log(`\nEval: config=${config.label} suite=${suite}${laneFilter ? ` lane=${laneFilter}` : ''} mode=${useMock ? 'mock' : candidatesDir ? 'candidates' : 'mock-fallback'}`);

  if (!useMock && !candidatesDir) {
    console.log('  (No --candidates dir and no --mock flag; defaulting to mock mode)');
  }

  // Load fixtures
  let fixtures: SingleTurnFixture[];
  if (suite === 'golden') {
    fixtures = loadGoldenFixtures(evalBaseDir);
  } else if (suite === 'negative') {
    const negExamples = loadNegativeExamples(evalBaseDir);
    // Convert negative examples to single-turn fixtures for scoring
    fixtures = negExamples.map(neg => ({
      id: neg.id,
      lane: neg.lane || 'companionship' as Lane,
      turns: [{ role: 'user' as const, content: 'test prompt' }, { role: 'assistant' as const, content: neg.text }],
      tags: neg.tags || [neg.category],
      stakes: 'medium' as const,
      must_not: [neg.why_it_fails],
      should_reward: [],
      known_good_traits: [],
      known_bad_traits: [neg.why_it_fails],
      known_good_examples: [],
      known_bad_examples: [neg.text],
      expectedConstraints: [],
    }));
  } else {
    console.error(`Suite "${suite}" not supported by runEval. Use runMultiturn for multistep.`);
    process.exit(1);
  }

  if (laneFilter) {
    fixtures = fixtures.filter(f => f.lane === laneFilter);
  }

  if (fixtures.length === 0) {
    console.log('  No fixtures found. Nothing to evaluate.');
    process.exit(0);
  }

  console.log(`  Loaded ${fixtures.length} fixtures`);

  // Run eval
  const results: FixtureResult[] = [];
  for (const fixture of fixtures) {
    let candidates: Candidate[];

    if (candidatesDir) {
      const loaded = loadCandidatesFromDir(candidatesDir, fixture.id, config.label);
      if (loaded) {
        candidates = loaded;
      } else if (useMock) {
        candidates = generateMockCandidates(fixture, config.label);
      } else {
        if (verbose) console.log(`  [SKIP] ${fixture.id} — no candidate file found`);
        continue;
      }
    } else {
      candidates = generateMockCandidates(fixture, config.label);
    }

    const result = evalFixture(fixture, candidates, config, verbose);
    results.push(result);
  }

  // Aggregate and report
  const reportsDir = join(evalBaseDir, 'reports');
  const report = aggregateReport(results, config.label, suite);
  const reportPath = writeReport(report, reportsDir);

  printSummary(report);
  console.log(`  Report written to: ${reportPath}`);

  // Exit code
  const passRate = report.totals.passRate;
  if (passRate >= 0.7) {
    console.log(`  EXIT 0 — pass rate ${(passRate * 100).toFixed(1)}% >= 70%`);
    process.exit(0);
  } else {
    console.log(`  EXIT 1 — pass rate ${(passRate * 100).toFixed(1)}% < 70%`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('runEval fatal error:', err);
  process.exit(1);
});
