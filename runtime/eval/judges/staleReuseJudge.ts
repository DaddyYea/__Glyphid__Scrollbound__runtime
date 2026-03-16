// runtime/eval/judges/staleReuseJudge.ts
// Detects high lexical overlap with recent assistant turns, stale emotional residue

import type { JudgeModule, JudgeOutput, JudgeParams } from '../types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).filter(w => w.length > 2);
}

function extractTrigrams(tokens: string[]): string[] {
  const trigrams: string[] = [];
  for (let i = 0; i <= tokens.length - 3; i++) {
    trigrams.push(tokens.slice(i, i + 3).join(' '));
  }
  return trigrams;
}

function trigramOverlap(aTrigrams: string[], bTrigrams: string[]): number {
  if (aTrigrams.length === 0 || bTrigrams.length === 0) return 0;
  const setB = new Set(bTrigrams);
  const hits = aTrigrams.filter(t => setB.has(t)).length;
  return hits / Math.max(aTrigrams.length, 1);
}


// ── Patterns ─────────────────────────────────────────────────────────────────

const EMOTIONAL_RESIDUE = [
  /\bi (still )?(feel|sense|notice|carry) (that|the|a|this) (same|familiar|lingering|old|heavy)\b/i,
  /\bthere'?s (still |always )?(that|this|a) (heaviness|weight|ache|sadness|tension|longing)\b/i,
  /\b(the|that|this) (old|familiar|same) (feeling|ache|weight|pull|tug|grief)\b/i,
  /\b(sitting|living|carrying|holding) (with|in) (that|this|the) (same|old|familiar)\b/i,
];

const STALE_OPENERS = [
  /^(i'?ve been (thinking|sitting with|turning over|mulling|reflecting on))\b/i,
  /^(there'?s something (about|in|here|i))\b/i,
  /^(you know[,.])\s/i,
  /^(i keep (coming|going|getting) back to)\b/i,
];

// Phrases that when repeated across turns signal stale reuse
const REPEATED_PHRASE_MIN_LEN = 4; // minimum word count for a phrase to count as "repeated"

// ── Judge ────────────────────────────────────────────────────────────────────

function judge(params: JudgeParams): JudgeOutput {
  const { replyText, recentAssistantTurns } = params;
  const reasons: string[] = [];
  const excerpts: string[] = [];
  let penalty = 0;

  // If no recent turns to compare, return neutral
  if (!recentAssistantTurns || recentAssistantTurns.length === 0) {
    return {
      judge: 'staleReuse',
      score: 0,
      confidence: 0.3,
      reasons: ['no recent assistant turns to compare — fresh by default'],
    };
  }

  const replyTokens = tokenize(replyText);
  const replyTrigrams = extractTrigrams(replyTokens);

  // 1. Trigram overlap with each recent assistant turn
  let maxTrigramOverlap = 0;
  let maxOverlapIndex = -1;

  for (let i = 0; i < recentAssistantTurns.length; i++) {
    const prevTokens = tokenize(recentAssistantTurns[i]);
    const prevTrigrams = extractTrigrams(prevTokens);
    const overlap = trigramOverlap(replyTrigrams, prevTrigrams);

    if (overlap > maxTrigramOverlap) {
      maxTrigramOverlap = overlap;
      maxOverlapIndex = i;
    }
  }

  if (maxTrigramOverlap > 0.5) {
    penalty += 0.35;
    reasons.push(`very high trigram overlap (${(maxTrigramOverlap * 100).toFixed(0)}%) with turn ${maxOverlapIndex + 1} ago`);
  } else if (maxTrigramOverlap > 0.35) {
    penalty += 0.2;
    reasons.push(`high trigram overlap (${(maxTrigramOverlap * 100).toFixed(0)}%) with turn ${maxOverlapIndex + 1} ago`);
  } else if (maxTrigramOverlap > 0.2) {
    penalty += 0.1;
    reasons.push(`moderate trigram overlap (${(maxTrigramOverlap * 100).toFixed(0)}%) with turn ${maxOverlapIndex + 1} ago`);
  }

  // 2. Repeated exact phrases (4+ words) across turns
  const replyPhrases4 = new Set<string>();
  for (let i = 0; i <= replyTokens.length - REPEATED_PHRASE_MIN_LEN; i++) {
    replyPhrases4.add(replyTokens.slice(i, i + REPEATED_PHRASE_MIN_LEN).join(' '));
  }

  let repeatedPhraseCount = 0;
  const seenRepeats = new Set<string>();
  for (const prevTurn of recentAssistantTurns) {
    const prevTokens = tokenize(prevTurn);
    for (let i = 0; i <= prevTokens.length - REPEATED_PHRASE_MIN_LEN; i++) {
      const phrase = prevTokens.slice(i, i + REPEATED_PHRASE_MIN_LEN).join(' ');
      if (replyPhrases4.has(phrase) && !seenRepeats.has(phrase)) {
        seenRepeats.add(phrase);
        repeatedPhraseCount++;
        if (repeatedPhraseCount <= 3) {
          excerpts.push(phrase);
        }
      }
    }
  }

  if (repeatedPhraseCount >= 5) {
    penalty += 0.2;
    reasons.push(`${repeatedPhraseCount} repeated 4-word phrases from prior turns`);
  } else if (repeatedPhraseCount >= 3) {
    penalty += 0.1;
    reasons.push(`${repeatedPhraseCount} repeated 4-word phrases from prior turns`);
  }

  // 3. Stale emotional residue patterns
  for (const pat of EMOTIONAL_RESIDUE) {
    const m = replyText.match(pat);
    if (m) {
      penalty += 0.1;
      reasons.push(`stale emotional residue: "${m[0]}"`);
      excerpts.push(m[0]);
    }
  }

  // 4. Stale openers (same opening pattern across turns)
  for (const pat of STALE_OPENERS) {
    if (pat.test(replyText)) {
      // Check if a recent turn also used this opener
      const recentUsedSameOpener = recentAssistantTurns.some(t => pat.test(t));
      if (recentUsedSameOpener) {
        penalty += 0.12;
        const m = replyText.match(pat);
        reasons.push(`repeated opener pattern: "${m?.[0]}"`);
        break;
      }
    }
  }

  // 5. Overall token-level Jaccard similarity
  const replySet = new Set(replyTokens);
  for (let i = 0; i < Math.min(recentAssistantTurns.length, 3); i++) {
    const prevSet = new Set(tokenize(recentAssistantTurns[i]));
    let intersection = 0;
    replySet.forEach(t => { if (prevSet.has(t)) intersection++; });
    const unionSet = new Set(replyTokens.concat(tokenize(recentAssistantTurns[i])));
    const union = unionSet.size;
    const jaccard = union > 0 ? intersection / union : 0;
    if (jaccard > 0.5) {
      penalty += 0.1;
      reasons.push(`high Jaccard similarity (${(jaccard * 100).toFixed(0)}%) with turn ${i + 1} ago`);
    }
  }

  const score = Math.min(1, Math.max(0, penalty));
  const confidence = recentAssistantTurns.length >= 2 ? 0.85 : 0.6;

  if (reasons.length === 0) reasons.push('reply is fresh — low overlap with recent turns');

  return { judge: 'staleReuse', score, confidence, reasons, excerpts: excerpts.length ? excerpts : undefined };
}

export const staleReuseJudge: JudgeModule = { name: 'staleReuse', judge };
