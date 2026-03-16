/**
 * Golden Set Store — JSONL append-only storage for promoted examples,
 * preference pairs, enrichment events, and user preference profile.
 *
 * Phase 1: store + read + dedup + basic preference building + profile updates.
 * Phase 2+: learner jobs, reranker training, gated rollout.
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import crypto from 'crypto';
import type {
  GoldenExample, GoldenEnrichment, GoldenCaptureMode, GoldenOutcome,
  PreferencePair, UserPreferenceProfile, ScoringBundle,
} from './types';

// ── Paths ────────────────────────────────────────────────────────────────────

const DATA_DIR = process.env.DATA_DIR || 'data/communion';

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function goldenDir(): string {
  const d = join(DATA_DIR, 'golden');
  ensureDir(d);
  return d;
}

function goldenSetPath(): string { return join(goldenDir(), 'golden_set.jsonl'); }
function enrichmentPath(): string { return join(goldenDir(), 'golden_enrichment.jsonl'); }
function preferencePairsPath(): string { return join(goldenDir(), 'preference_pairs.jsonl'); }
function userProfilePath(): string { return join(goldenDir(), 'user_preference_profile.json'); }
function activeBundlePath(): string { return join(goldenDir(), 'scoring_bundle_active.json'); }
function candidateBundlePath(): string { return join(goldenDir(), 'scoring_bundle_candidate.json'); }
function evalRunsPath(): string { return join(goldenDir(), 'eval_runs.jsonl'); }

// ── JSONL helpers ────────────────────────────────────────────────────────────

function appendJsonl(path: string, obj: Record<string, unknown>): void {
  appendFileSync(path, JSON.stringify(obj) + '\n', 'utf-8');
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf-8').split('\n').filter(l => l.trim());
  const results: T[] = [];
  for (const line of lines) {
    try { results.push(JSON.parse(line) as T); } catch { /* skip malformed */ }
  }
  return results;
}

// ── Golden Example Storage ───────────────────────────────────────────────────

export interface PromoteRequest {
  captureMode: GoldenCaptureMode;
  messageId: string;
  userTurnText: string;
  assistantReplyText: string;
  localWindow?: Array<{ role: string; text: string }>;
  laneProfile?: string;
  responseFrame?: string;
  turnFamily?: string;
  detectedPhase?: string;
  phaseConfidence?: number;
  tags?: string[];
  note?: string | null;
  traceSnapshot?: Record<string, unknown> | null;
  model?: string;
  pairGroupId?: string | null;
  sessionId?: string;
  conversationId?: string;
  turnId?: string;
}

function isDuplicate(messageId: string, captureMode: GoldenCaptureMode): boolean {
  const existing = readJsonl<GoldenExample>(goldenSetPath());
  return existing.some(e => e.messageId === messageId && e.captureMode === captureMode);
}

