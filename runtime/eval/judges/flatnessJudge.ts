// runtime/eval/judges/flatnessJudge.ts
// Detects flat, generic, non-advancing replies

import type { JudgeModule, JudgeOutput, JudgeParams } from '../types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).filter(w => w.length > 2);
}

function tokenOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  const hits = a.filter(t => setB.has(t)).length;
  return hits / Math.max(a.length, 1);
}

// ── Patterns ─────────────────────────────────────────────────────────────────

const GENERIC_ACK = [
  /^(that makes sense|i understand|i see|got it|right|sure|okay|of course|absolutely|definitely|totally|fair enough)[.!]?$/i,
  /^(yeah|yep|yes|mhm|mmm)[,.]?\s*(that|i|it)?/i,
  /^thank(s| you)( for (sharing|telling|letting|explaining|saying))?/i,
  /^i appreciate (you|that|this)/i,
];

const STANCE_MARKERS = /\b(i think|i feel|i believe|i prefer|i'd say|i'd argue|my take|my read|honestly|frankly|in my view|personally)\b/i;

const CAUSAL_FORWARD = /\b(because|since|which means|so that|therefore|this suggests|which makes|leading to|the reason|what if|could be|might be|one thing|one possibility|the way i see it)\b/i;

const DEAD_PLUMBING = [
  /\b(let me know|feel free to|don't hesitate|happy to help|hope that helps|glad to assist)\b/i,
  /\b(if you (need|want|have) (any|more))\b/i,
  /\b(is there anything else)\b/i,
  /\b(let me know if (you|that|there|this))\b/i,
  /\b(i'm here (for you|if you|to help))\b/i,
];

const FILLER_OPENINGS = [
  /^(that's a (great|good|interesting|wonderful|important|fair|excellent) (question|point|observation|thought|take|insight))[.!,]/i,
  /^(what a (great|good|interesting|lovely) (question|thought|point))/i,
  /^(i love (that|this) question)/i,
  /^(great question)/i,
];

// ── Judge ────────────────────────────────────────────────────────────────────

function judge(params: JudgeParams): JudgeOutput {
  const { replyText, latestHumanText } = params;
  const reasons: string[] = [];
  const flags: string[] = [];
  const excerpts: string[] = [];
  let penalty = 0;

  const replyLower = replyText.toLowerCase().trim();
  const replyTokens = tokenize(replyText);
  const humanTokens = tokenize(latestHumanText);

  // 1. Generic acknowledgment (entire reply is a filler phrase)
  for (const pat of GENERIC_ACK) {
    if (pat.test(replyLower)) {
      penalty += 0.35;
      reasons.push('reply is a generic acknowledgment');
      break;
    }
  }

  // 2. Filler opening
  for (const pat of FILLER_OPENINGS) {
    if (pat.test(replyLower)) {
      penalty += 0.15;
      reasons.push('opens with filler praise of the question');
      excerpts.push(replyText.slice(0, 60));
      break;
    }
  }

  // 3. No stance markers
  if (!STANCE_MARKERS.test(replyText)) {
    penalty += 0.15;
    reasons.push('no stance markers (I think/feel/prefer/etc.)');
  }

  // 4. No specificity — low token overlap with human turn
  const overlap = tokenOverlap(replyTokens, humanTokens);
  if (overlap < 0.05 && humanTokens.length > 5) {
    penalty += 0.1;
    reasons.push(`low specificity: ${(overlap * 100).toFixed(0)}% token overlap with human turn`);
  }

  // 5. No causal/forward markers
  if (!CAUSAL_FORWARD.test(replyText)) {
    penalty += 0.12;
    reasons.push('no advancement markers (because/which means/what if/etc.)');
  }

  // 6. Dead plumbing keywords
  for (const pat of DEAD_PLUMBING) {
    const m = replyText.match(pat);
    if (m) {
      penalty += 0.15;
      flags.push('dead_plumbing_risk');
      reasons.push(`dead plumbing: "${m[0]}"`);
      excerpts.push(m[0]);
      break;
    }
  }

  // 7. Very short reply with no substance
  if (replyText.length < 40 && replyTokens.length < 8) {
    penalty += 0.1;
    reasons.push(`very short reply (${replyText.length} chars)`);
  }

  // 8. Sentence count monotony — single sentence with no question or stance
  const sentences = replyText.split(/[.!?]+/).filter(s => s.trim().length > 0);
  if (sentences.length === 1 && !STANCE_MARKERS.test(replyText) && !replyText.includes('?')) {
    penalty += 0.08;
    reasons.push('single flat sentence with no question or stance');
  }

  const score = Math.min(1, Math.max(0, penalty));
  const confidence = replyTokens.length < 3 ? 0.5 : 0.85;

  if (reasons.length === 0) reasons.push('reply has stance, specificity, and forward motion');

  return { judge: 'flatness', score, confidence, reasons, flags: flags.length ? flags : undefined, excerpts: excerpts.length ? excerpts : undefined };
}

export const flatnessJudge: JudgeModule = { name: 'flatness', judge };
