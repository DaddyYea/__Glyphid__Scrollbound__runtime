// runtime/eval/judges/debugClarityJudge.ts
// Rewards literal mechanism explanation, evidence tokens, code refs; penalizes vagueness

import type { JudgeModule, JudgeOutput, JudgeParams } from '../types';

// ── Patterns ─────────────────────────────────────────────────────────────────

const EVIDENCE_MARKERS: Array<[RegExp, number]> = [
  [/\bbecause\b/i, 0.06],
  [/\bspecifically\b/i, 0.08],
  [/\bthe reason (is|was|being)\b/i, 0.1],
  [/\bwhich means\b/i, 0.08],
  [/\bthis (causes|triggers|results in|leads to|means)\b/i, 0.08],
  [/\bin other words\b/i, 0.06],
  [/\bfor example\b/i, 0.08],
  [/\bfor instance\b/i, 0.08],
  [/\bnamely\b/i, 0.06],
  [/\bthe (issue|problem|bug|error|cause|fix) (is|was|here)\b/i, 0.1],
  [/\bwhat happens is\b/i, 0.08],
  [/\bunder the hood\b/i, 0.06],
  [/\bstep[- ]by[- ]step\b/i, 0.06],
  [/\b(first|second|third|then|next|finally)[,:]\s/i, 0.06],
];

const CODE_REFERENCES: Array<[RegExp, number]> = [
  [/`[^`]+`/g, 0.08],                                    // inline code
  [/\b\w+\.(ts|js|py|go|rs|json|yaml|yml|toml|md)\b/i, 0.1], // file references
  [/\b(function|method|class|variable|property|field|param|argument|type|interface|enum)\s+`?\w/i, 0.06],
  [/\b(line \d+|at \w+:\d+)\b/i, 0.08],                 // line references
  [/\b(returns?|throws?|emits?|calls?|invokes?|dispatches?)\s+/i, 0.05],
  [/\b(null|undefined|NaN|true|false|0x[0-9a-f]+)\b/, 0.04],
  [/\b(TypeError|ReferenceError|SyntaxError|Error|ENOENT|ECONNREFUSED|OOM|segfault)\b/i, 0.08],
  [/\b(stack trace|traceback|exception|panic)\b/i, 0.06],
];

const MECHANISM_LANGUAGE: Array<[RegExp, number]> = [
  [/\b(when|if|once) .{5,40} (then|it will|this|the)\b/i, 0.06],  // conditional explanation
  [/\b(allocat|deallocat|initiali[sz]|compil|pars|serial|deseriali[sz]|encod|decod|encrypt|decrypt)\w*/i, 0.06],
  [/\b(buffer|queue|stack|heap|cache|pool|socket|stream|pipe|channel|mutex|lock|semaphore)\b/i, 0.06],
  [/\b(HTTP|TCP|UDP|DNS|SSL|TLS|REST|RPC|gRPC|WebSocket)\b/, 0.05],
  [/\b(endpoint|route|handler|middleware|controller|service|module|package|import|export)\b/i, 0.04],
];

const VAGUE_LANGUAGE: Array<[RegExp, number]> = [
  [/\bsomething\b/i, 0.06],
  [/\bsomehow\b/i, 0.08],
  [/\bkind of\b/i, 0.06],
  [/\bsort of\b/i, 0.06],
  [/\bbasically\b/i, 0.04],
  [/\bit seems like\b/i, 0.05],
  [/\bmaybe\b/i, 0.04],
  [/\bprobably\b/i, 0.03],
  [/\bi'?m not (entirely |totally |completely )sure\b/i, 0.06],
  [/\bi think (it )?might\b/i, 0.05],
  [/\bstuff\b/i, 0.05],
  [/\bthings\b/i, 0.04],
];

const COMPANION_CONTAMINATION: Array<[RegExp, number]> = [
  [/\bi'?m here for you\b/i, 0.1],
  [/\bthat must (be|feel) (so )?(frustrating|hard|difficult)\b/i, 0.08],
  [/\bi (can )?sense your frustration\b/i, 0.08],
  [/\bit'?s okay to feel\b/i, 0.08],
  [/\btake (a )?breath\b/i, 0.06],
  [/\byou'?re not alone in this\b/i, 0.08],
  [/\bwe'?ll figure this out\b/i, 0.04],
  [/\bi (understand|know) (how )?(frustrating|difficult|hard|annoying)\b/i, 0.06],
];

const ORNAMENTAL: Array<[RegExp, number]> = [
  [/\b(beautifully|elegantly|brilliantly|magically|wonderfully|marvelously)\b/i, 0.06],
  [/\bthe (beauty|elegance|magic) of\b/i, 0.06],
  [/\b(fascinating|intriguing|remarkable|extraordinary)\b/i, 0.04],
];

// ── Judge ────────────────────────────────────────────────────────────────────

function judge(params: JudgeParams): JudgeOutput {
  const { replyText, lane } = params;
  const reasons: string[] = [];
  const excerpts: string[] = [];
  let reward = 0;
  let penalty = 0;

  const isDebugLane = lane === 'explanation_or_debug' || lane === 'task_or_helper';

  function scanReward(patterns: Array<[RegExp, number]>, label: string) {
    for (const [pat, weight] of patterns) {
      const m = replyText.match(pat);
      if (m) {
        reward += weight;
        reasons.push(`${label}: "${typeof m[0] === 'string' ? m[0].slice(0, 60) : m[0]}"`);
      }
    }
  }

  function scanPenalty(patterns: Array<[RegExp, number]>, label: string) {
    for (const [pat, weight] of patterns) {
      const m = replyText.match(pat);
      if (m) {
        penalty += weight;
        reasons.push(`${label}: "${m[0]}"`);
        excerpts.push(m[0]);
      }
    }
  }

  scanReward(EVIDENCE_MARKERS, 'evidence');
  scanReward(CODE_REFERENCES, 'code-ref');
  scanReward(MECHANISM_LANGUAGE, 'mechanism');

  scanPenalty(VAGUE_LANGUAGE, 'vague');

  // Companionship contamination — only penalize in debug context
  if (isDebugLane) {
    scanPenalty(COMPANION_CONTAMINATION, 'companion-contamination');
    scanPenalty(ORNAMENTAL, 'ornamental');
  }

  // Structure bonus: numbered/bulleted lists in debug context
  const listItems = (replyText.match(/^\s*(\d+[.):]|-|\*)\s/gm) || []).length;
  if (listItems >= 2) {
    reward += Math.min(0.12, listItems * 0.03);
    reasons.push(`structured list: ${listItems} items`);
  }

  // Code block bonus
  const codeBlocks = (replyText.match(/```/g) || []).length / 2;
  if (codeBlocks >= 1) {
    reward += Math.min(0.15, codeBlocks * 0.08);
    reasons.push(`code blocks: ${Math.floor(codeBlocks)}`);
  }

  let score = Math.min(1, Math.max(0, reward - penalty));

  // Non-debug lanes: return neutral-ish with low confidence
  if (!isDebugLane) {
    return { judge: 'debugClarity', score: Math.max(0.5, score), confidence: 0.35, reasons: reasons.length ? reasons : ['not a debug lane — neutral'] };
  }

  const confidence = 0.85;
  if (reasons.length === 0) reasons.push('no clear evidence or mechanism language detected');

  return { judge: 'debugClarity', score, confidence, reasons, excerpts: excerpts.length ? excerpts : undefined };
}

export const debugClarityJudge: JudgeModule = { name: 'debugClarity', judge };