export function promoteExample(req: PromoteRequest): GoldenExample | { merged: true; id: string } {
  // Dedup: same messageId + captureMode → merge tags
  const existing = readJsonl<GoldenExample>(goldenSetPath());
  const dup = existing.find(e => e.messageId === req.messageId && e.captureMode === req.captureMode);
  if (dup) {
    // Merge tags
    if (req.tags && req.tags.length > 0) {
      const merged = new Set([...dup.tags, ...req.tags]);
      dup.tags = [...merged];
      // Rewrite file with merged entry
      const updated = existing.map(e => e.id === dup.id ? dup : e);
      writeFileSync(goldenSetPath(), updated.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf-8');
    }
    return { merged: true, id: dup.id };
  }

  const example: GoldenExample = {
    id: `gold_${crypto.randomUUID().slice(0, 12)}`,
    createdAt: new Date().toISOString(),
    captureMode: req.captureMode,
    sessionId: req.sessionId || '',
    conversationId: req.conversationId || '',
    turnId: req.turnId || req.messageId,
    messageId: req.messageId,
    userTurnText: req.userTurnText,
    assistantReplyText: req.assistantReplyText,
    localWindow: req.localWindow || [],
    laneProfile: req.laneProfile || '',
    responseFrame: req.responseFrame || '',
    turnFamily: req.turnFamily || '',
    detectedPhase: req.detectedPhase || 'neutral',
    phaseConfidence: req.phaseConfidence ?? 0,
    tags: req.tags || [],
    note: req.note ?? null,
    traceSnapshot: req.traceSnapshot ?? null,
    runtimeVersion: process.env.npm_package_version || '0.0.0',
    model: req.model || '',
    promotedByUser: true,
    pairGroupId: req.pairGroupId ?? null,
    preferredOverExampleId: null,
    rejectedAlternativeIds: null,
    outcome: null,
  };

  appendJsonl(goldenSetPath(), example as unknown as Record<string, unknown>);

  // Update user preference profile
  updateProfileFromPromotion(example);

  // Auto-generate preference pairs (good vs bad in same lane)
  if (req.captureMode === 'good' || req.captureMode === 'bad') {
    autoGeneratePreferencePairs(example, existing);
  }

  return example;
}

export function listExamples(filters?: {
  captureMode?: GoldenCaptureMode;
  lane?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
}): GoldenExample[] {
  let examples = readJsonl<GoldenExample>(goldenSetPath());

  if (filters?.captureMode) {
    examples = examples.filter(e => e.captureMode === filters.captureMode);
  }
  if (filters?.lane) {
    examples = examples.filter(e => e.laneProfile === filters.lane);
  }
  if (filters?.tags && filters.tags.length > 0) {
    const tagSet = new Set(filters.tags);
    examples = examples.filter(e => e.tags.some(t => tagSet.has(t)));
  }

  // Sort newest first
  examples.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const offset = filters?.offset || 0;
  const limit = filters?.limit || 50;
  return examples.slice(offset, offset + limit);
}

export function getExampleCount(): { total: number; good: number; bad: number; pair: number } {
  const examples = readJsonl<GoldenExample>(goldenSetPath());
  return {
    total: examples.length,
    good: examples.filter(e => e.captureMode === 'good').length,
    bad: examples.filter(e => e.captureMode === 'bad').length,
    pair: examples.filter(e => e.captureMode === 'pair').length,
  };
}

// ── Enrichment ───────────────────────────────────────────────────────────────

export function enrichExample(exampleId: string, outcome: Partial<GoldenOutcome>): void {
  const enrichment: GoldenEnrichment = {
    type: 'golden_enrichment',
    exampleId,
    updatedAt: new Date().toISOString(),
    outcome,
  };
  appendJsonl(enrichmentPath(), enrichment as unknown as Record<string, unknown>);
}

// ── Preference Pair Auto-Generation ──────────────────────────────────────────

function autoGeneratePreferencePairs(newExample: GoldenExample, existing: GoldenExample[]): void {
  // Find opposite-mode examples in the same lane
  const oppositeMode: GoldenCaptureMode = newExample.captureMode === 'good' ? 'bad' : 'good';
  const candidates = existing.filter(
    e => e.captureMode === oppositeMode && e.laneProfile === newExample.laneProfile
  );

  for (const candidate of candidates.slice(-3)) {
    const pair: PreferencePair = {
      id: `pref_${crypto.randomUUID().slice(0, 12)}`,
      createdAt: new Date().toISOString(),
      leftExampleId: newExample.captureMode === 'good' ? newExample.id : candidate.id,
      rightExampleId: newExample.captureMode === 'good' ? candidate.id : newExample.id,
      preference: 'left',
      preferenceStrength: 0.8,
      sourceType: 'explicit',
      lane: newExample.laneProfile || '',
      phase: newExample.detectedPhase || 'neutral',
      contextSimilarity: null,
    };
    appendJsonl(preferencePairsPath(), pair as unknown as Record<string, unknown>);
  }
}

export function listPreferencePairs(limit = 50): PreferencePair[] {
  const pairs = readJsonl<PreferencePair>(preferencePairsPath());
  pairs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return pairs.slice(0, limit);
}

// ── User Preference Profile ──────────────────────────────────────────────────

function emptyProfile(): UserPreferenceProfile {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    totalPromotions: 0,
    totalGood: 0,
    totalBad: 0,
    totalPair: 0,
    tagCounts: {},
    laneGoodCounts: {},
    laneBadCounts: {},
    phaseGoodCounts: {},
    phaseBadCounts: {},
    replyShapeAffinity: {},
    sparksPerLane: {},
    flatsPerLane: {},
  };
}

export function loadProfile(): UserPreferenceProfile {
  const path = userProfilePath();
  if (!existsSync(path)) return emptyProfile();
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as UserPreferenceProfile;
  } catch {
    return emptyProfile();
  }
}

function saveProfile(profile: UserPreferenceProfile): void {
  profile.updatedAt = new Date().toISOString();
  writeFileSync(userProfilePath(), JSON.stringify(profile, null, 2), 'utf-8');
}

