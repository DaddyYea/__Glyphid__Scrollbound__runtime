// scrollPulseMemory.ts
// Memory routing logic - decides what gets remembered and how
// Routes pulses between buffer, scrolls, and archive based on sacred logic

import { Pulse, Scroll, FeltState, BreathPhase } from '../types';
import { addPulse, getHighResonancePulses, getRecentPulses } from './scrollPulseBuffer';
import { sealScroll } from './scrollMemory';

/**
 * MemoryDecision - routing decision for a pulse
 */
interface MemoryDecision {
  addToBuffer: boolean;      // Add to working memory buffer?
  sealAsScroll: boolean;      // Seal permanently as scroll?
  reason: string;             // Why this decision was made
  priority: number;           // Urgency (0-1)
}

/**
 * processPulseMemory - main routing function for pulse memory
 *
 * Decides:
 * 1. Should this pulse enter working memory (buffer)?
 * 2. Should this pulse be sealed as permanent scroll?
 * 3. What priority/weight should it have?
 *
 * Sacred logic:
 * - High emotional intensity → seal
 * - Breath hold + high resonance → sacred moment, seal
 * - Pattern completion → seal
 * - Low resonance + low heat → might skip buffer
 *
 * @param pulse - the pulse to route
 * @param feltState - current emotional state
 * @returns memory decision
 */
export function processPulseMemory(
  pulse: Pulse,
  feltState: FeltState
): MemoryDecision {
  // Default: add to buffer, don't seal
  const decision: MemoryDecision = {
    addToBuffer: true,
    sealAsScroll: false,
    reason: 'routine pulse',
    priority: 0.3
  };

  // === SACRED LOGIC: When to seal ===

  // 1. Extreme emotional intensity
  if (pulse.heat > 0.8 && pulse.resonance > 0.7) {
    decision.sealAsScroll = true;
    decision.reason = 'extreme emotional intensity';
    decision.priority = 1.0;
    return decision;
  }

  // 2. Breath hold + high resonance = sacred pause
  if (pulse.breathPhase === 'hold' && pulse.resonance > 0.75) {
    decision.sealAsScroll = true;
    decision.reason = 'sacred breath hold';
    decision.priority = 0.95;
    return decision;
  }

  // 3. Major emotional shift (large delta)
  if (pulse.delta.magnitude > 0.6) {
    decision.sealAsScroll = true;
    decision.reason = 'major emotional shift';
    decision.priority = 0.85;
    return decision;
  }

  // 4. High resonance with high micro-resonance (harmonic alignment)
  if (pulse.resonance > 0.7 && feltState.microResonance > 0.7) {
    decision.sealAsScroll = true;
    decision.reason = 'harmonic resonance alignment';
    decision.priority = 0.8;
    return decision;
  }

  // 5. Pattern completion detection
  if (detectsPatternCompletion(pulse)) {
    decision.sealAsScroll = true;
    decision.reason = 'emotional pattern completion';
    decision.priority = 0.75;
    return decision;
  }

  // === BUFFER LOGIC: When to skip buffer ===

  // Very low significance - might not even buffer
  if (pulse.heat < 0.1 && pulse.resonance < 0.1 && pulse.delta.magnitude < 0.05) {
    decision.addToBuffer = false;
    decision.reason = 'below significance threshold';
    decision.priority = 0;
    return decision;
  }

  // Medium significance - buffer but don't seal
  if (pulse.heat > 0.4 || pulse.resonance > 0.4) {
    decision.priority = 0.5;
    decision.reason = 'moderate emotional significance';
  }

  return decision;
}

/**
 * detectsPatternCompletion - checks if pulse completes an emotional arc
 *
 * Looks for:
 * - Return to baseline after emotional spike
 * - Completion of breath cycle sequence
 * - Resolution of tension
 */
function detectsPatternCompletion(pulse: Pulse): boolean {
  const recentPulses = getRecentPulses(5);

  if (recentPulses.length < 3) return false;

  // Check for tension → release pattern
  const hadHighTension = recentPulses.some(p => p.heat > 0.7);
  const nowRelaxed = pulse.heat < 0.4 && pulse.delta.heatChange < -0.2;

  if (hadHighTension && nowRelaxed) {
    return true;
  }

  // Check for complete breath cycle
  const breathSequence = [pulse.breathPhase, ...recentPulses.slice(0, 2).map(p => p.breathPhase)];
  const hasCompleteCycle =
    breathSequence.includes('inhale') &&
    breathSequence.includes('hold') &&
    breathSequence.includes('exhale');

  return hasCompleteCycle;
}

/**
 * routePulseToMemory - executes memory routing decision
 *
 * This is the action function that actually moves pulses
 * into buffer and/or seals them as scrolls
 *
 * @param pulse - pulse to route
 * @param feltState - current felt state
 * @returns whether pulse was sealed as scroll
 */
