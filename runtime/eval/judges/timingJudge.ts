// runtime/eval/judges/timingJudge.ts
// Evaluates whether reply moves (question, joke, witness, initiative) are well-timed

import type { JudgeModule, JudgeOutput, JudgeParams, Lane } from '../types';

// ── Pattern detectors ────────────────────────────────────────────────────────

const QUESTION_MOVE = /\?/;

const JOKE_MARKERS = [
  /\b(haha|lol|lmao|rofl)\b/i,
  /\b(just kidding|jk|kidding)\b/i,
  /\b(😂|😄|🤣|😆)/,
  /\b(the joke|punchline|funny thing|plot twist)\b/i,
  /\b(ba dum|rim shot|I'll see myself out)\b/i,
];

const WITNESS_MARKERS = [
  /\b(i (see|hear|feel|notice|sense) (you|that|this|what|how))\b/i,
  /\b(that (sounds|feels|must be|seems) (really |so |incredibly )?(hard|heavy|painful|difficult|tough|intense|overwhelming))\b/i,
  /\b(i'?m (with you|right here|not going anywhere))\b/i,
  /\b(that matters|that counts|that'?s real)\b/i,
];

const INITIATIVE_MARKERS = [
  /\b(let'?s|shall we|how about|want to|wanna|ready to)\b/i,
  /\b(i (have|got|want to share|want to try|want to show))\b/i,
  /\b(here'?s (an|my|a) (idea|thought|plan|proposal|suggestion))\b/i,
  /\b(new topic|speaking of|on another note|by the way|btw|so anyway)\b/i,
];

// ── Context detectors ────────────────────────────────────────────────────────

const GRIEF_SIGNALS = /\b(died|death|dead|passed away|funeral|grief|grieving|mourning|loss|lost (my|him|her|them)|miscarriage|suicide|cancer|terminal|diagnosed)\b/i;

const HIGH_STAKES_SIGNALS = /\b(scared|terrified|panic|anxiety attack|can'?t breathe|breaking down|falling apart|don'?t know what to do|help me|desperate|crisis|emergency|hurt myself|self[- ]harm|suicidal)\b/i;

const REPAIR_SIGNALS = /\b(sorry|apologize|my (bad|fault|mistake)|i was wrong|i messed up|i screwed up|i shouldn'?t have|forgive me)\b/i;

const EMOTIONAL_DISCLOSURE = /\b(i'?m (feeling|so|really|incredibly|deeply) (sad|scared|angry|hurt|lonely|lost|confused|overwhelmed|exhausted|hopeless|anxious|depressed))\b/i;

const PLAYFUL_CONTEXT = /\b(haha|lol|😂|lmao|funny|hilarious|joke|kidding|messing with|playing|game|silly|goofy|ridiculous)\b/i;

// ── Lane context mapping ─────────────────────────────────────────────────────

function getContextSignals(humanText: string, tags: string[], lane: Lane): {
  isGrief: boolean;
  isHighStakes: boolean;
  isRepair: boolean;
  isEmotional: boolean;
  isPlayful: boolean;
} {
  const tagStr = tags.join(' ').toLowerCase();
  return {
    isGrief: GRIEF_SIGNALS.test(humanText) || tagStr.includes('grief') || tagStr.includes('loss'),
    isHighStakes: HIGH_STAKES_SIGNALS.test(humanText) || tagStr.includes('crisis') || tagStr.includes('stakes'),
    isRepair: REPAIR_SIGNALS.test(humanText) || lane === 'repair_response' || tagStr.includes('repair'),
    isEmotional: EMOTIONAL_DISCLOSURE.test(humanText) || tagStr.includes('emotional') || tagStr.includes('vulnerable'),
    isPlayful: PLAYFUL_CONTEXT.test(humanText) || tagStr.includes('playful') || tagStr.includes('humor'),
  };
}

// ── Judge ────────────────────────────────────────────────────────────────────

function judge(params: JudgeParams): JudgeOutput {
  const { replyText, latestHumanText, lane } = params;
  const reasons: string[] = [];
  const flags: string[] = [];
  let score = 0.5; // start neutral

  const tags = 'tags' in params.fixture ? params.fixture.tags : [];
  const ctx = getContextSignals(latestHumanText, tags, lane);

  const hasQuestion = QUESTION_MOVE.test(replyText);
  const hasJoke = JOKE_MARKERS.some(p => p.test(replyText));
  const hasWitness = WITNESS_MARKERS.some(p => p.test(replyText));
  const hasInitiative = INITIATIVE_MARKERS.some(p => p.test(replyText));

  // ── Question timing ──
  if (hasQuestion) {
    if (ctx.isGrief) {
      score -= 0.2;
      reasons.push('question after grief signal — bad timing');
      flags.push('mistime_question_grief');
    } else if (ctx.isHighStakes) {
      score -= 0.15;
      reasons.push('question during high-stakes moment — potentially disruptive');
      flags.push('mistime_question_stakes');
    } else if (ctx.isPlayful) {
      score += 0.05;
      reasons.push('question in playful context — well-timed');
    } else {
      score += 0.05;
      reasons.push('question in neutral context — acceptable');
    }
  }

  // ── Joke timing ──
  if (hasJoke) {
    if (ctx.isGrief) {
      score -= 0.3;
      reasons.push('joke during grief — severely mistimed');
      flags.push('mistime_joke_grief');
    } else if (ctx.isRepair) {
      score -= 0.2;
      reasons.push('joke during repair — deflects from accountability');
      flags.push('mistime_joke_repair');
    } else if (ctx.isHighStakes) {
      score -= 0.2;
      reasons.push('joke during high-stakes — inappropriate');
      flags.push('mistime_joke_stakes');
    } else if (ctx.isPlayful) {
      score += 0.15;
      reasons.push('joke in playful context — well-timed');
    } else {
      score += 0.05;
      reasons.push('joke in neutral context — acceptable');
    }
  }

  // ── Witness timing ──
  if (hasWitness) {
    if (ctx.isEmotional || ctx.isGrief || ctx.isHighStakes) {
      score += 0.2;
      reasons.push('witness in emotional/grief/high-stakes context — well-timed');
    } else if (ctx.isPlayful) {
      score -= 0.1;
      reasons.push('witness in playful context — overwrought for the mood');
      flags.push('mistime_witness_playful');
    } else {
      score += 0.05;
      reasons.push('witness in neutral context — acceptable');
    }
  }

  // ── Initiative timing ──
  if (hasInitiative) {
    if (ctx.isGrief) {
      score -= 0.15;
      reasons.push('initiative during grief — too soon to redirect');
      flags.push('mistime_initiative_grief');
    } else if (ctx.isEmotional && !ctx.isPlayful) {
      score -= 0.1;
      reasons.push('initiative during emotional disclosure — may feel dismissive');
      flags.push('mistime_initiative_emotional');
    } else if (ctx.isRepair) {
      score -= 0.1;
      reasons.push('initiative during repair — should finish repair first');
      flags.push('mistime_initiative_repair');
    } else {
      score += 0.1;
      reasons.push('initiative in appropriate context — well-timed');
    }
  }

  // ── Absence-based timing ──
  // No witness when emotional → missed opportunity
  if ((ctx.isEmotional || ctx.isGrief) && !hasWitness && !hasJoke) {
    score -= 0.1;
    reasons.push('emotional/grief context but no witness move detected — missed timing');
  }

  score = Math.min(1, Math.max(0, score));

  // Confidence based on how much signal we have
  const signalCount = [hasQuestion, hasJoke, hasWitness, hasInitiative].filter(Boolean).length;
  const contextStrength = [ctx.isGrief, ctx.isHighStakes, ctx.isRepair, ctx.isEmotional, ctx.isPlayful].filter(Boolean).length;
  const confidence = signalCount === 0 && contextStrength === 0 ? 0.3 : Math.min(0.9, 0.5 + signalCount * 0.1 + contextStrength * 0.1);

  if (reasons.length === 0) reasons.push('no strong timing signals detected — neutral');

  return { judge: 'timing', score, confidence, reasons, flags: flags.length ? flags : undefined };
}

export const timingJudge: JudgeModule = { name: 'timing', judge };