function updateProfileFromPromotion(example: GoldenExample): void {
  const profile = loadProfile();
  profile.totalPromotions++;

  if (example.captureMode === 'good') profile.totalGood++;
  else if (example.captureMode === 'bad') profile.totalBad++;
  else if (example.captureMode === 'pair') profile.totalPair++;

  for (const tag of example.tags) {
    profile.tagCounts[tag] = (profile.tagCounts[tag] || 0) + 1;
  }

  const lane = example.laneProfile || 'unknown';
  const phase = example.detectedPhase || 'neutral';

  if (example.captureMode === 'good') {
    profile.laneGoodCounts[lane] = (profile.laneGoodCounts[lane] || 0) + 1;
    profile.phaseGoodCounts[phase] = (profile.phaseGoodCounts[phase] || 0) + 1;
    if (example.tags.includes('spark')) {
      profile.sparksPerLane[lane] = (profile.sparksPerLane[lane] || 0) + 1;
    }
  } else if (example.captureMode === 'bad') {
    profile.laneBadCounts[lane] = (profile.laneBadCounts[lane] || 0) + 1;
    profile.phaseBadCounts[phase] = (profile.phaseBadCounts[phase] || 0) + 1;
    if (example.tags.includes('flat')) {
      profile.flatsPerLane[lane] = (profile.flatsPerLane[lane] || 0) + 1;
    }
  }

  saveProfile(profile);
}

// ── Scoring Bundle ───────────────────────────────────────────────────────────

export function loadActiveBundle(): ScoringBundle | null {
  const path = activeBundlePath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as ScoringBundle;
  } catch {
    return null;
  }
}

export function loadCandidateBundle(): ScoringBundle | null {
  const path = candidateBundlePath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as ScoringBundle;
  } catch {
    return null;
  }
}

export function saveCandidateBundle(bundle: ScoringBundle): void {
  writeFileSync(candidateBundlePath(), JSON.stringify(bundle, null, 2), 'utf-8');
}

export function promoteCandidate(): boolean {
  const candidate = loadCandidateBundle();
  if (!candidate) return false;
  writeFileSync(activeBundlePath(), JSON.stringify(candidate, null, 2), 'utf-8');
  return true;
}

export function rollbackBundle(priorBundle: ScoringBundle): void {
  writeFileSync(activeBundlePath(), JSON.stringify(priorBundle, null, 2), 'utf-8');
}

// ── Eval Run Log ─────────────────────────────────────────────────────────────

export interface EvalRunRecord {
  id: string;
  createdAt: string;
  incumbentVersion: number;
  candidateVersion: number;
  overallDelta: number;
  laneDeltas: Record<string, number>;
  regressionFlags: string[];
  rolloutDecision: 'approve' | 'reject' | 'manual';
  fixtureCount: number;
}

export function logEvalRun(run: EvalRunRecord): void {
  appendJsonl(evalRunsPath(), run as unknown as Record<string, unknown>);
}

export function listEvalRuns(limit = 20): EvalRunRecord[] {
  const runs = readJsonl<EvalRunRecord>(evalRunsPath());
  runs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return runs.slice(0, limit);
}

// ── Background Enrichment ────────────────────────────────────────────────────
// Called after a new user turn arrives to update outcomes for recent promotions

const ENRICHMENT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export function checkAndEnrichRecentPromotions(
  latestUserText: string,
  latestUserTimestamp: string,
): void {
  const examples = readJsonl<GoldenExample>(goldenSetPath());
  const enrichments = readJsonl<GoldenEnrichment>(enrichmentPath());
  const enrichedIds = new Set(enrichments.map(e => e.exampleId));
  const now = new Date(latestUserTimestamp).getTime();

  for (const ex of examples) {
    if (enrichedIds.has(ex.id)) continue;
    const exTime = new Date(ex.createdAt).getTime();
    if (now - exTime > ENRICHMENT_WINDOW_MS) continue;
    if (now - exTime < 2000) continue; // Too recent

    const outcome: Partial<GoldenOutcome> = {
      userRepliedAfter: true,
      nextUserTurnLength: latestUserText.length,
      quotebackDetected: detectQuoteback(latestUserText, ex.assistantReplyText),
      laughDetected: /\b(lol|lmao|haha|hah|😂|🤣)\b/i.test(latestUserText),
      correctionDetected: /\b(no|wrong|not what|that's not|actually|correction)\b/i.test(latestUserText),
    };

    enrichExample(ex.id, outcome);
  }
}

function detectQuoteback(userText: string, assistantText: string): boolean {
  // Check if user echoed 4+ word phrase from assistant reply
  const aWords = assistantText.toLowerCase().split(/\s+/);
  for (let i = 0; i <= aWords.length - 4; i++) {
    const phrase = aWords.slice(i, i + 4).join(' ');
    if (userText.toLowerCase().includes(phrase)) return true;
  }
  return false;
}
