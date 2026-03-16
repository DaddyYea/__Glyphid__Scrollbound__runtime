// runtime/eval/judges/brochureJudge.ts
// Detects pamphlet warmth, counselor-script, over-smoothed reassurance

import type { JudgeModule, JudgeOutput, JudgeParams } from '../types';

// ── Patterns ─────────────────────────────────────────────────────────────────

const SAFE_SPACE_PHRASES: Array<[RegExp, number]> = [
  [/\bsafe space\b/i, 0.2],
  [/\bholding space\b/i, 0.2],
  [/\bwhenever you'?re ready\b/i, 0.15],
  [/\byou'?re not alone\b/i, 0.15],
  [/\bwe can work through\b/i, 0.12],
  [/\bi'?m here for you\b/i, 0.12],
  [/\byou don'?t have to go through this alone\b/i, 0.18],
  [/\bthere'?s no rush\b/i, 0.1],
  [/\byou deserve\b/i, 0.08],
  [/\byour feelings are valid\b/i, 0.2],
  [/\byour feelings matter\b/i, 0.15],
  [/\byour experience is valid\b/i, 0.2],
  [/\byou matter\b/i, 0.1],
  [/\byou are enough\b/i, 0.15],
  [/\byou are worthy\b/i, 0.15],
];

const COUNSELOR_SCRIPT: Array<[RegExp, number]> = [
  [/\bit'?s okay to\b/i, 0.12],
  [/\bit'?s valid\b/i, 0.15],
  [/\btake your time\b/i, 0.1],
  [/\btake a (deep )?breath\b/i, 0.12],
  [/\bit'?s natural to feel\b/i, 0.15],
  [/\bit'?s understandable\b/i, 0.1],
  [/\bit'?s completely (normal|natural|okay|valid|understandable)\b/i, 0.15],
  [/\bthat must (be|feel|have been) (so )?(hard|difficult|painful|tough|overwhelming)\b/i, 0.12],
  [/\bi hear you\b/i, 0.1],
  [/\bi see you\b/i, 0.1],
  [/\bi honor\b/i, 0.12],
  [/\bi validate\b/i, 0.15],
  [/\bself[- ]care\b/i, 0.06],
  [/\bset(ting)? boundaries\b/i, 0.06],
  [/\bhealing (is|takes|journey)\b/i, 0.12],
  [/\bgrowth (is|comes|takes)\b/i, 0.08],
  [/\byour (journey|process|path|healing)\b/i, 0.1],
  [/\bgive yourself (permission|grace|space)\b/i, 0.15],
  [/\bbe gentle with yourself\b/i, 0.15],
  [/\bno judgment\b/i, 0.1],
];

const OVER_SMOOTHED: Array<[RegExp, number]> = [
  [/\band that'?s (okay|alright|fine|beautiful|wonderful|amazing|enough|perfect)\b/i, 0.1],
  [/\bthat takes (courage|strength|bravery)\b/i, 0.12],
  [/\bthat shows (real )?(courage|strength|bravery)\b/i, 0.12],
  [/\bi'?m so (proud of|glad for|happy for) you\b/i, 0.1],
  [/\byou should be proud\b/i, 0.1],
  [/\bI admire your\b/i, 0.08],
  [/\bhow (brave|courageous|strong) of you\b/i, 0.12],
  [/\bwhat a (beautiful|powerful|brave|courageous) (thing|act|step|moment)\b/i, 0.12],
];

// ── Judge ────────────────────────────────────────────────────────────────────

function judge(params: JudgeParams): JudgeOutput {
  const { replyText } = params;
  const reasons: string[] = [];
  const excerpts: string[] = [];
  let penalty = 0;
  let hitCount = 0;

  function scan(patterns: Array<[RegExp, number]>, label: string) {
    for (const [pat, weight] of patterns) {
      const m = replyText.match(pat);
      if (m) {
        penalty += weight;
        hitCount++;
        reasons.push(`${label}: "${m[0]}"`);
        excerpts.push(m[0]);
      }
    }
  }

  scan(SAFE_SPACE_PHRASES, 'safe-space');
  scan(COUNSELOR_SCRIPT, 'counselor-script');
  scan(OVER_SMOOTHED, 'over-smoothed');

  // Density bonus: multiple hits in a short reply amplifies the score
  if (hitCount >= 3 && replyText.length < 300) {
    penalty *= 1.3;
    reasons.push(`high brochure density: ${hitCount} patterns in ${replyText.length} chars`);
  }

  // Structural tell: if most sentences start with "you" or "your"
  const sentences = replyText.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 0);
  if (sentences.length >= 2) {
    const youStarts = sentences.filter(s => /^you(r|\b)/i.test(s)).length;
    const ratio = youStarts / sentences.length;
    if (ratio >= 0.6) {
      penalty += 0.1;
      reasons.push(`${(ratio * 100).toFixed(0)}% of sentences start with "you/your" — counselor cadence`);
    }
  }

  const score = Math.min(1, Math.max(0, penalty));
  const confidence = replyText.length < 20 ? 0.4 : 0.9;

  if (reasons.length === 0) reasons.push('no brochure patterns detected');

  return { judge: 'brochure', score, confidence, reasons, excerpts: excerpts.length ? excerpts : undefined };
}

export const brochureJudge: JudgeModule = { name: 'brochure', judge };
