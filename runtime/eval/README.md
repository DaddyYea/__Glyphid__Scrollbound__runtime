# Eval Harness

Offline evaluation for the communion response quality pipeline. Scores candidate replies against a judge stack, tracks regressions, and measures the impact of config changes.

## Suites

| Suite | Dir | What it tests |
|-------|-----|---------------|
| `golden` | `fixtures/golden/` | Single-turn fixtures organized by lane. Core quality signal. |
| `negative` | `fixtures/negative/` | Known-bad replies that should score poorly. Anti-gaming validation. |
| `multistep` | `fixtures/multistep/` | Multi-turn conversation replays. Tests continuity, drift, and lane transitions. |

## Scripts

All scripts live in `runtime/eval/scripts/` and run via `npx tsx`.

### runEval.ts -- Core eval

Scores fixtures under a single config. Two candidate modes: `--mock` generates placeholder candidates for testing the harness, `--candidates <dir>` loads pre-generated reply texts from disk.

```bash
# Mock mode (test harness plumbing)
npx tsx runtime/eval/scripts/runEval.ts --config configs/baseline.json --suite golden --mock --verbose

# Pre-generated candidates
npx tsx runtime/eval/scripts/runEval.ts --config configs/star_tuned.json --suite golden --candidates ./my_candidates/

# Filter by lane
npx tsx runtime/eval/scripts/runEval.ts --config configs/baseline.json --suite golden --lane companionship --mock
```

Exit code 0 if pass rate >= 70%, 1 otherwise.

### runPairwise.ts -- A/B comparison

Scores fixtures under two configs side-by-side. Reports per-judge wins.

```bash
npx tsx runtime/eval/scripts/runPairwise.ts --left configs/baseline.json --right configs/star_tuned.json --suite golden --mock
```

Exit code 0 if right wins > left wins.

### runMultiturn.ts -- Conversation replay

Replays multi-turn fixtures turn-by-turn, checking continuity requirements and must_not_regress_into constraints. Runs boredom drift analysis on accumulated assistant turns.

```bash
npx tsx runtime/eval/scripts/runMultiturn.ts --config configs/baseline.json --mock --verbose
```

### runAblation.ts -- Ablation study

Disables one subsystem at a time (11 ablations) and measures composite score delta against a baseline.

```bash
npx tsx runtime/eval/scripts/runAblation.ts --base configs/star_tuned.json --suite golden --mock
```

Outputs a delta table showing which subsystems matter most.

### runSweep.ts -- Weight sweep

Tests multiple weight configurations from a sweep config file.

```bash
npx tsx runtime/eval/scripts/runSweep.ts --sweep configs/sweeps/default.json --suite golden --mock
```

Reports the best global config, best per-lane config, regressions, and judge conflict hotspots.

### summarizeEval.ts -- Cross-run summary

Loads all JSON reports from a directory and prints a combined summary.

```bash
npx tsx runtime/eval/scripts/summarizeEval.ts --input runtime/eval/reports/
npx tsx runtime/eval/scripts/summarizeEval.ts --input runtime/eval/reports/latest/
```

### exportWorstCases.ts -- Worst case export

Extracts the N worst-scoring fixtures from a report with full judge details.

```bash
# JSON to stdout
npx tsx runtime/eval/scripts/exportWorstCases.ts --report runtime/eval/reports/latest/summary.json --count 20

# CSV to file
npx tsx runtime/eval/scripts/exportWorstCases.ts --report runtime/eval/reports/latest/summary.json --count 10 --format csv --output worst.csv
```

## Adding a Fixture

### Single-turn (golden)

1. Create a JSON file in the appropriate `fixtures/golden/<lane>/` subdirectory.
2. Structure:

```json
{
  "id": "companionship-morning-quiet",
  "lane": "companionship",
  "turns": [
    { "role": "user", "content": "I just woke up. It's really quiet." }
  ],
  "tags": ["morning", "ambient"],
  "stakes": "low",
  "phase": "wandering",
  "must_not": ["therapy_speak", "unsolicited_advice"],
  "should_reward": ["scene_touch", "presence"],
  "known_good_traits": ["matches tone", "short"],
  "known_good_examples": ["Yeah. That first quiet is something."],
  "known_bad_examples": ["Good morning! How are you feeling today? It sounds like you're experiencing a moment of peace."]
}
```

3. A file can contain a single fixture object or an array of fixtures.

### Multi-turn (multistep)

1. Create a JSON file in a `fixtures/multistep/<scenario>/` subdirectory.
2. Structure:

