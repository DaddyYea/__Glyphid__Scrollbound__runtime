// runtime/eval/scripts/summarizeEval.ts
// Report summarizer — loads all JSON reports from a directory and prints a combined summary
//
// Usage:
//   npx tsx runtime/eval/scripts/summarizeEval.ts --input runtime/eval/reports/
//   npx tsx runtime/eval/scripts/summarizeEval.ts --input runtime/eval/reports/latest/

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, resolve, extname } from 'path';
import type { EvalReport } from '../types';

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

// ── Report loading ────────────────────────────────────────────────────────

function loadReports(dir: string): Array<{ filename: string; data: any }> {
  if (!existsSync(dir)) return [];
  const reports: Array<{ filename: string; data: any }> = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && extname(entry.name) === '.json') {
      try {
        const raw = readFileSync(join(dir, entry.name), 'utf-8');
        reports.push({ filename: entry.name, data: JSON.parse(raw) });
      } catch {
        // Skip invalid JSON
      }
    } else if (entry.isDirectory()) {
      reports.push(...loadReports(join(dir, entry.name)));
    }
  }

  return reports;
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);

  if (!args.input) {
    console.error('Usage: summarizeEval.ts --input <reports-dir>');
    process.exit(1);
  }

  const inputDir = resolve(args.input);
  if (!existsSync(inputDir)) {
    console.error(`Reports directory not found: ${inputDir}`);
    process.exit(1);
  }

  const reports = loadReports(inputDir);
  if (reports.length === 0) {
    console.log('No reports found.');
    process.exit(0);
  }

  console.log(`\nLoaded ${reports.length} report(s) from ${inputDir}`);

  // Categorize
  const evalReports: Array<{ filename: string; data: EvalReport }> = [];
  const pairwiseReports: Array<{ filename: string; data: any }> = [];
  const ablationReports: Array<{ filename: string; data: any }> = [];
  const sweepReports: Array<{ filename: string; data: any }> = [];

  for (const r of reports) {
    if (r.data.type === 'pairwise') pairwiseReports.push(r);
    else if (r.data.type === 'ablation') ablationReports.push(r);
    else if (r.data.type === 'sweep') sweepReports.push(r);
    else if (r.data.runId && r.data.totals) evalReports.push(r);
  }

  console.log(`  Eval: ${evalReports.length} | Pairwise: ${pairwiseReports.length} | Ablation: ${ablationReports.length} | Sweep: ${sweepReports.length}`);

  // ── Eval reports summary ────────────────────────────────────────────────

  if (evalReports.length > 0) {
    console.log('\n' + '='.repeat(70));
    console.log('  EVAL REPORTS');
    console.log('='.repeat(70));

    // Find best config
    const sorted = [...evalReports].sort((a, b) => b.data.totals.avgComposite - a.data.totals.avgComposite);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];

    console.log(`\n  Best config: ${best.data.configLabel} (${best.data.suite})`);
    console.log(`    pass=${(best.data.totals.passRate * 100).toFixed(1)}% avg=${best.data.totals.avgComposite.toFixed(3)}`);

    if (sorted.length > 1) {
      console.log(`\n  Worst config: ${worst.data.configLabel} (${worst.data.suite})`);
      console.log(`    pass=${(worst.data.totals.passRate * 100).toFixed(1)}% avg=${worst.data.totals.avgComposite.toFixed(3)}`);
    }

    // Aggregate regressions
    const allRegressions = evalReports.flatMap(r => r.data.regressions.map(reg => ({ ...reg, config: r.data.configLabel })));
    if (allRegressions.length > 0) {
      console.log(`\n  ── Worst Regressions (across all configs) ──`);
      const sortedRegs = allRegressions.sort((a, b) => a.delta - b.delta);
      for (const r of sortedRegs.slice(0, 5)) {
        console.log(`    ${r.fixtureId} [${r.lane}] config=${r.config} delta=${r.delta.toFixed(3)}`);
      }
    }

    // Aggregate improvements
    const allImprovements = evalReports.flatMap(r => r.data.improvements.map(imp => ({ ...imp, config: r.data.configLabel })));
    if (allImprovements.length > 0) {
      console.log(`\n  ── Biggest Improvements (across all configs) ──`);
      const sortedImps = allImprovements.sort((a, b) => b.delta - a.delta);
      for (const i of sortedImps.slice(0, 5)) {
        console.log(`    ${i.fixtureId} [${i.lane}] config=${i.config} delta=+${i.delta.toFixed(3)}`);
      }
    }

    // Persistent judge conflicts
    const conflictCounts = new Map<string, number>();
    for (const r of evalReports) {
      for (const c of r.data.judgeConflicts) {
        conflictCounts.set(c.majorConflictType, (conflictCounts.get(c.majorConflictType) || 0) + c.conflictFixtureCount);
      }
    }
    if (conflictCounts.size > 0) {
      console.log(`\n  ── Persistent Judge Conflicts ──`);
      const sorted = [...conflictCounts.entries()].sort((a, b) => b[1] - a[1]);
      for (const [type, count] of sorted.slice(0, 5)) {
        console.log(`    ${type}: ${count} total fixture-level conflicts`);
      }
    }
  }

  // ── Pairwise summary ────────────────────────────────────────────────────

  if (pairwiseReports.length > 0) {
    console.log('\n' + '='.repeat(70));
    console.log('  PAIRWISE REPORTS');
    console.log('='.repeat(70));

    for (const r of pairwiseReports) {
      const d = r.data;
      console.log(`\n  ${d.leftConfig} vs ${d.rightConfig}`);
      console.log(`    Left wins: ${d.summary.leftWins} | Right wins: ${d.summary.rightWins} | Ties: ${d.summary.ties}`);
    }
  }

  // ── Ablation summary ────────────────────────────────────────────────────

  if (ablationReports.length > 0) {
    console.log('\n' + '='.repeat(70));
    console.log('  ABLATION REPORTS');
    console.log('='.repeat(70));

    for (const r of ablationReports) {
      const d = r.data;
      console.log(`\n  Base: ${d.baseConfig} | Baseline pass=${(d.baseline.passRate * 100).toFixed(1)}%`);

      if (d.deltas && d.deltas.length > 0) {
        const mostHarmful = [...d.deltas].sort((a: any, b: any) => a.globalCompositeDelta - b.globalCompositeDelta)[0];
        const leastHarmful = [...d.deltas].sort((a: any, b: any) => b.globalCompositeDelta - a.globalCompositeDelta)[0];
        console.log(`    Most harmful ablation: ${mostHarmful.ablationLabel} (compDelta=${mostHarmful.globalCompositeDelta.toFixed(4)})`);
        console.log(`    Least harmful ablation: ${leastHarmful.ablationLabel} (compDelta=${leastHarmful.globalCompositeDelta >= 0 ? '+' : ''}${leastHarmful.globalCompositeDelta.toFixed(4)})`);
      }
    }
  }

  // ── Sweep summary ───────────────────────────────────────────────────────

  if (sweepReports.length > 0) {
    console.log('\n' + '='.repeat(70));
    console.log('  SWEEP REPORTS');
    console.log('='.repeat(70));

    for (const r of sweepReports) {
      const d = r.data;
      console.log(`\n  Sweep: ${d.sweepLabel} (${d.variantCount} variants)`);
      if (d.bestGlobal) {
        const weightsStr = Object.entries(d.bestGlobal.weights).map(([k, v]) => `${k}=${v}`).join(', ');
        console.log(`    Best global: variant ${d.bestGlobal.index} — ${weightsStr}`);
      }
    }
  }

  console.log('\n' + '='.repeat(70) + '\n');
}

main().catch(err => {
  console.error('summarizeEval fatal error:', err);
  process.exit(1);
});
