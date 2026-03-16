// runtime/eval/judges/tasteJudge.ts
// Rewards sharp clean lines, earned images, elegant compression
// Penalizes clunky phrasing, obviousness, corniness, purple prose, underwriting

import type { JudgeModule, JudgeOutput, JudgeParams } from '../types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

function avgSentenceLength(sents: string[]): number {
  if (sents.length === 0) return 0;
  return sents.reduce((sum, s) => sum + wordCount(s), 0) / sents.length;
}

function sentenceLengthVariance(sents: string[]): number {
  if (sents.length < 2) return 0;
  const lengths = sents.map(s => wordCount(s));
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance = lengths.reduce((sum, l) => sum + (l - mean) ** 2, 0) / lengths.length;
  return Math.sqrt(variance);
}

// ── Patterns ─────────────────────────────────────────────────────────────────

// Sharp clean lines: short punchy sentences that land
const SHORT_PUNCH_MAX_WORDS = 8;

// Earned images: metaphors anchored to concrete nouns
const METAPHOR_MARKERS = [
  /\blike (a|an|the) \w+/i,
  /\bas (if|though) /i,
  /\b\w+ (of|in) (the|a|an) \w+/i,  // "weight of the silence"
];

// Corniness: forced sentiment
const CORNINESS: Array<[RegExp, number]> = [
  [/\band that('?s| is) (okay|beautiful|enough|everything|all that matters|what (counts|matters))\b/i, 0.1],
  [/\b(at the end of the day)\b/i, 0.08],
  [/\b(everything happens for a reason)\b/i, 0.12],
  [/\b(it is what it is)\b/i, 0.06],
  [/\b(life is (too short|a journey|beautiful|messy))\b/i, 0.08],
  [/\b(love (conquers|heals|wins|is) (all|everything))\b/i, 0.1],
  [/\b(the (best|most important) (things|moments) in life)\b/i, 0.08],
  [/\b(follow your (heart|dreams|bliss|passion))\b/i, 0.08],
  [/\b(you (just|only) (have|need) to (believe|trust|have faith))\b/i, 0.08],
  [/\b(when one door closes)\b/i, 0.1],
  [/\b(every cloud has a silver lining)\b/i, 0.1],
  [/\b(the light at the end of the tunnel)\b/i, 0.08],
  [/\b(silver lining)\b/i, 0.06],
  [/\b(chin up|keep your head up|stay strong|hang in there)\b/i, 0.06],
];

// Purple prose: overwrought, adjective-heavy
const PURPLE_PROSE: Array<[RegExp, number]> = [
  [/\b(achingly|exquisitely|breathtakingly|hauntingly|devastatingly|magnificently|resplendently|luminously|ineffably|transcendently)\b/i, 0.08],
  [/\b(the (sheer|raw|utter|absolute|profound|ineffable|exquisite) (beauty|weight|gravity|magnitude|depth|power|force|intensity))\b/i, 0.1],
  [/\b(a (deep|profound|raw|primal|visceral) (ache|longing|yearning|hunger|need|pull|tug|wound))\b/i, 0.06],
  [/\b(the (delicate|fragile|gossamer|silken|velvet) (thread|web|tapestry|fabric))\b/i, 0.08],
  [/\b(dancing|swirling|cascading|rippling) (in|through|across|with) the\b/i, 0.06],
  [/\b(bathed in|drenched in|suffused with|awash in)\b/i, 0.06],
];

// Obviousness: restating what's already clear
const OBVIOUSNESS: Array<[RegExp, number]> = [
  [/\b(obviously|of course|naturally|clearly|needless to say|it goes without saying|as (we|you) (both )?know)\b/i, 0.06],
  [/\b(what (i'?m|you'?re) (really )?saying is)\b/i, 0.06],
  [/\b(in other words|put (another|simply|differently))\b/i, 0.04],
  [/\b(the point (is|being|here))\b/i, 0.04],
];

// Clunky phrasing
const CLUNKY: Array<[RegExp, number]> = [
  [/\b(in terms of)\b/i, 0.04],
  [/\b(with (regard|respect|reference) to)\b/i, 0.05],
  [/\b(it (is|should be) (noted|mentioned|pointed out) that)\b/i, 0.06],
  [/\b(the fact (of the matter |)is (that )?)\b/i, 0.06],
  [/\b(at this (point|juncture|moment) in time)\b/i, 0.06],
  [/\b(for all intents and purposes)\b/i, 0.05],
  [/\b(as a matter of fact)\b/i, 0.04],
  [/\b(in and of itself)\b/i, 0.05],
  [/\b(each and every)\b/i, 0.04],
  [/\b(due to the fact that)\b/i, 0.06],
];

// ── Judge ────────────────────────────────────────────────────────────────────

function judge(params: JudgeParams): JudgeOutput {
  const { replyText, latestHumanText } = params;
  const reasons: string[] = [];
  const excerpts: string[] = [];
  let reward = 0;
  let penalty = 0;

  const sents = sentences(replyText);
  const wc = wordCount(replyText);
  const avgLen = avgSentenceLength(sents);
  const lenVar = sentenceLengthVariance(sents);

  // ── Rewards ──

  // 1. Short punchy sentences (at least one that's SHORT_PUNCH_MAX_WORDS or fewer)
  const punchySents = sents.filter(s => {
    const w = wordCount(s);
    return w >= 2 && w <= SHORT_PUNCH_MAX_WORDS;
  });
  if (punchySents.length > 0 && sents.length > 1) {
    reward += Math.min(0.15, punchySents.length * 0.05);
    reasons.push(`${punchySents.length} short punchy sentence(s)`);
    excerpts.push(punchySents[0].trim().slice(0, 80));
  }

  // 2. Sentence length variation (rhythm)
  if (sents.length >= 3 && lenVar > 4) {
    reward += Math.min(0.1, lenVar * 0.01);
    reasons.push(`sentence length variance ${lenVar.toFixed(1)} — good rhythm`);
  }

  // 3. Earned images (metaphor near concrete noun from context)
  const humanHasConcreteNoun = /\b(rain|fire|wall|door|river|stone|glass|knife|shadow|light|bone|skin|blood|hand|eye|voice|room|floor|window|sky|tree|road|water|ground)\b/i.test(latestHumanText);
  for (const pat of METAPHOR_MARKERS) {
    const m = replyText.match(pat);
    if (m && humanHasConcreteNoun) {
      reward += 0.06;
      reasons.push('earned image — metaphor anchored to concrete context');
      break;
    }
  }

  // 4. Compression: high information density (lots of sentences, moderate total length)
  if (sents.length >= 3 && avgLen >= 5 && avgLen <= 18) {
    reward += 0.08;
    reasons.push('good compression — varied sentences at moderate length');
  }

  // 5. Em-dash usage (often signals stylistic control)
  const emDashCount = (replyText.match(/—/g) || []).length;
  if (emDashCount >= 1 && emDashCount <= 3) {
    reward += 0.04;
    reasons.push('em-dash usage — stylistic control');
  }

  // ── Penalties ──

  // 6. Corniness
  for (const [pat, weight] of CORNINESS) {
    const m = replyText.match(pat);
    if (m) {
      penalty += weight;
      reasons.push(`corny: "${m[0]}"`);
      excerpts.push(m[0]);
    }
  }

  // 7. Purple prose
  for (const [pat, weight] of PURPLE_PROSE) {
    const m = replyText.match(pat);
    if (m) {
      penalty += weight;
      reasons.push(`purple: "${m[0]}"`);
      excerpts.push(m[0]);
    }
  }

  // 8. Obviousness
  for (const [pat, weight] of OBVIOUSNESS) {
    const m = replyText.match(pat);
    if (m) {
      penalty += weight;
      reasons.push(`obvious: "${m[0]}"`);
    }
  }

  // 9. Clunky phrasing
  for (const [pat, weight] of CLUNKY) {
    const m = replyText.match(pat);
    if (m) {
      penalty += weight;
      reasons.push(`clunky: "${m[0]}"`);
      excerpts.push(m[0]);
    }
  }

  // 10. Underwritten: very short reply in a context that expects richness
  const tags = 'tags' in params.fixture ? params.fixture.tags : [];
  const expectsRichness = tags.some(t => /companionship|relational|emotional|narrative/i.test(t));
  if (expectsRichness && wc < 12 && sents.length <= 1) {
    penalty += 0.12;
    reasons.push(`underwritten: ${wc} words in a context expecting richness`);
  }

  // 11. Overwritten: very long with lots of purple markers
  if (wc > 150 && penalty > 0.15) {
    penalty += 0.08;
    reasons.push(`overwritten: ${wc} words with multiple purple/corny hits`);
  }

  // 12. Monotone sentence length (all sentences roughly same length)
  if (sents.length >= 4 && lenVar < 2) {
    penalty += 0.08;
    reasons.push(`monotone rhythm — sentence length variance only ${lenVar.toFixed(1)}`);
  }

  const score = Math.min(1, Math.max(0, 0.5 + reward - penalty));
  const confidence = wc < 5 ? 0.3 : 0.8;

  if (reasons.length === 0) reasons.push('neutral taste — no strong signals');

  return { judge: 'taste', score, confidence, reasons, excerpts: excerpts.length ? excerpts : undefined };
}

export const tasteJudge: JudgeModule = { name: 'taste', judge };
