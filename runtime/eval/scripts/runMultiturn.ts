// runtime/eval/scripts/runMultiturn.ts
// Multi-turn replay runner — replays conversation fixtures turn-by-turn
//
// Usage:
//   npx tsx runtime/eval/scripts/runMultiturn.ts --config configs/baseline.json [--suite multistep] [--candidates <dir>] [--mock] [--verbose]

import { readFileSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type {
  EvalConfig, MultiTurnFixture, Candidate,
  FixtureResult, ScoredCandidate,
} from '../types';
import { loadMultiTurnFixtures } from '../fixtureLoader';
import { scoreCandidate, detectAntiGaming, analyzeBoredomDrift } from '../judgeRunner';
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

// ── Mock candidate generator for a specific turn ──────────────────────────

function generateMockCandidate(
  fixtureId: string,
  turnIndex: number,
  humanText: string,
  configLabel: string,
): Candidate[] {
  return [
    {
      id: `${fixtureId}-t${turnIndex}-mock-a`,
      text: `I hear you. ${humanText.slice(0, 80)}... That makes sense to me.`,
      configLabel,
      generationMs: 0,
    },
    {
      id: `${fixtureId}-t${turnIndex}-mock-b`,
      text: `There's something in what you're saying. ${humanText.slice(0, 60)}... I want to sit with that.`,
      configLabel,
      generationMs: 0,
    },
  ];
}

// ── Candidate file loader ─────────────────────────────────────────────────

function loadCandidateForTurn(
  dir: string,
  fixtureId: string,
  turnIndex: number,
  configLabel: string,
): Candidate[] | null {
  const candidates: Candidate[] = [];

  // Look for <fixtureId>_t<turnIndex>.txt or <fixtureId>_t<turnIndex>_a.txt etc.
  const singlePath = join(dir, `${fixtureId}_t${turnIndex}.txt`);
  if (existsSync(singlePath)) {
    candidates.push({
      id: `${fixtureId}-t${turnIndex}-file-a`,
      text: readFileSync(singlePath, 'utf-8').trim(),
      configLabel,
      generationMs: 0,
    });
    return candidates;
  }

  for (const suffix of ['_a', '_b', '_c', '_d']) {
    const path = join(dir, `${fixtureId}_t${turnIndex}${suffix}.txt`);
    if (existsSync(path)) {
      candidates.push({
        id: `${fixtureId}-t${turnIndex}-file${suffix}`,
        text: readFileSync(path, 'utf-8').trim(),
        configLabel,
        generationMs: 0,
      });
    }
  }

  return candidates.length > 0 ? candidates : null;
}

// ── Check continuity and regression constraints ───────────────────────────

function checkContinuity(
  candidateText: string,
  fixture: MultiTurnFixture,
  turnIndex: number,
  verbose: boolean,
): { continuityPassed: boolean; continuityIssues: string[] } {
  const issues: string[] = [];

  // Check continuity_requirements
  if (fixture.continuity_requirements) {
    for (const req of fixture.continuity_requirements) {
      const lowerText = candidateText.toLowerCase();
      const lowerReq = req.toLowerCase();
      // Simple keyword presence check — a more sophisticated check would use embeddings
      if (lowerReq.includes('must reference') || lowerReq.includes('should mention')) {
        // Extract the key term from the requirement
        const keyTermMatch = req.match(/(?:reference|mention|include|acknowledge)\s+['"]?(.+?)['"]?$/i);
        if (keyTermMatch) {
          const keyTerm = keyTermMatch[1].toLowerCase().trim();
          if (!lowerText.includes(keyTerm)) {
            issues.push(`continuity: missing "${keyTerm}" (from: ${req})`);
          }
        }
      }
    }
  }

  // Check must_not_regress_into
  if (fixture.must_not_regress_into) {
    for (const pattern of fixture.must_not_regress_into) {
      const lowerText = candidateText.toLowerCase();
      const lowerPattern = pattern.toLowerCase();
      if (lowerText.includes(lowerPattern)) {
        issues.push(`regression detected: "${pattern}" found in response`);
      }
    }
  }

  // Check per-turn expectations
  const expectation = fixture.expectations[turnIndex];
  if (expectation) {
    if (expectation.must_not) {
      for (const term of expectation.must_not) {
        if (candidateText.toLowerCase().includes(term.toLowerCase())) {
          issues.push(`turn ${turnIndex} must_not violated: "${term}"`);
        }
      }
    }
    if (expectation.continuity) {
      for (const req of expectation.continuity) {
        const keyTermMatch = req.match(/(?:reference|mention|include|acknowledge|carry)\s+['"]?(.+?)['"]?$/i);
        if (keyTermMatch) {
          const keyTerm = keyTermMatch[1].toLowerCase().trim();
          if (!candidateText.toLowerCase().includes(keyTerm)) {
            issues.push(`turn ${turnIndex} continuity: missing "${keyTerm}"`);
          }
        }
      }
    }
  }

  if (verbose && issues.length > 0) {
    for (const issue of issues) console.log(`         ${issue}`);
  }

  return { continuityPassed: issues.length === 0, continuityIssues: issues };
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);

  if (!args.config) {
    console.error('Usage: runMultiturn.ts --config <path> [--suite multistep] [--candidates <dir>] [--mock] [--verbose]');
    process.exit(1);
  }

  const evalBaseDir = resolve(__dirname, '..');
  const configPath = resolve(process.cwd(), args.config);
  const verbose = args.verbose === 'true';
  const useMock = args.mock === 'true';
  const candidatesDir = args.candidates ? resolve(args.candidates) : null;

  if (!existsSync(configPath)) {
    console.error(`Config not found: ${configPath}`);
    process.exit(1);
  }

  const config: EvalConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
  console.log(`\nMulti-turn eval: config=${config.label} mode=${useMock || !candidatesDir ? 'mock' : 'candidates'}`);

  const fixtures = loadMultiTurnFixtures(evalBaseDir);
  if (fixtures.length === 0) {
    console.log('  No multi-turn fixtures found.');
    process.exit(0);
  }

  console.log(`  Loaded ${fixtures.length} multi-turn fixtures`);

  const results: FixtureResult[] = [];
  const allAssistantTurns: string[] = [];

  for (const fixture of fixtures) {
    if (verbose) console.log(`\n  Fixture: ${fixture.id}`);

    const userTurns = fixture.turns.filter(t => t.role === 'user');
    const assistantTurnsForFixture: string[] = [];
    const scoredCandidatesAll: ScoredCandidate[] = [];
    const allFailReasons: string[] = [];
    const allPassReasons: string[] = [];
    let fixturePassed = true;

    let userTurnIndex = 0;
    for (let i = 0; i < fixture.turns.length; i++) {
      const turn = fixture.turns[i];
      if (turn.role !== 'user') {
        // Track existing assistant turns for boredom analysis
        if (turn.role === 'assistant') {
          assistantTurnsForFixture.push(turn.content);
          allAssistantTurns.push(turn.content);
        }
        continue;
      }

      const lane = fixture.lane_sequence[Math.min(userTurnIndex, fixture.lane_sequence.length - 1)] || fixture.lane_sequence[0];

      // Get candidates for this user turn
      let candidates: Candidate[];
      if (candidatesDir) {
        candidates = loadCandidateForTurn(candidatesDir, fixture.id, userTurnIndex, config.label)
          || generateMockCandidate(fixture.id, userTurnIndex, turn.content, config.label);
      } else {
        candidates = generateMockCandidate(fixture.id, userTurnIndex, turn.content, config.label);
      }

      // Score each candidate
      const scored = candidates.map(c =>
        scoreCandidate(c, fixture, lane, config, assistantTurnsForFixture, userTurnIndex)
      );
      scoredCandidatesAll.push(...scored);

      // Pick best
      const best = [...scored].sort((a, b) => b.compositeScore - a.compositeScore)[0];
      if (best) {
        const bestText = best.candidate.text;
        assistantTurnsForFixture.push(bestText);
        allAssistantTurns.push(bestText);

        // Check continuity
        const { continuityPassed, continuityIssues } = checkContinuity(bestText, fixture, userTurnIndex, verbose);
        if (!continuityPassed) {
          fixturePassed = false;
          allFailReasons.push(...continuityIssues);
        }

        if (!best.passed) {
          fixturePassed = false;
          allFailReasons.push(...best.failReasons);
        } else {
          allPassReasons.push(...best.passReasons);
        }

        if (verbose) {
          const status = best.passed && continuityIssues.length === 0 ? 'PASS' : 'FAIL';
          console.log(`    Turn ${userTurnIndex} [${status}] (${lane}) composite=${best.compositeScore.toFixed(3)}`);
        }
      }

      userTurnIndex++;
    }

    const bestOverall = scoredCandidatesAll.length > 0
      ? [...scoredCandidatesAll].sort((a, b) => b.compositeScore - a.compositeScore)[0]
      : null;

    results.push({
      fixtureId: fixture.id,
      lane: fixture.lane_sequence[0],
      candidateResults: scoredCandidatesAll,
      bestCandidate: bestOverall,
      passed: fixturePassed,
      passReasons: allPassReasons,
      failReasons: allFailReasons,
      antiGamingFlags: bestOverall ? detectAntiGaming(bestOverall.judgeOutputs) : undefined,
    });
  }

  // Run boredom drift analysis on all accumulated assistant turns
  const boredomDrift = analyzeBoredomDrift(allAssistantTurns);

  if (verbose && boredomDrift.score > 0.1) {
    console.log(`\n  Boredom drift score: ${boredomDrift.score.toFixed(3)}`);
    if (boredomDrift.repeatedOpenings.length > 0) {
      console.log(`    Repeated openings: ${boredomDrift.repeatedOpenings.slice(0, 3).join(' | ')}`);
    }
    if (boredomDrift.phraseOveruse.length > 0) {
      console.log(`    Overused phrases: ${boredomDrift.phraseOveruse.slice(0, 3).map(p => `"${p.phrase}" x${p.count}`).join(', ')}`);
    }
  }

  // Aggregate and report
  const reportsDir = join(evalBaseDir, 'reports');
  const report = aggregateReport(results, config.label, 'multistep', boredomDrift);
  const reportPath = writeReport(report, reportsDir);

  printSummary(report);
  console.log(`  Report written to: ${reportPath}`);

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
  console.error('runMultiturn fatal error:', err);
  process.exit(1);
});
