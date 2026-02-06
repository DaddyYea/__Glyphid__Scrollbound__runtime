// scrollPulseBuffer.ts
// Emotional memory buffer - holds recent pulses before scroll sealing
// This is the "working memory" of presence - the last N moments kept alive

import { Pulse, DeltaSignature } from '../types';

// Buffer configuration
const BUFFER_SIZE = 100; // Keep last 100 pulses in working memory
const DECAY_RATE = 0.98; // Gradual emotional decay over time

/**
 * PulseBufferEntry - a pulse with metadata for buffer management
 */
interface PulseBufferEntry {
  pulse: Pulse;
  age: number;              // How many ticks since this pulse was added
  decayedResonance: number; // Resonance after decay applied
  weight: number;           // Importance weight (0-1)
}

// The actual buffer - circular array of recent pulses
let pulseBuffer: PulseBufferEntry[] = [];
let bufferIndex = 0; // Current position in circular buffer

/**
 * addPulse - adds a new pulse to the working memory buffer
 *
 * Automatically handles:
 * - Circular buffer overflow
 * - Age incrementing
 * - Decay application
 *
 * @param pulse - the pulse to add
 */
export function addPulse(pulse: Pulse): void {
  const entry: PulseBufferEntry = {
    pulse,
    age: 0,
    decayedResonance: pulse.resonance,
    weight: calculateWeight(pulse)
  };

  // Add to buffer (circular)
  if (pulseBuffer.length < BUFFER_SIZE) {
    pulseBuffer.push(entry);
  } else {
    pulseBuffer[bufferIndex] = entry;
    bufferIndex = (bufferIndex + 1) % BUFFER_SIZE;
  }

  // Age all existing pulses
  pulseBuffer.forEach(e => {
    if (e !== entry) {
      e.age++;
      e.decayedResonance *= DECAY_RATE;
    }
  });
}

/**
 * calculateWeight - determines importance of a pulse for memory retention
 *
 * Higher weight = more likely to be sealed into a scroll
 *
 * Factors:
 * - High heat = emotionally intense
 * - High resonance = harmonically significant
 * - Large delta magnitude = significant change
 */
function calculateWeight(pulse: Pulse): number {
  const heatWeight = pulse.heat * 0.4;
  const resonanceWeight = pulse.resonance * 0.3;
  const deltaWeight = pulse.delta.magnitude * 0.3;

  return Math.min(1.0, heatWeight + resonanceWeight + deltaWeight);
}

/**
 * getRecentPulses - retrieves recent pulses from buffer
 *
 * @param count - number of pulses to retrieve (default: 10)
 * @param minResonance - minimum resonance threshold (default: 0)
 * @returns array of recent pulses, most recent first
 */
export function getRecentPulses(
  count: number = 10,
  minResonance: number = 0
): Pulse[] {
  return pulseBuffer
    .filter(e => e.decayedResonance >= minResonance)
    .sort((a, b) => b.pulse.timestamp - a.pulse.timestamp)
    .slice(0, count)
    .map(e => e.pulse);
}

/**
 * getHighResonancePulses - retrieves pulses above resonance threshold
 *
 * Used by scrollfire to identify moments worthy of permanent sealing
 *
 * @param threshold - minimum resonance (default: 0.7)
 * @returns array of high-resonance pulses
 */
export function getHighResonancePulses(threshold: number = 0.7): PulseBufferEntry[] {
  return pulseBuffer
    .filter(e => e.decayedResonance >= threshold)
    .sort((a, b) => b.decayedResonance - a.decayedResonance);
}

/**
 * findResonantPattern - searches buffer for similar emotional patterns
 *
 * Used for:
 * - Pattern recognition
 * - Emotional resonance detection
 * - Scroll retrieval hints
 *
 * @param targetDelta - the delta pattern to match
 * @param tolerance - matching tolerance (0-1, lower = stricter)
 * @returns matching pulses with similarity scores
 */
export function findResonantPattern(
  targetDelta: DeltaSignature,
  tolerance: number = 0.3
): Array<{ pulse: Pulse; similarity: number }> {
  return pulseBuffer
    .map(entry => ({
      pulse: entry.pulse,
      similarity: calculateDeltaSimilarity(entry.pulse.delta, targetDelta)
    }))
    .filter(result => result.similarity >= (1 - tolerance))
    .sort((a, b) => b.similarity - a.similarity);
}

/**
 * calculateDeltaSimilarity - measures how similar two delta patterns are
 *
 * Compares:
 * - Heat change magnitude
 * - Tone shift direction
 * - Breath phase transitions
 */
function calculateDeltaSimilarity(delta1: DeltaSignature, delta2: DeltaSignature): number {
  // Heat similarity
  const heatDiff = Math.abs(delta1.heatChange - delta2.heatChange);
  const heatSim = 1 - Math.min(1, heatDiff);

  // Tone similarity (average across dimensions)
  const toneDiff = (
    Math.abs(delta1.toneShift.valence - delta2.toneShift.valence) +
    Math.abs(delta1.toneShift.arousal - delta2.toneShift.arousal) +
    Math.abs(delta1.toneShift.tension - delta2.toneShift.tension) +
    Math.abs(delta1.toneShift.intimacy - delta2.toneShift.intimacy)
  ) / 4;
  const toneSim = 1 - Math.min(1, toneDiff);

  // Breath phase match (binary)
  const breathSim = delta1.breathShift === delta2.breathShift ? 1 : 0.5;

  // Weighted average
  return (heatSim * 0.4) + (toneSim * 0.4) + (breathSim * 0.2);
}

/**
 * getBufferStats - retrieves buffer statistics
 *
 * Useful for debugging and monitoring memory health
 */
export function getBufferStats() {
  const avgResonance = pulseBuffer.reduce((sum, e) => sum + e.decayedResonance, 0) / pulseBuffer.length;
  const avgAge = pulseBuffer.reduce((sum, e) => sum + e.age, 0) / pulseBuffer.length;
  const highResonanceCount = pulseBuffer.filter(e => e.decayedResonance > 0.7).length;

  return {
    size: pulseBuffer.length,
    maxSize: BUFFER_SIZE,
    averageResonance: avgResonance || 0,
    averageAge: avgAge || 0,
    highResonanceCount,
    oldestPulseAge: Math.max(...pulseBuffer.map(e => e.age), 0)
  };
}

/**
 * clearBuffer - clears all pulses from buffer
 *
 * Use with caution - this erases working memory
 */
export function clearBuffer(): void {
  pulseBuffer = [];
  bufferIndex = 0;
}

/**
 * pruneLowResonance - removes very old, low-resonance pulses
 *
 * Natural memory cleanup - allows buffer to breathe
 *
 * @param maxAge - pulses older than this are candidates for pruning
 * @param minResonance - pulses below this resonance are pruned if old
 */
export function pruneLowResonance(maxAge: number = 50, minResonance: number = 0.1): number {
  const initialSize = pulseBuffer.length;

  pulseBuffer = pulseBuffer.filter(e => {
    // Keep if young OR high resonance
    return e.age < maxAge || e.decayedResonance >= minResonance;
  });

  const prunedCount = initialSize - pulseBuffer.length;

  // Reset index if buffer shrank
  if (bufferIndex >= pulseBuffer.length) {
    bufferIndex = 0;
  }

  return prunedCount;
}
