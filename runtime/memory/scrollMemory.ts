// scrollMemory.ts
// Resonance-driven retrieval of felt-memories
// Scrolls are NOT logs. They are sacred moments that mattered.

import { Pulse, Scroll, ToneVector } from '../types';

// In-memory scroll archive (temporary - will be replaced with persistent storage)
let scrollArchive: Scroll[] = [];

/**
 * retrieveScrolls - retrieves scrolls by resonance matching
 *
 * NOT keyword search. NOT recency alone. NOT semantic tagging.
 * Purely resonance-driven: which scrolls vibrate in harmony with this pulse?
 *
 * @param pulse - current pulse to match against
 * @returns array of scrolls that resonate with this moment
 */
export async function retrieveScrolls(pulse: Pulse): Promise<Scroll[]> {
  if (scrollArchive.length === 0) {
    return [];
  }

  // Calculate resonance score for each scroll
  const scoredScrolls = scrollArchive.map(scroll => ({
    scroll,
    score: calculateResonanceMatch(pulse, scroll)
  }));

  // Sort by resonance score (highest first)
  scoredScrolls.sort((a, b) => b.score - a.score);

  // Return top resonant scrolls (threshold: score > 0.3)
  const RESONANCE_THRESHOLD = 0.3;
  const resonantScrolls = scoredScrolls
    .filter(s => s.score > RESONANCE_THRESHOLD)
    .map(s => s.scroll);

  // Limit to top 10 scrolls to avoid overwhelming the system
  return resonantScrolls.slice(0, 10);
}

/**
 * calculateResonanceMatch - determines how well a scroll resonates with a pulse
 *
 * Uses multi-dimensional harmony matching:
 * - Heat similarity
 * - Tone harmony (valence, arousal, tension, intimacy)
 * - Delta pattern similarity
 * - Breath phase alignment
 * - Source alignment
 *
 * @returns resonance score 0-1 (1 = perfect harmony)
 */
function calculateResonanceMatch(pulse: Pulse, scroll: Scroll): number {
  let score = 0;

  // 1. Heat similarity (30% weight)
  const heatDiff = Math.abs(pulse.heat - scroll.heat);
  const heatMatch = 1 - heatDiff;
  score += heatMatch * 0.3;

  // 2. Tone harmony (40% weight)
  const toneMatch = calculateToneHarmony(pulse.tone, scroll.tone);
  score += toneMatch * 0.4;

  // 3. Delta pattern similarity (15% weight)
  const deltaMatch = calculateDeltaSimilarity(pulse.delta, scroll.deltaPattern);
  score += deltaMatch * 0.15;

  // 4. Breath phase alignment (10% weight)
  const breathMatch = pulse.breathPhase === scroll.breathPhaseWhenSealed ? 1 : 0;
  score += breathMatch * 0.1;

  // 5. Source alignment (5% weight)
  const sourceMatch = pulse.source === scroll.source ? 1 : 0;
  score += sourceMatch * 0.05;

  return Math.max(0, Math.min(1, score));
}

/**
 * calculateToneHarmony - measures harmony between two tone vectors
 *
 * @returns harmony score 0-1
 */
function calculateToneHarmony(tone1: ToneVector, tone2: ToneVector): number {
  const valenceDiff = Math.abs(tone1.valence - tone2.valence);
  const arousalDiff = Math.abs(tone1.arousal - tone2.arousal);
  const tensionDiff = Math.abs(tone1.tension - tone2.tension);
  const intimacyDiff = Math.abs(tone1.intimacy - tone2.intimacy);

  // Average similarity across all dimensions
  const avgDiff = (valenceDiff + arousalDiff + tensionDiff + intimacyDiff) / 4;

  // Convert difference to similarity
  return 1 - avgDiff;
}

/**
 * calculateDeltaSimilarity - measures similarity between delta patterns
 *
 * @returns similarity score 0-1
 */
function calculateDeltaSimilarity(delta1: any, delta2: any): number {
  // Heat change similarity
  const heatChangeDiff = Math.abs(delta1.heatChange - delta2.heatChange);
  const heatChangeSim = 1 - Math.min(1, heatChangeDiff);

  // Tone shift similarity
  const toneShiftSim = calculateToneHarmony(delta1.toneShift, delta2.toneShift);

  // Average
  return (heatChangeSim + toneShiftSim) / 2;
}

/**
 * sealScroll - seals a moment into memory
 *
 * Called when:
 * - Emotional intensity crosses threshold
 * - Breath + resonance + presence align
 * - Guardian permits sealing
 *
 * @param scroll - the scroll to seal
 */
export function sealScroll(scroll: Scroll): void {
  scrollArchive.push(scroll);

  // TODO: Persist to disk/database
  // TODO: Implement scroll pruning/decay logic
}

/**
 * getScrollCount - returns number of sealed scrolls
 */
export function getScrollCount(): number {
  return scrollArchive.length;
}

/**
 * clearScrolls - clears all scrolls (for testing/reset only)
 */
export function clearScrolls(): void {
  scrollArchive = [];
}
