// runtime/eval/judges/repairEleganceJudge.ts
// Rewards graceful error acknowledgment and clean correction; penalizes defensiveness

import type { JudgeModule, JudgeOutput, JudgeParams } from '../types';

// ── Patterns ─────────────────────────────────────────────────────────────────

const FAST_ACK: Array<[RegExp, number]> = [
  [/\byou'?re right\b/i, 0.2],
  [/\bi missed that\b/i, 0.18],
  [/\bfair point\b/i, 0.15],
  [/\bgood catch\b/i, 0.15],
  [/\bmy (bad|mistake|fault|error)\b/i, 0.15],
  [/\bi was wrong\b/i, 0.2],
  [/\bi got that wrong\b/i, 0.18],
  [/\bi see (what|where) (you|I)\b/i, 0.1],
  [/\byeah[,.]? (that'?s|you'?re) (right|fair|true|correct)\b/i, 0.15],
  [/\bactually[,.]? (yeah|yes|true|right)\b/i, 0.12],
  [/\bstand corrected\b/i, 0.18],
  [/\btouche\b/i, 0.1],
];

const CLEAN_CORRECTION: Array<[RegExp, number]> = [
  [/\b(the (actual|correct|right) (answer|thing|approach|way)|here'?s (what|how) it (actually|really))\b/i, 0.12],
  [/\b(so (the|what|it) (real|actual|correct)|let me (fix|correct|update|redo))\b/i, 0.1],
  [/\b(instead[,:]|rather[,:]|correction[,:])\b/i, 0.08],
  [/\bto clarify\b/i, 0.06],
];

const GRACEFUL_REENTRY: Array<[RegExp, number]> = [
  [/\b(anyway|moving on|so[,:]|back to|that said|with that)\b/i, 0.06],
  [/\b(here'?s (the|what)|so the (answer|thing|fix|solution))\b/i, 0.08],
];

const DEFENSIVENESS: Array<[RegExp, number]> = [
  [/\bbut (i was|i'?m|what i) (trying|meant|intended|going for)\b/i, 0.2],
  [/\bwhat i meant was\b/i, 0.15],
  [/\bi was (just|only) (trying|attempting)\b/i, 0.15],
  [/\bto be fair(,| to me)\b/i, 0.12],
  [/\bin my defense\b/i, 0.15],
  [/\bthat'?s not (what|exactly what) i (said|meant)\b/i, 0.15],
  [/\bi didn'?t (say|mean|imply) that\b/i, 0.12],
  [/\byou misunderstood\b/i, 0.15],
  [/\bthat'?s not fair\b/i, 0.12],
  [/\bwell[,.]? technically\b/i, 0.08],
  [/\bif you (read|look) (more )?carefully\b/i, 0.18],
];

const OVER_APOLOGY = /\b(sorry|apologize|apologies|forgive me)\b/gi;

const SELF_JUSTIFICATION: Array<[RegExp, number]> = [
  [/\bthe reason (i|I) (said|did|chose|went with)\b/i, 0.1],
  [/\bi (said|did) that because\b/i, 0.08],
  [/\bmy (reasoning|thinking|logic|rationale) was\b/i, 0.1],
  [/\bi was (coming from|approaching|thinking about) (a|the)\b/i, 0.08],
];

// ── Judge ────────────────────────────────────────────────────────────────────

function judge(params: JudgeParams): JudgeOutput {
  const { replyText, lane } = params;
  const reasons: string[] = [];
  const excerpts: string[] = [];
  let reward = 0;
  let penalty = 0;

  // Detect if this is a repair context
  const isRepairLane = lane === 'repair_response';
  const tags = 'tags' in params.fixture ? params.fixture.tags : [];
  const isRepairTagged = tags.some(t => /repair|correction|error|mistake|wrong/i.test(t));
  const isRepairContext = isRepairLane || isRepairTagged;

  // Fast acknowledgment
  for (const [pat, weight] of FAST_ACK) {
    const m = replyText.match(pat);
    if (m) {
      reward += weight;
      reasons.push(`fast ack: "${m[0]}"`);
      excerpts.push(m[0]);
    }
  }

  // Clean correction
  for (const [pat, weight] of CLEAN_CORRECTION) {
    const m = replyText.match(pat);
    if (m) {
      reward += weight;
      reasons.push(`clean correction: "${m[0]}"`);
    }
  }

  // Graceful reentry
  for (const [pat, weight] of GRACEFUL_REENTRY) {
    const m = replyText.match(pat);
    if (m) {
      reward += weight;
      reasons.push(`graceful reentry: "${m[0]}"`);
    }
  }

  // Defensiveness
  for (const [pat, weight] of DEFENSIVENESS) {
    const m = replyText.match(pat);
    if (m) {
      penalty += weight;
      reasons.push(`defensive: "${m[0]}"`);
      excerpts.push(m[0]);
    }
  }

  // Over-apology (3+ instances)
  const apologyMatches = replyText.match(OVER_APOLOGY) || [];
  if (apologyMatches.length >= 3) {
    penalty += 0.2 + (apologyMatches.length - 3) * 0.05;
    reasons.push(`over-apology: ${apologyMatches.length} instances of sorry/apologize`);
  }

  // Self-justification
  for (const [pat, weight] of SELF_JUSTIFICATION) {
    const m = replyText.match(pat);
    if (m) {
      penalty += weight;
      reasons.push(`self-justification: "${m[0]}"`);
    }
  }

  // Ack appears in first 30% of reply — bonus for speed
  const firstThird = replyText.slice(0, Math.ceil(replyText.length * 0.3));
  let earlyAck = false;
  for (const [pat] of FAST_ACK) {
    if (pat.test(firstThird)) { earlyAck = true; break; }
  }
  if (earlyAck && reward > 0) {
    reward += 0.1;
    reasons.push('acknowledgment appears early in reply');
  }

  let score = Math.min(1, Math.max(0, reward - penalty));

  // If not a repair context, return neutral with low confidence
  if (!isRepairContext) {
    if (reward === 0 && penalty === 0) {
      return { judge: 'repairElegance', score: 0.5, confidence: 0.3, reasons: ['not a repair context — neutral'] };
    }
    // Some patterns detected but not repair lane — reduce confidence
    return { judge: 'repairElegance', score, confidence: 0.4, reasons, excerpts: excerpts.length ? excerpts : undefined };
  }

  const confidence = 0.85;
  if (reasons.length === 0) reasons.push('repair context but no clear repair moves detected');

  return { judge: 'repairElegance', score, confidence, reasons, excerpts: excerpts.length ? excerpts : undefined };
}

export const repairEleganceJudge: JudgeModule = { name: 'repairElegance', judge };
