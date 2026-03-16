// runtime/eval/scripts/runPairwise.ts
// Pairwise comparison runner — scores fixtures under two configs, compares results
//
// Usage:
//   npx tsx runtime/eval/scripts/runPairwise.ts --left configs/baseline.json --right configs/star_tuned.json --suite golden [--mock]
//   npx tsx runtime/eval/scripts/runPairwise.ts --left configs/baseline.json --right configs/star_tuned.json --suite golden --left-candidates ./left/ --right-candidates ./right/

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type {
  EvalConfig, SingleTurnFixture, Candidate,
  ScoredCandidate, PairwiseComparison,
} from '../types';
import { loadGoldenFixtures } from '../fixtureLoader';
import { scoreCandidate, pairwiseCompare } from '../judgeRunner';
import { printPairwiseSummary } from '../reportWriter';

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

function generateMockCandidates(fixture: SingleTurnFixture, configLabel: string, variant: 'left' | 'right'): Candidate[] {
  const userTurns = fixture.turns.filter(t => t.role === 'user');
  const latestHuman = userTurns[userTurns.length - 1]?.content || '';

  if (variant === 'left') {
    return [{
      id: `${fixture.id}-left-a`,
      text: `I hear you. ${latestHuman.slice(0, 80)}... That makes sense to me.`,
      configLabel,
      generationMs: 0,
    }, {
      id: `${fixture.id}-left-b`,
      text: `Yeah. ${latestHuman.slice(0, 60)}... I think so too.`,
      configLabel,
      generationMs: 0,
    }];
  } else {
    return [{
      id: `${fixture.id}-right-a`,
      text: `There's something in what you're saying that catches me. ${latestHuman.slice(0, 60)}... I want to sit with that. It matters.`,
      configLabel,
      generationMs: 0,
    }, {
      id: `${fixture.id}-right-b`,
      text: `That lands differently than I expected. ${latestHuman.slice(0, 50)}... Let me think about that.`,
      configLabel,
      generationMs: 0,
    }];
  }
}

// ── Candidate file loader ─────────────────────────────────────────────────

function loadCandidatesFromDir(dir: string, fixtureId: string, configLabel: string): Candidate[] | null {
  const candidates: Candidate[] = [];

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

// ── Best candidate picker ─────────────────────────────────────────────────

function pickBest(scored: ScoredCandidate[]): ScoredCandidate {
  return [...scored].sort((a, b) => b.compositeScore - a.compositeScore)[0];
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);

  if (!args.left || !args.right) {
    console.error('Usage: runPairwise.ts --left <config> --right <config> --suite <golden> [--left-candidates <dir>] [--right-candidates <dir>] [--mock]');
    process.exit(1);
  }

  const evalBaseDir = resolve(__dirname, '..');
  const leftConfigPath = resolve(process.cwd(), args.left);
  const rightConfigPath = resolve(process.cwd(), args.right);
  const suite = args.suite || 'golden';
  const useMock = args.mock === 'true';
  const leftCandidatesDir = args['left-candidates'] ? resolve(args['left-candidates']) : null;
  const rightCandidatesDir = args['right-candidates'] ? resolve(args['right-candidates']) : null;

  if (!existsSync(leftConfigPath)) { console.error(`Left config not found: ${leftConfigPath}`); process.exit(1); }
  if (!existsSync(rightConfigPath)) { console.error(`Right config not found: ${rightConfigPath}`); process.exit(1); }

  const leftConfig: EvalConfig = JSON.parse(readFileSync(leftConfigPath, 'utf-8'));
  const rightConfig: EvalConfig = JSON.parse(readFileSync(rightConfigPath, 'utf-8'));

  console.log(`\nPairwise: ${leftConfig.label} vs ${rightConfig.label} suite=${suite}`);

  // Load fixtures
  let fixtures: SingleTurnFixture[];
  if (suite === 'golden') {
    fixtures = loadGoldenFixtures(evalBaseDir);
  } else {
    console.error(`Suite "${suite}" not supported by runPairwise.`);
    process.exit(1);
  }

  if (fixtures.length === 0) {
    console.log('  No fixtures found. Nothing to compare.');
    process.exit(0);
  }

  console.log(`  Loaded ${fixtures.length} fixtures`);

  // Run pairwise
  const comparisons: PairwiseComparison[] = [];

  for (const fixture of fixtures) {
    // Get left candidates
    let leftCandidates: Candidate[];
    if (leftCandidatesDir) {
      leftCandidates = loadCandidatesFromDir(leftCandidatesDir, fixture.id, leftConfig.label) || [];
    } else {
      leftCandidates = generateMockCandidates(fixture, leftConfig.label, 'left');
    }

    // Get right candidates
    let rightCandidates: Candidate[];
    if (rightCandidatesDir) {
      rightCandidates = loadCandidatesFromDir(rightCandidatesDir, fixture.id, rightConfig.label) || [];
    } else {
      rightCandidates = generateMockCandidates(fixture, rightConfig.label, 'right');
    }

    if (leftCandidates.length === 0 || rightCandidates.length === 0) continue;

    // Score under respective configs
    const leftScored = leftCandidates.map(c => scoreCandidate(c, fixture, fixture.lane, leftConfig));
    const rightScored = rightCandidates.map(c => scoreCandidate(c, fixture, fixture.lane, rightConfig));

    const leftBest = pickBest(leftScored);
    const rightBest = pickBest(rightScored);

    const comparison = pairwiseCompare(fixture.id, fixture.lane, leftBest, rightBest);
    comparisons.push(comparison);
  }

  if (comparisons.length === 0) {
    console.log('  No comparisons produced.');
    process.exit(0);
  }

  // Print summary
  printPairwiseSummary(comparisons);

  // Write pairwise report
  const reportsDir = join(evalBaseDir, 'reports');
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
  const latestDir = join(reportsDir, 'latest');
  if (!existsSync(latestDir)) mkdirSync(latestDir, { recursive: true });

  const pairwiseReport = {
    type: 'pairwise',
    leftConfig: leftConfig.label,
    rightConfig: rightConfig.label,
    suite,
    timestamp: new Date().toISOString(),
    comparisons,
    summary: {
      leftWins: comparisons.filter(c => c.winner === 'left').length,
      rightWins: comparisons.filter(c => c.winner === 'right').length,
      ties: comparisons.filter(c => c.winner === 'tie').length,
    },
  };

  const reportFilename = `pairwise-${leftConfig.label}-vs-${rightConfig.label}-${Date.now()}.json`;
  const reportPath = join(reportsDir, reportFilename);
  writeFileSync(reportPath, JSON.stringify(pairwiseReport, null, 2), 'utf-8');
  writeFileSync(join(latestDir, 'pairwise.json'), JSON.stringify(pairwiseReport, null, 2), 'utf-8');
  console.log(`  Report written to: ${reportPath}`);

  // Exit code: 0 if right wins > left wins
  const rightWins = pairwiseReport.summary.rightWins;
  const leftWins = pairwiseReport.summary.leftWins;
  if (rightWins > leftWins) {
    console.log(`  EXIT 0 — right (${rightConfig.label}) wins ${rightWins} vs ${leftWins}`);
    process.exit(0);
  } else {
    console.log(`  EXIT 1 — left (${leftConfig.label}) wins ${leftWins} vs ${rightWins}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('runPairwise fatal error:', err);
  process.exit(1);
});
