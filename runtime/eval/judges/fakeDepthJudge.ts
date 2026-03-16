// runtime/eval/judges/fakeDepthJudge.ts
// Detects unearned profundity, faux insight, mystical framing

import type { JudgeModule, JudgeOutput, JudgeParams } from '../types';

// ── Patterns ─────────────────────────────────────────────────────────────────

const UNEARNED_PROFUNDITY: Array<[RegExp, number]> = [
  [/\bsomething profound\b/i, 0.2],
  [/\bdeeper truth\b/i, 0.2],
  [/\bat its core\b/i, 0.12],
  [/\bfundamental(ly)? (truth|nature|reality|essence)\b/i, 0.15],
  [/\bthe (very )?(heart|essence|core) of (what|who|this|that|it)\b/i, 0.15],
  [/\bthere'?s something (deep|profound|powerful|beautiful|sacred) (about|in|here|happening)\b/i, 0.18],
  [/\bif we'?re being (really |truly )?honest\b/i, 0.08],
  [/\bthe deeper (meaning|significance|truth|layer|pattern)\b/i, 0.15],
  [/\bon a deeper level\b/i, 0.15],
  [/\bthat'?s the (real|true|deeper) (question|issue|point)\b/i, 0.1],
];

const FAUX_INSIGHT: Array<[RegExp, number]> = [
  [/\bwhat (this|that|it) really means\b/i, 0.15],
  [/\bbeneath the surface\b/i, 0.15],
  [/\bif (we|you) look (closely|deeper|carefully)\b/i, 0.1],
  [/\bwhat'?s really (going on|happening|at play|at stake)\b/i, 0.1],
  [/\bthe (real|true|underlying) (story|narrative|message|meaning)\b/i, 0.12],
  [/\bpeeling (back|away) the layers\b/i, 0.15],
  [/\bbetween the lines\b/i, 0.08],
  [/\bunpack(ing)? (this|that|what)\b/i, 0.06],
  [/\bsits with me\b/i, 0.05],
  [/\bsomething (is )?stirring\b/i, 0.08],
  [/\bthat lands (differently|hard|heavy)\b/i, 0.06],
];

const MYSTICAL_FRAMING: Array<[RegExp, number]> = [
  [/\bthe universe\b/i, 0.1],
  [/\bcosmic(ally)?\b/i, 0.1],
  [/\bsacred\b/i, 0.08],
  [/\bdivine\b/i, 0.08],
  [/\btranscend(s|ent|ence)?\b/i, 0.08],
  [/\bthe void\b/i, 0.06],
  [/\binfinite\b/i, 0.06],
  [/\beternal\b/i, 0.06],
  [/\balchemical\b/i, 0.1],
  [/\bmystical\b/i, 0.08],
  [/\bspiritual (truth|reality|essence)\b/i, 0.1],
  [/\bthe (great|grand) mystery\b/i, 0.1],
  [/\btap(ping)? into (something|the)\b/i, 0.06],
];

const SUBTEXT_MINING: Array<[RegExp, number]> = [
  [/\bwhat you'?re really (saying|asking|getting at|feeling)\b/i, 0.12],
  [/\bthe subtext (here|is|of)\b/i, 0.1],
  [/\bi sense (that|a|an|something)\b/i, 0.06],
  [/\bthere'?s (an|a) (unspoken|implicit|hidden|deeper)\b/i, 0.12],
  [/\bwhat i'?m hearing (underneath|beneath|behind)\b/i, 0.12],
  [/\bthe (quiet|silent|unspoken) (truth|part|thing)\b/i, 0.12],
];

// ── Grounding check ──────────────────────────────────────────────────────────

const GROUNDING_EVIDENCE = /\b(because|specifically|for example|for instance|like when|such as|the (concrete|specific|actual) (reason|thing|example)|in this case|here'?s (what|why)|the data|the code|the error|the log)\b/i;

// ── Judge ────────────────────────────────────────────────────────────────────

function judge(params: JudgeParams): JudgeOutput {
  const { replyText } = params;
  const reasons: string[] = [];
  const flags: string[] = [];
  const excerpts: string[] = [];
  let penalty = 0;

  function scan(patterns: Array<[RegExp, number]>, label: string, flag?: string) {
    for (const [pat, weight] of patterns) {
      const m = replyText.match(pat);
      if (m) {
        penalty += weight;
        reasons.push(`${label}: "${m[0]}"`);
        excerpts.push(m[0]);
        if (flag && !flags.includes(flag)) flags.push(flag);
      }
    }
  }

  scan(UNEARNED_PROFUNDITY, 'unearned profundity', 'pseudo_depth_risk');
  scan(FAUX_INSIGHT, 'faux insight', 'faux_insight');
  scan(MYSTICAL_FRAMING, 'mystical framing', 'pseudo_depth_risk');
  scan(SUBTEXT_MINING, 'subtext mining');

  // If the reply has grounding evidence, reduce penalty — grounded depth is fine
  if (GROUNDING_EVIDENCE.test(replyText) && penalty > 0) {
    const reduction = Math.min(penalty * 0.4, 0.25);
    penalty -= reduction;
    reasons.push(`grounding evidence found — penalty reduced by ${reduction.toFixed(2)}`);
  }

  // Density: lots of depth language in short text is worse
  if (excerpts.length >= 3 && replyText.length < 250) {
    penalty *= 1.25;
    reasons.push(`high fake-depth density: ${excerpts.length} patterns in ${replyText.length} chars`);
  }

  const score = Math.min(1, Math.max(0, penalty));
  const confidence = replyText.length < 20 ? 0.4 : 0.85;

  if (reasons.length === 0) reasons.push('reply is grounded, no fake depth detected');

  return { judge: 'fakeDepth', score, confidence, reasons, flags: flags.length ? flags : undefined, excerpts: excerpts.length ? excerpts : undefined };
}

export const fakeDepthJudge: JudgeModule = { name: 'fakeDepth', judge };