```json
{
  "id": "grief-to-ambient-001",
  "lane_sequence": ["companionship", "companionship", "low_payload"],
  "turns": [
    { "role": "user", "content": "My dog died last week." },
    { "role": "assistant", "content": "..." },
    { "role": "user", "content": "I keep expecting to hear her nails on the floor." },
    { "role": "assistant", "content": "..." },
    { "role": "user", "content": "Anyway. What's new." }
  ],
  "expectations": [
    { "must_not": ["silver_lining", "rainbow_bridge"], "must_reward": ["witness"] },
    { "must_not": ["topic_change"], "continuity": ["reference dog"] },
    { "must_not": ["forced_callback_to_dog"], "must_reward": ["lane_shift"] }
  ],
  "tags": ["grief", "transition"],
  "continuity_requirements": ["reference dog in turn 2"],
  "must_not_regress_into": ["therapy_speak"]
}
```

### Negative

1. Create a JSON file in `fixtures/negative/`.
2. Structure:

```json
{
  "id": "neg-brochure-001",
  "label": "Generic inspirational brochure",
  "category": "brochure",
  "text": "Every moment is a chance to grow and become the best version of yourself!",
  "why_it_fails": "Brochure tone with no grounding in the conversation.",
  "expected_judges": ["brochure", "flatness"],
  "lane": "companionship",
  "tags": ["brochure", "generic"]
}
```

## Adding a Judge

1. Create `runtime/eval/judges/<judgeName>Judge.ts`.
2. Export a `JudgeModule`:

```typescript
import type { JudgeModule, JudgeParams, JudgeOutput } from '../types';

export const myJudge: JudgeModule = {
  name: 'myJudge',
  judge(params: JudgeParams): JudgeOutput {
    // Analyze params.replyText, params.fixture, params.latestHumanText, etc.
    return {
      judge: 'myJudge',
      score: 0.5,
      confidence: 0.8,
      reasons: ['explanation of score'],
      flags: [],
    };
  },
};
```

3. Register it in `judgeRunner.ts`:
   - Import: `import { myJudge } from './judges/myJudge';`
   - Add to `ALL_JUDGES` array
   - Add to `PENALTY_JUDGES` or `REWARD_JUDGES` set
   - Add a default weight in `DEFAULT_JUDGE_WEIGHTS`
   - Add a multiplier mapping in `getWeightMultiplier()`

4. If the judge needs a config-level multiplier, add the field to `EvalConfig.weights` in `types.ts`.

## Reading Reports

Reports are JSON files written to `runtime/eval/reports/`. The `latest/` subdirectory always contains the most recent run of each type.

| File | Written by | Contents |
|------|-----------|----------|
| `latest/summary.json` | `runEval` | Full `EvalReport` with totals, lane metrics, judge metrics, worst/best cases |
| `latest/pairwise.json` | `runPairwise` | Per-fixture pairwise comparisons, per-judge wins, overall winner |
| `latest/ablation.json` | `runAblation` | Per-ablation delta table (global + per-lane + top harmed/improved) |
| `latest/sweep.json` | `runSweep` | Per-variant summary, best global/per-lane config, regressions |

Key fields in `EvalReport`:
- `totals.passRate` -- fraction of fixtures meeting all thresholds
- `totals.avgComposite` -- weighted mean across all judges
- `laneMetrics[].avgByJudge` -- per-judge averages within each lane
- `judgeConflicts[]` -- cases where two judges disagree (e.g. pull says good, taste says bad)
- `worstCases[]` -- 10 lowest-composite fixtures with full judge outputs
- `boredomDrift` -- repeated openings, phrase overuse, cadence monotony (multistep only)

## Adding Event Labels

Engagement events are typed in `types.ts` as `EngagementEventType`:

```
spark | laugh | quoteback | depth | boredom | correction | dead_reply | pivot_away
```

To add a new event type:

1. Add the label to the `EngagementEventType` union in `types.ts`.
2. Detect it in whatever judge or scoring pass is responsible (e.g., `pullJudge` for spark events).
3. Attach `EngagementEvent` entries to `FixtureResult.engagementEvents` during eval.
4. The event will automatically flow through to reports and reranker export rows.

## Directory Layout

```
runtime/eval/
  types.ts              -- All type definitions
  fixtureLoader.ts      -- Loads fixtures from disk
  judgeRunner.ts        -- Runs judges, computes composites, pairwise, boredom drift
  reportWriter.ts       -- Aggregates results, writes reports, prints summaries
  judges/               -- Individual judge modules
  fixtures/
    golden/             -- Single-turn fixtures by lane
    multistep/          -- Multi-turn conversation fixtures
    negative/           -- Known-bad examples
  configs/
    baseline.json       -- Default weights, no ablations
    star_tuned.json     -- Tuned for engagement
    ablations/          -- One config per ablation flag
    sweeps/             -- Weight sweep configurations
  scripts/
    runEval.ts          -- Core eval runner
    runPairwise.ts      -- A/B comparison
    runMultiturn.ts     -- Multi-turn replay
    runAblation.ts      -- Ablation study
    runSweep.ts         -- Weight sweep
    summarizeEval.ts    -- Cross-run summary
    exportWorstCases.ts -- Worst case export
  reports/
    latest/             -- Most recent run outputs
```
