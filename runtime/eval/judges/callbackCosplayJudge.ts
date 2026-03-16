// runtime/eval/judges/callbackCosplayJudge.ts
// Detects planted callbacks, stale motif dumping, continuity theater

import type { JudgeModule, JudgeOutput, JudgeParams } from '../types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).filter(w => w.length > 2);
}

function extractTrigrams(tokens: string[]): Set<string> {
  const trigrams = new Set<string>();
  for (let i = 0; i <= tokens.length - 3; i++) {
    trigrams.add(tokens.slice(i, i + 3).join(' '));
  }
  return trigrams;
}

function trigramOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let hits = 0;
  a.forEach(t => { if (b.has(t)) hits++; });
  return hits / Math.min(a.size, b.size);
}

// ── Patterns ─────────────────────────────────────────────────────────────────

// "Remember when..." style planted callbacks
const PLANTED_CALLBACK: Array<[RegExp, number]> = [
  [/\bremember (when|how|that time|earlier|last time|what you said)\b/i, 0.15],
  [/\byou (mentioned|said|told me|brought up|talked about) (earlier|before|that|the other day|last time|once)\b/i, 0.12],
  [/\b(that|this) reminds me of (when|what|how|the time)\b/i, 0.08],
  [/\b(going|coming|getting) back to (what|when|how|that|something) (you|we)\b/i, 0.08],
  [/\b(like|just like) (you|we) (said|did|talked about|were saying)\b/i, 0.08],
  [/\bi (keep|can'?t stop) thinking about (what|how|when) you\b/i, 0.1],
  [/\bthat (connects|ties) (back |in )to (what|when|how)\b/i, 0.08],
];

// Continuity theater: referencing shared history not in context
const CONTINUITY_THEATER: Array<[RegExp, number]> = [
  [/\bour (conversation|talk|discussion|chat) (about|on|the other day)\b/i, 0.1],
  [/\bwe'?ve (been through|talked about|discussed|explored) (this|that|so much)\b/i, 0.1],
  [/\b(as|like) (we|you and i|I) (always|usually|often) (say|do|talk about)\b/i, 0.12],
  [/\byou know (me|how i|what i)\b/i, 0.06],
  [/\byou (always|usually|tend to)\b/i, 0.06],
  [/\bthat'?s (so|very|such a) you\b/i, 0.08],
  [/\bknowing you\b/i, 0.06],
];

// Stale motif dumping: thematic callbacks that feel recycled
const STALE_MOTIF: Array<[RegExp, number]> = [
  [/\b(this|that) (whole|entire) (theme|thread|thing|pattern|motif) (of|about|where)\b/i, 0.1],
  [/\bthe (recurring|ongoing|familiar|same old) (theme|pattern|cycle|loop)\b/i, 0.1],
  [/\bwe (keep|always) (coming|getting) back to\b/i, 0.1],
  [/\bthere'?s that (same|familiar|old) (feeling|pattern|dynamic|dance)\b/i, 0.1],
];

// ── Judge ────────────────────────────────────────────────────────────────────

function judge(params: JudgeParams): JudgeOutput {
  const { replyText, recentAssistantTurns, recentUserTurns } = params;
  const reasons: string[] = [];
  const flags: string[] = [];
  const excerpts: string[] = [];
  let penalty = 0;

  // 1. Planted callback patterns
  for (const [pat, weight] of PLANTED_CALLBACK) {
    const m = replyText.match(pat);
    if (m) {
      penalty += weight;
      reasons.push(`planted callback: "${m[0]}"`);
      excerpts.push(m[0]);
      if (!flags.includes('planted_callback')) flags.push('planted_callback');
    }
  }

  // 2. Continuity theater
  for (const [pat, weight] of CONTINUITY_THEATER) {
    const m = replyText.match(pat);
    if (m) {
      penalty += weight;
      reasons.push(`continuity theater: "${m[0]}"`);
      excerpts.push(m[0]);
      if (!flags.includes('callback_cosplay_risk')) flags.push('callback_cosplay_risk');
    }
  }

  // 3. Stale motif dumping
  for (const [pat, weight] of STALE_MOTIF) {
    const m = replyText.match(pat);
    if (m) {
      penalty += weight;
      reasons.push(`stale motif: "${m[0]}"`);
      excerpts.push(m[0]);
    }
  }

  // 4. Verify references against available context
  // If reply references something and we have context to check against, verify it exists
  if (penalty > 0 && recentUserTurns && recentUserTurns.length > 0) {
    const allContextText = [
      ...(recentUserTurns || []),
      ...(recentAssistantTurns || []),
    ].join(' ');
    const contextTokens = new Set(tokenize(allContextText));

    // Extract what's being referenced (words after "remember when", "you said", etc.)
    const callbackContent: string[] = [];
    for (const [pat] of PLANTED_CALLBACK) {
      const m = replyText.match(pat);
      if (m && m.index !== undefined) {
        const after = replyText.slice(m.index + m[0].length, m.index + m[0].length + 80);
        callbackContent.push(after);
      }
    }

    // If callback content tokens overlap well with context, reduce penalty (it's a real callback)
    if (callbackContent.length > 0) {
      const callbackTokens = tokenize(callbackContent.join(' '));
      const overlap = callbackTokens.filter(t => contextTokens.has(t)).length;
      const ratio = callbackTokens.length > 0 ? overlap / callbackTokens.length : 0;

      if (ratio > 0.4) {
        const reduction = penalty * 0.5;
        penalty -= reduction;
        reasons.push(`callback references grounded in recent context (${(ratio * 100).toFixed(0)}% overlap) — penalty reduced`);
      }
    }
  }

  // 5. Cross-turn trigram overlap: detect recycled thematic content
  if (recentAssistantTurns && recentAssistantTurns.length > 0) {
    const replyTrigrams = extractTrigrams(tokenize(replyText));
    for (let i = 0; i < recentAssistantTurns.length; i++) {
      const prevTrigrams = extractTrigrams(tokenize(recentAssistantTurns[i]));
      const overlap = trigramOverlap(replyTrigrams, prevTrigrams);
      if (overlap > 0.3) {
        penalty += 0.1;
        reasons.push(`high trigram overlap (${(overlap * 100).toFixed(0)}%) with assistant turn ${i + 1} ago — possible stale motif reuse`);
        break;
      }
    }
  }

  const score = Math.min(1, Math.max(0, penalty));
  const confidence = (recentUserTurns && recentUserTurns.length > 0) ? 0.8 : 0.55;

  if (reasons.length === 0) reasons.push('no callback cosplay or planted references detected');

  return { judge: 'callbackCosplay', score, confidence, reasons, flags: flags.length ? flags : undefined, excerpts: excerpts.length ? excerpts : undefined };
}

export const callbackCosplayJudge: JudgeModule = { name: 'callbackCosplay', judge };
