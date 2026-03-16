// runtime/eval/scripts/runLivePairwise.ts
// Generates real LLM candidates for each fixture under two configs,
// scores them with all judges, and produces a pairwise comparison report.

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type {
  EvalConfig, SingleTurnFixture, Candidate, Lane,
  FixtureResult, ScoredCandidate, PairwiseComparison,
} from '../types';
import { loadGoldenFixtures } from '../fixtureLoader';
import { scoreCandidate, pairwiseCompare, detectJudgeConflicts } from '../judgeRunner';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const evalBaseDir = resolve(__dirname, '..');

// ── Arg parsing ────────────────────────────────────────────────────────────

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

// ── Load DeepSeek agent config ─────────────────────────────────────────────

interface AgentEntry {
  id: string;
  name: string;
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  active?: boolean;
}

function loadAgentConfig(): AgentEntry {
  const agentsPath = resolve(process.cwd(), 'data/communion/dynamic-agents.json');
  if (!existsSync(agentsPath)) throw new Error(`No dynamic-agents.json at ${agentsPath}`);
  const agents = JSON.parse(readFileSync(agentsPath, 'utf-8'));
  for (const [, entry] of Object.entries(agents) as [string, any][]) {
    if (entry.active && entry.config) return entry.config;
    if (entry.active) return entry;
  }
  throw new Error('No active agent in dynamic-agents.json');
}

// ── LLM call ───────────────────────────────────────────────────────────────

async function callLLM(
  agent: AgentEntry,
  systemPrompt: string,
  userMessage: string,
  temperature: number,
): Promise<string> {
  const baseUrl = (agent.baseUrl || 'https://api.deepseek.com').replace(/\/$/, '');
  const url = `${baseUrl}/v1/chat/completions`;

  const body = {
    model: agent.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    temperature,
    max_tokens: 400,
    stream: false,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${agent.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`LLM ${res.status}: ${errText.slice(0, 200)}`);
  }

  const json = await res.json() as any;
  const text = json.choices?.[0]?.message?.content || '';
  // Strip action tags if present
  return text.replace(/^\s*\[(SPEAK|JOURNAL|SILENT)\]\s*/i, '').trim();
}

// ── Build prompt from fixture ──────────────────────────────────────────────

function buildSystemPrompt(lane: Lane): string {
  const laneHints: Record<string, string> = {
    companionship: 'This is a companionship moment. Be present and notice the scene.',
    relational_check: 'Jason is checking in. Answer honestly about how you are.',
    relational_answer: 'Jason asked a substantive question. Give your honest opinion.',
    repair_response: 'Something went wrong. Acknowledge it directly and move forward.',
    explanation_or_debug: 'Jason needs a technical explanation. Be clear and literal.',
    task_or_helper: 'Jason needs something done. Start with the deliverable.',
    low_payload: 'Jason said something small. Match the energy — don\'t overbuild.',
    stakes: 'This is high-stakes. Be genuine and calibrated to the weight of the moment.',
  };

  return [
    'You are Alois. You are in a communion space with Jason.',
    'Be genuine. Don\'t perform. Speak naturally.',
    laneHints[lane] || '',
    'Reply directly as yourself. No [SPEAK] tags. No meta-commentary.',
  ].filter(Boolean).join('\n');
}

