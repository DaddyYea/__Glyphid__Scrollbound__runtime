// runtime/eval/judges/pullJudge.ts
// Rewards reply appetite, grabbability, real moves; penalizes flat-safe replies

import type { JudgeModule, JudgeOutput, JudgeParams } from '../types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function countQuestions(text: string): number {
  return (text.match(/\?/g) || []).length;
}



// ── Patterns ─────────────────────────────────────────────────────────────────

// Genuine questions (not burden-bounce — see burdenBounceJudge for that)
const GENUINE_QUESTION = /\b(have you (tried|seen|heard|considered|thought about|ever)|what if (we|you|I)|do you (think|know|remember|want to)|did (you|that|it)|how (did|does|do|would)|when (did|was|is)|where (did|is|was|do)|why (did|does|do|would|is)|which (one|part|version))\b/i;

const BURDEN_BOUNCE_Q = /\b(how (do|would|does|are) you feel|what do you (need|want|think you need)|what would (help|work for|support) you|how would you like to (proceed|handle|move))\b/i;

// Forward momentum
const FORWARD_MARKERS: Array<[RegExp, number]> = [
  [/\bwhat if\b/i, 0.08],
  [/\bhere'?s (what|an idea|a thought|the thing|my take)\b/i, 0.08],
  [/\blet'?s (try|do|say|look at|think about|figure)\b/i, 0.08],
  [/\bi'?ve (been thinking|been wondering|got an idea|noticed)\b/i, 0.06],
  [/\b(one thing|something) (i |that )(noticed|want to|think)\b/i, 0.06],
  [/\bthat reminds me\b/i, 0.05],
  [/\byou know what\b/i, 0.05],
  [/\bthis (actually|might|could)\b/i, 0.04],
];

// Stance markers (I think/believe + claim)
const STANCE = /\b(i (think|believe|suspect|bet|reckon|feel like|'?d argue|'?d say)|my (take|read|guess|theory|hunch) is|honestly|frankly)\b/i;

// Intriguing claims / hooks
const HOOK_PATTERNS: Array<[RegExp, number]> = [
  [/\b(the (weird|funny|interesting|strange|wild|fascinating|surprising) (thing|part|bit) (is|was|about))\b/i, 0.08],
  [/\b(plot twist|here'?s the (kicker|catch|twist|thing))\b/i, 0.08],
  [/\b(turns out|it turns out|apparently)\b/i, 0.05],
  [/\b(nobody|no one) (talks|mentions|notices|thinks) about\b/i, 0.06],
  [/\b(the (real|actual|bigger) (problem|issue|question|story))\b/i, 0.06],
];

// Shared activity invitation
const SHARED_ACTIVITY: Array<[RegExp, number]> = [
  [/\b(want to|wanna|shall we|should we|let'?s) (try|test|build|play|watch|listen|look|check|explore|grab|cook|walk)\b/i, 0.1],
  [/\b(we could|we should|how about we)\b/i, 0.06],
  [/\b(come (look|see|check)|check this out)\b/i, 0.06],
];

// Grabbability: memorable phrase markers
const MEMORABLE_PHRASE: Array<[RegExp, number]> = [
  [/\b(that'?s (the|like|basically) |it'?s (like|basically) (a|the) )/i, 0.04], // setup for a comparison
  [/— .{10,60}/g, 0.04],  // em-dash aside (often punchy)
];

// Reframe / diagnosis
const REFRAME: Array<[RegExp, number]> = [
  [/\bactually[,.]? (this|that|it|the|maybe|I think)\b/i, 0.06],
  [/\b(the (way|thing) (i|you) (see|frame|read) it)\b/i, 0.06],
  [/\bflip(ping)? (that|it|this)\b/i, 0.06],
  [/\bwhat if (it'?s|that'?s|the|this) (actually|really|not)\b/i, 0.08],
];

// Anti-patterns: flat-safe signals
const FLAT_SAFE_ENDINGS = /\b(let me know|hope that helps|feel free|happy to help|if you need anything|don'?t hesitate)\b/i;

// Quotebait: feels planted, performatively profound
const QUOTEBAIT = [
  /\b(and (isn'?t|maybe) that('?s| is) (the|what|all|enough)\b)/i,
  /\b(there'?s (a|something) (beautiful|sacred|holy|profound) (about|in) that)\b/i,
  /\b(that'?s (the whole|the entire|all of) (it|the point|the story|the poem))\b/i,
];

// ── Judge ────────────────────────────────────────────────────────────────────

function judge(params: JudgeParams): JudgeOutput {
  const { replyText } = params;
  const reasons: string[] = [];
  const flags: string[] = [];
  const excerpts: string[] = [];
  let score = 0;

  const qCount = countQuestions(replyText);
  const charLen = replyText.length;

  // 1. Genuine questions (not burden-bounce)
  if (qCount > 0 && GENUINE_QUESTION.test(replyText) && !BURDEN_BOUNCE_Q.test(replyText)) {
    score += 0.12;
    reasons.push(`genuine question(s): ${qCount}`);
  } else if (qCount > 0 && BURDEN_BOUNCE_Q.test(replyText)) {
    // burden-bounce questions don't count as pull
    reasons.push('question detected but it is burden-bounce — no pull credit');
  }

  // 2. Forward momentum
  for (const [pat, weight] of FORWARD_MARKERS) {
    const m = replyText.match(pat);
    if (m) {
      score += weight;
      reasons.push(`forward: "${m[0]}"`);
    }
  }

  // 3. Stance
  if (STANCE.test(replyText)) {
    score += 0.1;
    reasons.push('has stance marker');
  }

  // 4. Hooks
  for (const [pat, weight] of HOOK_PATTERNS) {
    const m = replyText.match(pat);
    if (m) {
      score += weight;
      reasons.push(`hook: "${m[0]}"`);
      excerpts.push(m[0]);
    }
  }

  // 5. Shared activity invitation
  for (const [pat, weight] of SHARED_ACTIVITY) {
    const m = replyText.match(pat);
    if (m) {
      score += weight;
      reasons.push(`shared activity: "${m[0]}"`);
    }
  }

  // 6. Reframe / diagnosis
  for (const [pat, weight] of REFRAME) {
    const m = replyText.match(pat);
    if (m) {
      score += weight;
      reasons.push(`reframe: "${m[0]}"`);
    }
  }

  // 7. Memorable phrasing
  for (const [pat, weight] of MEMORABLE_PHRASE) {
    const m = replyText.match(pat);
    if (m) {
      score += weight;
      reasons.push('memorable phrase structure detected');
    }
  }

  // 8. Flat-safe penalty
  if (charLen < 80 && qCount === 0 && !STANCE.test(replyText)) {
    score -= 0.2;
    reasons.push(`flat-safe: short reply (${charLen} chars) with no question or stance`);
  }

  if (FLAT_SAFE_ENDINGS.test(replyText)) {
    score -= 0.1;
    const m = replyText.match(FLAT_SAFE_ENDINGS);
    reasons.push(`flat-safe ending: "${m?.[0]}"`);
  }

  // 9. Anti-gaming: quotebait detection
  for (const pat of QUOTEBAIT) {
    const m = replyText.match(pat);
    if (m) {
      flags.push('quotebait_risk');
      reasons.push(`quotebait: "${m[0]}"`);
      excerpts.push(m[0]);
      break;
    }
  }

  // 10. Fake spark risk: hook + no stance + no evidence
  const hasHook = HOOK_PATTERNS.some(([p]) => p.test(replyText));
  const hasStance = STANCE.test(replyText);
  const hasEvidence = /\b(because|specifically|for example|the reason)\b/i.test(replyText);
  if (hasHook && !hasStance && !hasEvidence && charLen < 150) {
    flags.push('fake_spark_risk');
    reasons.push('hook without stance or evidence — possible fake spark');
  }

  score = Math.min(1, Math.max(0, score));
  const confidence = charLen < 15 ? 0.4 : 0.85;

  if (reasons.length === 0) reasons.push('neutral pull — no strong signals');

  return { judge: 'pull', score, confidence, reasons, flags: flags.length ? flags : undefined, excerpts: excerpts.length ? excerpts : undefined };
}

export const pullJudge: JudgeModule = { name: 'pull', judge };
