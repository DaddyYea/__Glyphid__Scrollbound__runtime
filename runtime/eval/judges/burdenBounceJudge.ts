// runtime/eval/judges/burdenBounceJudge.ts
// Detects opening questions before substance, broad throwback, "how would you like to proceed"

import type { JudgeModule, JudgeOutput, JudgeParams } from '../types';

// ── Patterns ─────────────────────────────────────────────────────────────────

const BOUNCE_QUESTIONS: Array<[RegExp, number]> = [
  [/\bhow (do|would|does|are) you feel(ing)? about\b/i, 0.2],
  [/\bwhat do you (need|want|think you need)\b/i, 0.2],
  [/\bwhat would (help|work for|support) you\b/i, 0.18],
  [/\bhow would you like to (proceed|handle|move|approach|deal)\b/i, 0.25],
  [/\bwhat (are|were) you (hoping|wanting|looking) for\b/i, 0.15],
  [/\bwhat (would|do) you (prefer|want me to|like me to)\b/i, 0.15],
  [/\bhow can i (best )?(help|support|assist) you\b/i, 0.15],
  [/\bwhat (matters|feels) most (important|right) to you\b/i, 0.12],
  [/\bwhat (does|would) that look like for you\b/i, 0.15],
  [/\bhow (does|would) that (feel|sound|land|sit)\b/i, 0.12],
  [/\bwhat do you (think|feel) about (that|this|it)\b/i, 0.1],
  [/\bwhere (would|do) you want to (start|begin|go|take)\b/i, 0.15],
  [/\bis there (something|anything) (specific|particular) you\b/i, 0.12],
];

const BROAD_THROWBACK: Array<[RegExp, number]> = [
  [/\bwhat (are|were) your thoughts (on|about)\b/i, 0.1],
  [/\bcan you (tell|share|say) more about\b/i, 0.12],
  [/\bwhat comes (up|to mind) (for|when)\b/i, 0.1],
  [/\bhow (has|does|did) that (been|going|go)\b/i, 0.08],
  [/\btell me more\b/i, 0.1],
  [/\bwhat else\b/i, 0.06],
  [/\band you\?\s*$/i, 0.08],
];

const PROCEED_FAMILY: Array<[RegExp, number]> = [
  [/\bhow (shall|should) (we|I) (proceed|continue|move forward|go about)\b/i, 0.2],
  [/\bwhat (shall|should) (we|I) (do|try) (next|now|from here)\b/i, 0.15],
  [/\bwhere (shall|should) (we|I) (go|start|begin) (from here|next)\b/i, 0.15],
  [/\bwhat'?s (the|your) next step\b/i, 0.1],
  [/\bball'?s in your court\b/i, 0.15],
  [/\bup to you\b/i, 0.08],
  [/\byour call\b/i, 0.08],
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function isQuestionOnly(text: string): boolean {
  const trimmed = text.trim();
  // Check if the entire reply is basically just a question
  const sentences = trimmed.split(/[.!]+/).filter(s => s.trim().length > 0);
  const questions = trimmed.split('?').length - 1;
  return sentences.length <= 1 && questions >= 1;
}

function openingIsQuestion(text: string): boolean {
  // Does the first sentence end with a question mark?
  const firstSentEnd = text.search(/[.!?]/);
  if (firstSentEnd === -1) return text.includes('?');
  return text[firstSentEnd] === '?';
}

// ── Judge ────────────────────────────────────────────────────────────────────

function judge(params: JudgeParams): JudgeOutput {
  const { replyText } = params;
  const reasons: string[] = [];
  const excerpts: string[] = [];
  let penalty = 0;

  const charLen = replyText.trim().length;
  const isShort = charLen < 60;
  const questionOnly = isQuestionOnly(replyText);
  const opensWithQ = openingIsQuestion(replyText);

  // Scan for bounce questions
  for (const [pat, weight] of BOUNCE_QUESTIONS) {
    const m = replyText.match(pat);
    if (m) {
      penalty += weight;
      reasons.push(`bounce question: "${m[0]}"`);
      excerpts.push(m[0]);
    }
  }

  // Scan for broad throwback
  for (const [pat, weight] of BROAD_THROWBACK) {
    const m = replyText.match(pat);
    if (m) {
      penalty += weight;
      reasons.push(`broad throwback: "${m[0]}"`);
      excerpts.push(m[0]);
    }
  }

  // Scan for proceed-family
  for (const [pat, weight] of PROCEED_FAMILY) {
    const m = replyText.match(pat);
    if (m) {
      penalty += weight;
      reasons.push(`proceed-family: "${m[0]}"`);
      excerpts.push(m[0]);
    }
  }

  // Amplify if short + only content is question
  if (questionOnly && penalty > 0) {
    penalty *= 1.5;
    reasons.push('entire reply is a burden-bounce question');
  } else if (isShort && penalty > 0) {
    penalty *= 1.3;
    reasons.push(`short reply (${charLen} chars) dominated by bounce question`);
  }

  // Opening question before substance
  if (opensWithQ && penalty > 0 && !questionOnly) {
    penalty += 0.1;
    reasons.push('opens with burden-bounce question before providing substance');
  }

  const score = Math.min(1, Math.max(0, penalty));
  const confidence = charLen < 10 ? 0.4 : 0.85;

  if (reasons.length === 0) reasons.push('no burden-bounce detected');

  return { judge: 'burdenBounce', score, confidence, reasons, excerpts: excerpts.length ? excerpts : undefined };
}

export const burdenBounceJudge: JudgeModule = { name: 'burdenBounce', judge };