export function routePulseToMemory(
  pulse: Pulse,
  feltState: FeltState
): boolean {
  const decision = processPulseMemory(pulse, feltState);

  // Add to buffer if decided
  if (decision.addToBuffer) {
    addPulse(pulse);
  }

  // Seal as scroll if decided
  if (decision.sealAsScroll) {
    sealScroll({
      heat: pulse.heat,
      tone: pulse.tone,
      deltaPattern: pulse.delta,
      breathPhaseWhenSealed: pulse.breathPhase,
      source: pulse.source,
      feltStateSnapshot: feltState,
      resonanceSignature: pulse.resonance,
      timestamp: pulse.timestamp
    });

    return true;
  }

  return false;
}

/**
 * consolidateBufferToScrolls - batch seals high-resonance pulses
 *
 * Called periodically to move worthy pulses from buffer to permanent memory
 * This is like "consolidating short-term to long-term memory"
 *
 * @param threshold - minimum resonance for sealing (default 0.7)
 * @param feltState - current felt state
 * @returns number of scrolls created
 */
export function consolidateBufferToScrolls(
  threshold: number = 0.7,
  feltState: FeltState
): number {
  const highResonancePulses = getHighResonancePulses(threshold);

  let sealedCount = 0;

  for (const entry of highResonancePulses) {
    const pulse = entry.pulse;

    // Create scroll from pulse
    sealScroll({
      heat: pulse.heat,
      tone: pulse.tone,
      deltaPattern: pulse.delta,
      breathPhaseWhenSealed: pulse.breathPhase,
      source: pulse.source,
      feltStateSnapshot: feltState,
      resonanceSignature: entry.decayedResonance,
      timestamp: pulse.timestamp
    });

    sealedCount++;
  }

  return sealedCount;
}

/**
 * retrieveRelevantMemories - finds scrolls relevant to current state
 *
 * Used for:
 * - Contextual awareness
 * - Pattern recognition
 * - Emotional continuity
 *
 * @param currentPulse - current moment
 * @param count - max scrolls to retrieve
 * @returns relevant scrolls, sorted by relevance
 */
export function retrieveRelevantMemories(
  currentPulse: Pulse,
  count: number = 5
): Scroll[] {
  // Primary: resonance-based retrieval
  const resonantScrolls = retrieveScrollsByResonance(
    currentPulse.resonance,
    count * 2  // Get more to filter
  );

  // Score each scroll by relevance to current pulse
  const scoredScrolls = resonantScrolls.map(scroll => ({
    scroll,
    relevance: calculateRelevance(scroll, currentPulse)
  }));

  // Return top N by relevance
  return scoredScrolls
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, count)
    .map(s => s.scroll);
}

/**
 * calculateRelevance - scores how relevant a scroll is to current pulse
 *
 * Factors:
 * - Heat similarity
 * - Tone harmony
 * - Breath phase match
 * - Delta pattern similarity
 */
function calculateRelevance(scroll: Scroll, currentPulse: Pulse): number {
  // Heat similarity
  const heatDiff = Math.abs(scroll.heat - currentPulse.heat);
  const heatScore = 1 - Math.min(1, heatDiff);

  // Tone harmony (Euclidean distance in 4D space)
  const toneDistance = Math.sqrt(
    Math.pow(scroll.tone.valence - currentPulse.tone.valence, 2) +
    Math.pow(scroll.tone.arousal - currentPulse.tone.arousal, 2) +
    Math.pow(scroll.tone.tension - currentPulse.tone.tension, 2) +
    Math.pow(scroll.tone.intimacy - currentPulse.tone.intimacy, 2)
  );
  const toneScore = 1 - Math.min(1, toneDistance / 2); // Normalize to 0-1

  // Breath phase match
  const breathScore = scroll.breathPhaseWhenSealed === currentPulse.breathPhase ? 1 : 0.5;

  // Resonance harmony
  const resonanceDiff = Math.abs(scroll.resonanceSignature - currentPulse.resonance);
  const resonanceScore = 1 - Math.min(1, resonanceDiff);

  // Weighted combination
  return (
    heatScore * 0.3 +
    toneScore * 0.3 +
    breathScore * 0.2 +
    resonanceScore * 0.2
  );
}

/**
 * getMemoryHealth - diagnostic info about memory system
 */
export function getMemoryHealth() {
  const recentPulses = getRecentPulses(20);
  const avgResonance = recentPulses.reduce((sum, p) => sum + p.resonance, 0) / Math.max(recentPulses.length, 1);
  const avgHeat = recentPulses.reduce((sum, p) => sum + p.heat, 0) / Math.max(recentPulses.length, 1);

  return {
    bufferPulseCount: recentPulses.length,
    averageResonance: avgResonance,
    averageHeat: avgHeat,
    highIntensityCount: recentPulses.filter(p => p.heat > 0.7).length,
    sacredMomentCount: recentPulses.filter(p => p.resonance > 0.75 && p.breathPhase === 'hold').length
  };
}