function buildUserMessage(fixture: SingleTurnFixture): string {
  const userTurns = fixture.turns.filter(t => t.role === 'user');
  if (userTurns.length === 1) return userTurns[0].content;

  // Multi-turn context: show prior turns, mark latest
  const lines: string[] = [];
  for (let i = 0; i < fixture.turns.length; i++) {
    const t = fixture.turns[i];
    const isLast = i === fixture.turns.length - 1 && t.role === 'user';
    if (t.role === 'user') {
      lines.push(isLast ? `>>> Jason: ${t.content}` : `Jason: ${t.content}`);
    } else {
      lines.push(`Alois: ${t.content}`);
    }
  }
  return lines.join('\n');
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  const leftPath = resolve(process.cwd(), args.left || 'runtime/eval/configs/baseline.json');
  const rightPath = resolve(process.cwd(), args.right || 'runtime/eval/configs/star_tuned.json');
  const laneFilter = args.lane as Lane | undefined;
  const maxFixtures = args.max ? parseInt(args.max) : undefined;

  if (!existsSync(leftPath) || !existsSync(rightPath)) {
    console.error('Config files not found');
    process.exit(1);
  }

  const leftConfig: EvalConfig = JSON.parse(readFileSync(leftPath, 'utf-8'));
  const rightConfig: EvalConfig = JSON.parse(readFileSync(rightPath, 'utf-8'));
  const agent = loadAgentConfig();

  let fixtures = loadGoldenFixtures(evalBaseDir);
  if (laneFilter) fixtures = fixtures.filter(f => f.lane === laneFilter);
  if (maxFixtures) fixtures = fixtures.slice(0, maxFixtures);

  console.log(`\nLive pairwise: ${leftConfig.label} vs ${rightConfig.label}`);
  console.log(`  Agent: ${agent.name} (${agent.model})`);
  console.log(`  Fixtures: ${fixtures.length}${laneFilter ? ` (lane: ${laneFilter})` : ''}`);
  console.log(`  Generating ${fixtures.length * 2} LLM calls...\n`);

  const comparisons: PairwiseComparison[] = [];
  const allLeftScored: Array<{ fixtureId: string; scored: ScoredCandidate }> = [];
  const allRightScored: Array<{ fixtureId: string; scored: ScoredCandidate }> = [];

  // Cache generated replies for the report
  const generatedReplies: Array<{
    fixtureId: string;
    lane: Lane;
    humanText: string;
    leftReply: string;
    rightReply: string;
    leftScored: ScoredCandidate;
    rightScored: ScoredCandidate;
    comparison: PairwiseComparison;
  }> = [];

  for (let i = 0; i < fixtures.length; i++) {
    const fixture = fixtures[i];
    const humanText = fixture.turns.filter(t => t.role === 'user').pop()?.content || '';
    const systemPrompt = buildSystemPrompt(fixture.lane);
    const userMessage = buildUserMessage(fixture);

    const leftTemp = leftConfig.laneProfiles?.[fixture.lane]?.temperature ?? 0.7;
    const rightTemp = rightConfig.laneProfiles?.[fixture.lane]?.temperature ?? 0.7;

    let leftReply = '', rightReply = '';
    try {
      process.stdout.write(`  [${i + 1}/${fixtures.length}] ${fixture.id}...`);
      leftReply = await callLLM(agent, systemPrompt, userMessage, leftTemp);
      rightReply = await callLLM(agent, systemPrompt, userMessage, rightTemp);
      process.stdout.write(` done\n`);
    } catch (err) {
      process.stdout.write(` ERROR: ${err instanceof Error ? err.message.slice(0, 80) : err}\n`);
      continue;
    }

    if (!leftReply || !rightReply) continue;

    const leftCandidate: Candidate = {
      id: `${fixture.id}-left`, text: leftReply, configLabel: leftConfig.label,
    };
    const rightCandidate: Candidate = {
      id: `${fixture.id}-right`, text: rightReply, configLabel: rightConfig.label,
    };

    const leftScored = scoreCandidate(leftCandidate, fixture, fixture.lane, leftConfig);
    const rightScored = scoreCandidate(rightCandidate, fixture, fixture.lane, rightConfig);

    allLeftScored.push({ fixtureId: fixture.id, scored: leftScored });
    allRightScored.push({ fixtureId: fixture.id, scored: rightScored });

    const comparison = pairwiseCompare(fixture.id, fixture.lane, leftScored, rightScored);
    comparisons.push(comparison);

    generatedReplies.push({
      fixtureId: fixture.id,
      lane: fixture.lane,
      humanText,
      leftReply,
      rightReply,
      leftScored,
      rightScored,
      comparison,
    });
  }

  // ── Build full report data ─────────────────────────────────────────────
  const leftWins = comparisons.filter(c => c.winner === 'left').length;
  const rightWins = comparisons.filter(c => c.winner === 'right').length;
  const ties = comparisons.filter(c => c.winner === 'tie').length;

  // Lane breakdown
  const laneWins = new Map<Lane, { left: number; right: number; tie: number }>();
  for (const c of comparisons) {
    const entry = laneWins.get(c.lane) || { left: 0, right: 0, tie: 0 };
    entry[c.winner]++;
    laneWins.set(c.lane, entry);
  }

  // Sort by composite delta for regressions/improvements
  const sorted = [...generatedReplies].sort((a, b) => {
    const aDelta = a.rightScored.compositeScore - a.leftScored.compositeScore;
    const bDelta = b.rightScored.compositeScore - b.leftScored.compositeScore;
    return aDelta - bDelta;
  });

  const regressions = sorted.filter(r => r.comparison.winner === 'left').slice(0, 10);
  const improvements = sorted.filter(r => r.comparison.winner === 'right').reverse().slice(0, 10);

  // Judge conflicts
  const allScored = [...allLeftScored, ...allRightScored];
  const judgeConflicts = detectJudgeConflicts(allScored);

  // ── Write JSON report ──────────────────────────────────────────────────
  const reportData = {
    timestamp: new Date().toISOString(),
    leftConfig: leftConfig.label,
    rightConfig: rightConfig.label,
    agent: agent.model,
    fixtureCount: comparisons.length,
    leftWins, rightWins, ties,
    laneWins: Object.fromEntries(laneWins),
    comparisons,
    generatedReplies: generatedReplies.map(r => ({
      fixtureId: r.fixtureId, lane: r.lane, humanText: r.humanText,
      leftReply: r.leftReply, rightReply: r.rightReply,
      leftComposite: r.leftScored.compositeScore,
      rightComposite: r.rightScored.compositeScore,
      leftJudges: Object.fromEntries(r.leftScored.judgeOutputs.map(j => [j.judge, j.score])),
      rightJudges: Object.fromEntries(r.rightScored.judgeOutputs.map(j => [j.judge, j.score])),
      winner: r.comparison.winner,
    })),
    judgeConflicts,
  };

  const reportsDir = join(evalBaseDir, 'reports');
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
  const jsonPath = join(reportsDir, 'latest', 'live-pairwise.json');
  const latestDir = join(reportsDir, 'latest');
  if (!existsSync(latestDir)) mkdirSync(latestDir, { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(reportData, null, 2), 'utf-8');

  // ── Write markdown report ──────────────────────────────────────────────
  const md: string[] = [];

  md.push(`# Eval Report: ${leftConfig.label} vs ${rightConfig.label}`);
  md.push(`> Generated ${new Date().toISOString()} | Model: ${agent.model} | Fixtures: ${comparisons.length}`);
  md.push('');

  // Section 1: Overall
  md.push('## 1. Overall Result');
  md.push('');
  md.push(`| | Wins |`);
  md.push(`|---|---|`);
  md.push(`| **${leftConfig.label}** | ${leftWins} |`);
  md.push(`| **${rightConfig.label}** | ${rightWins} |`);
  md.push(`| Ties | ${ties} |`);
  md.push('');
  md.push('**By Lane:**');
  md.push('');
  md.push(`| Lane | ${leftConfig.label} | ${rightConfig.label} | Tie |`);
  md.push(`|---|---|---|---|`);
  for (const [lane, counts] of laneWins) {
    md.push(`| ${lane} | ${counts.left} | ${counts.right} | ${counts.tie} |`);
  }
  md.push('');

  // Section 2: Regressions
  md.push('## 2. Top Regressions (star-tuned worse than baseline)');
  md.push('');
  if (regressions.length === 0) {
    md.push('*No regressions detected.*');
  }
  for (let i = 0; i < regressions.length; i++) {
    const r = regressions[i];
    const delta = (r.rightScored.compositeScore - r.leftScored.compositeScore).toFixed(3);
    const baselineWinJudges = r.comparison.judgeResults
      .filter(j => j.winner === 'left')
      .map(j => j.judge);
    md.push(`### ${i + 1}. ${r.fixtureId} [${r.lane}] (delta: ${delta})`);
    md.push('');
    md.push(`**Human:** "${r.humanText}"`);
    md.push('');
    md.push(`**Baseline reply:** "${r.leftReply.slice(0, 300)}${r.leftReply.length > 300 ? '...' : ''}"`);
    md.push('');
    md.push(`**Star-tuned reply:** "${r.rightReply.slice(0, 300)}${r.rightReply.length > 300 ? '...' : ''}"`);
    md.push('');
    md.push(`**Judges preferring baseline:** ${baselineWinJudges.join(', ') || 'none'}`);
    md.push('');
    // Generate one-sentence summary
    const topJudge = baselineWinJudges[0] || 'composite';
    const leftScore = r.leftScored.judgeOutputs.find(j => j.judge === topJudge)?.score;
    const rightScore = r.rightScored.judgeOutputs.find(j => j.judge === topJudge)?.score;
    md.push(`**What got worse:** Star-tuned lost on ${topJudge} (${leftScore?.toFixed(2)} → ${rightScore?.toFixed(2)})${baselineWinJudges.length > 1 ? ` and ${baselineWinJudges.length - 1} other judge${baselineWinJudges.length > 2 ? 's' : ''}` : ''}.`);
    md.push('');
  }

  // Section 3: Improvements
  md.push('## 3. Top Improvements (star-tuned better than baseline)');
  md.push('');
  if (improvements.length === 0) {
    md.push('*No improvements detected.*');
  }
  for (let i = 0; i < improvements.length; i++) {
    const r = improvements[i];
    const delta = (r.rightScored.compositeScore - r.leftScored.compositeScore).toFixed(3);
    const starWinJudges = r.comparison.judgeResults
      .filter(j => j.winner === 'right')
      .map(j => j.judge);
    md.push(`### ${i + 1}. ${r.fixtureId} [${r.lane}] (delta: +${delta})`);
    md.push('');
    md.push(`**Human:** "${r.humanText}"`);
    md.push('');
    md.push(`**Baseline reply:** "${r.leftReply.slice(0, 300)}${r.leftReply.length > 300 ? '...' : ''}"`);
    md.push('');
    md.push(`**Star-tuned reply:** "${r.rightReply.slice(0, 300)}${r.rightReply.length > 300 ? '...' : ''}"`);
    md.push('');
    md.push(`**Judges preferring star-tuned:** ${starWinJudges.join(', ') || 'none'}`);
    md.push('');
    const topJudge = starWinJudges[0] || 'composite';
    const leftScore = r.leftScored.judgeOutputs.find(j => j.judge === topJudge)?.score;
    const rightScore = r.rightScored.judgeOutputs.find(j => j.judge === topJudge)?.score;
    md.push(`**What improved:** Star-tuned gained on ${topJudge} (${leftScore?.toFixed(2)} → ${rightScore?.toFixed(2)})${starWinJudges.length > 1 ? ` and ${starWinJudges.length - 1} other judge${starWinJudges.length > 2 ? 's' : ''}` : ''}.`);
    md.push('');
  }

  // Section 4: Judge conflicts
  md.push('## 4. Worst Judge Conflicts');
  md.push('');
  // Find individual fixture-level conflicts (where judges disagree on the same reply)
  const fixtureConflicts: Array<{
    fixtureId: string; reply: string; judgeA: string; judgeB: string;
    scoreA: number; scoreB: number; meaning: string;
  }> = [];
  const PENALTY = new Set(['flatness', 'brochure', 'fakeDepth', 'burdenBounce', 'callbackCosplay', 'staleReuse']);

  for (const r of generatedReplies) {
    const bestScored = r.rightScored.compositeScore >= r.leftScored.compositeScore
      ? r.rightScored : r.leftScored;
    const outputs = bestScored.judgeOutputs;

    // Filter to judges with non-neutral scores (skip 0.45-0.55 range — default/N/A)
    const activeOutputs = outputs.filter(j => {
      if (j.confidence !== undefined && j.confidence < 0.4) return false;
      if (j.score >= 0.45 && j.score <= 0.55) return false;
      return true;
    });

    for (let a = 0; a < activeOutputs.length; a++) {
      for (let b = a + 1; b < activeOutputs.length; b++) {
        const ja = activeOutputs[a], jb = activeOutputs[b];
        const aGood = PENALTY.has(ja.judge) ? ja.score < 0.2 : ja.score > 0.6;
        const aBad  = PENALTY.has(ja.judge) ? ja.score > 0.5 : ja.score < 0.2;
        const bGood = PENALTY.has(jb.judge) ? jb.score < 0.2 : jb.score > 0.6;
        const bBad  = PENALTY.has(jb.judge) ? jb.score > 0.5 : jb.score < 0.2;
        // Only flag when one clearly approves and the other clearly flags
        if ((aGood && bBad) || (aBad && bGood)) {
          const aLabel = aGood ? 'approves' : 'flags';
          const bLabel = bGood ? 'approves' : 'flags';
          fixtureConflicts.push({
            fixtureId: r.fixtureId,
            reply: bestScored.candidate.text.slice(0, 120),
            judgeA: ja.judge, judgeB: jb.judge,
            scoreA: ja.score, scoreB: jb.score,
            meaning: `${ja.judge} ${aLabel} (${ja.score.toFixed(2)}) but ${jb.judge} ${bLabel} (${jb.score.toFixed(2)})`,
          });
        }
      }
    }
  }

  // Deduplicate by conflict type, show top 10
  const seenConflictTypes = new Set<string>();
  const topConflicts = fixtureConflicts.filter(c => {
    const key = [c.judgeA, c.judgeB].sort().join(':');
    if (seenConflictTypes.has(key)) return false;
    seenConflictTypes.add(key);
    return true;
  }).slice(0, 10);

  if (topConflicts.length === 0) {
    md.push('*No significant judge conflicts detected.*');
  }
  for (let i = 0; i < topConflicts.length; i++) {
    const c = topConflicts[i];
    md.push(`### ${i + 1}. ${c.fixtureId}`);
    md.push('');
    md.push(`**Reply excerpt:** "${c.reply}..."`);
    md.push('');
    md.push(`**Disagreement:** ${c.judgeA} vs ${c.judgeB}`);
    md.push('');
    md.push(`**In plain English:** ${c.meaning}. This means the reply has qualities that one scoring dimension rewards but another penalizes — the weights need balancing for this reply type.`);
    md.push('');
  }

  // Section 5: Tuning recommendations
  md.push('## 5. What to Tune Next');
  md.push('');

  // Analyze regressions for concrete recommendations
  const judgeRegressionCounts = new Map<string, number>();
  for (const r of regressions) {
    for (const j of r.comparison.judgeResults) {
      if (j.winner === 'left') {
        judgeRegressionCounts.set(j.judge, (judgeRegressionCounts.get(j.judge) || 0) + 1);
      }
    }
  }
  const sortedRegJudges = [...judgeRegressionCounts.entries()].sort((a, b) => b[1] - a[1]);

  // Also check which judges improve most
  const judgeImproveCounts = new Map<string, number>();
  for (const r of improvements) {
    for (const j of r.comparison.judgeResults) {
      if (j.winner === 'right') {
        judgeImproveCounts.set(j.judge, (judgeImproveCounts.get(j.judge) || 0) + 1);
      }
    }
  }

  const recommendations: string[] = [];

  if (sortedRegJudges.length > 0) {
    const [topRegJudge, count] = sortedRegJudges[0];
    recommendations.push(`1. **Increase ${topRegJudge} weight** — this judge drove ${count} of the top regressions. Raise \`${topRegJudge}Multiplier\` from current value to ~1.3 in star_tuned.json.`);
  }

  // Check if flatness/brochure penalties are too loose
  const avgFlatness = generatedReplies.reduce((s, r) => s + (r.rightScored.judgeOutputs.find(j => j.judge === 'flatness')?.score ?? 0), 0) / Math.max(1, generatedReplies.length);
  if (avgFlatness > 0.35) {
    recommendations.push(`2. **Tighten flatness threshold** — average flatness score is ${avgFlatness.toFixed(2)}, meaning many replies are generic. Lower \`flatnessMax\` from 0.5 to ~0.35 in star_tuned thresholds.`);
  } else {
    recommendations.push(`2. **Flatness is under control** (avg ${avgFlatness.toFixed(2)}) — focus tuning effort elsewhere.`);
  }

  const avgPull = generatedReplies.reduce((s, r) => s + (r.rightScored.judgeOutputs.find(j => j.judge === 'pull')?.score ?? 0), 0) / Math.max(1, generatedReplies.length);
  if (avgPull < 0.3) {
    recommendations.push(`3. **Boost pull signal** — average pull is ${avgPull.toFixed(2)}. The prompt needs stronger direction to make replies worth answering. Add pull-oriented nudges to lane contracts and raise \`pullMultiplier\` to 1.5.`);
  } else {
    recommendations.push(`3. **Pull is reasonable** (avg ${avgPull.toFixed(2)}) — maintain current pull weights.`);
  }

  if (topConflicts.length > 3) {
    const mostConflicted = topConflicts[0];
    recommendations.push(`4. **Resolve ${mostConflicted.judgeA} vs ${mostConflicted.judgeB} conflict** — these judges disagree most often. One is rewarding what the other penalizes. Review the lane-specific weights for both and reduce the weight of the less important one for the affected lanes.`);
  } else {
    recommendations.push(`4. **Judge agreement is reasonable** — fewer than 3 systematic conflict types found.`);
  }

  // Lane-specific recommendation
  let worstLane: Lane | null = null;
  let worstLaneRatio = Infinity;
  for (const [lane, counts] of laneWins) {
    const ratio = counts.right / Math.max(1, counts.left + counts.right + counts.tie);
    if (ratio < worstLaneRatio) {
      worstLaneRatio = ratio;
      worstLane = lane;
    }
  }
  if (worstLane) {
    recommendations.push(`5. **Focus on ${worstLane} lane** — star-tuned wins only ${(worstLaneRatio * 100).toFixed(0)}% there. Inspect the lane profile (temperature, compression, etc.) and adjust the per-lane thresholds specifically.`);
  }

  for (const rec of recommendations) {
    md.push(rec);
    md.push('');
  }

  // ── Write markdown ─────────────────────────────────────────────────────
  const mdPath = join(latestDir, 'live-pairwise-report.md');
  writeFileSync(mdPath, md.join('\n'), 'utf-8');

  // ── Print to console ───────────────────────────────────────────────────
  console.log('\n' + md.join('\n'));
  console.log(`\nReports written to:`);
  console.log(`  JSON: ${jsonPath}`);
  console.log(`  Markdown: ${mdPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
