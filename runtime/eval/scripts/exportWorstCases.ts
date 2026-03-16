// runtime/eval/scripts/exportWorstCases.ts
// Exports the N worst-scoring fixtures from a report, with full judge details
//
// Usage:
//   npx tsx runtime/eval/scripts/exportWorstCases.ts --report runtime/eval/reports/latest/summary.json [--count 20] [--format json]
//   npx tsx runtime/eval/scripts/exportWorstCases.ts --report runtime/eval/reports/latest/summary.json --count 10 --format csv [--output worst.csv]

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
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

// ── CSV escaping ──────────────────────────────────────────────────────────

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// ── Worst case extraction ─────────────────────────────────────────────────

interface WorstCaseRow {
  fixtureId: string;
  lane: string;
  compositeScore: number;
  passed: boolean;
  failReasons: string;
  judgeScores: Record<string, number>;
  judgeReasons: Record<string, string[]>;
  judgeFlags: Record<string, string[]>;
  candidateText: string;
}

function extractWorstCases(report: EvalReport, count: number): WorstCaseRow[] {
  // worstCases is already sorted by composite (ascending)
  const cases = report.worstCases.slice(0, count);
  const rows: WorstCaseRow[] = [];

  for (const c of cases) {
    const best = c.bestCandidate;
    if (!best) continue;

    const judgeScores: Record<string, number> = {};
    const judgeReasons: Record<string, string[]> = {};
    const judgeFlags: Record<string, string[]> = {};

    for (const j of best.judgeOutputs) {
      judgeScores[j.judge] = j.score;
      judgeReasons[j.judge] = j.reasons;
      judgeFlags[j.judge] = j.flags || [];
    }

    rows.push({
      fixtureId: c.fixtureId,
      lane: c.lane,
      compositeScore: best.compositeScore,
      passed: best.passed,
      failReasons: best.failReasons.join('; '),
      judgeScores,
      judgeReasons,
      judgeFlags,
      candidateText: best.candidate.text,
    });
  }

  return rows;
}

// ── Formatters ────────────────────────────────────────────────────────────

function formatJson(rows: WorstCaseRow[]): string {
  return JSON.stringify(rows, null, 2);
}

function formatCsv(rows: WorstCaseRow[]): string {
  if (rows.length === 0) return '';

  // Collect all judge names
  const allJudges = new Set<string>();
  for (const row of rows) {
    for (const judge of Object.keys(row.judgeScores)) allJudges.add(judge);
  }
  const judgeList = [...allJudges].sort();

  // Header
  const headers = [
    'fixtureId', 'lane', 'compositeScore', 'passed', 'failReasons',
    ...judgeList.map(j => `score_${j}`),
    ...judgeList.map(j => `reasons_${j}`),
    ...judgeList.map(j => `flags_${j}`),
    'candidateText',
  ];

  const lines = [headers.join(',')];

  for (const row of rows) {
    const fields = [
      csvEscape(row.fixtureId),
      csvEscape(row.lane),
      row.compositeScore.toFixed(4),
      String(row.passed),
      csvEscape(row.failReasons),
      ...judgeList.map(j => (row.judgeScores[j] ?? '').toString()),
      ...judgeList.map(j => csvEscape((row.judgeReasons[j] || []).join('; '))),
      ...judgeList.map(j => csvEscape((row.judgeFlags[j] || []).join('; '))),
      csvEscape(row.candidateText.slice(0, 500)),
    ];
    lines.push(fields.join(','));
  }

  return lines.join('\n');
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);

  if (!args.report) {
    console.error('Usage: exportWorstCases.ts --report <summary.json> [--count 20] [--format json|csv] [--output <file>]');
    process.exit(1);
  }

  const reportPath = resolve(args.report);
  const count = parseInt(args.count || '20', 10);
  const format = args.format || 'json';
  const outputPath = args.output ? resolve(args.output) : null;

  if (!existsSync(reportPath)) {
    console.error(`Report not found: ${reportPath}`);
    process.exit(1);
  }

  const report: EvalReport = JSON.parse(readFileSync(reportPath, 'utf-8'));
  const rows = extractWorstCases(report, count);

  if (rows.length === 0) {
    console.log('No worst cases found in report.');
    process.exit(0);
  }

  let output: string;
  if (format === 'csv') {
    output = formatCsv(rows);
  } else {
    output = formatJson(rows);
  }

  if (outputPath) {
    writeFileSync(outputPath, output, 'utf-8');
    console.log(`Exported ${rows.length} worst cases to ${outputPath}`);
  } else {
    console.log(output);
  }
}

main().catch(err => {
  console.error('exportWorstCases fatal error:', err);
  process.exit(1);
});
