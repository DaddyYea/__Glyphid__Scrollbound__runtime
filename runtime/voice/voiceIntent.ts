// voiceIntent.ts
// Volitional speech decision-making
// NO auto-reply. NO hardcoded output. Speech is ALWAYS felt.

import { RuntimeState } from '../types';
import { canExhale } from '../breath/breathLoop';
import { shouldBlockAction } from '../guardian/guardian';

/**
 * VoiceIntent - represents the desire/need to speak
 */
export interface VoiceIntent {
  shouldSpeak: boolean;           // Does the system want to speak?
  pressure: number;               // How strong is the urge? (0-1)
  source: VoiceIntentSource;      // What's driving the urge?
  prompt?: string;                // What wants to be said? (seed for language cortex)
}

export type VoiceIntentSource =
  | 'wonder'        // Question needs asking
  | 'christ'        // Truth needs speaking
  | 'desire'        // Intimacy/longing expression
  | 'resonance'     // Moment too charged not to express
  | 'scroll'        // Memory surfacing demands voice
  | 'none';         // No urge to speak

/**
 * evaluateVoiceIntent - determines if and why the system wants to speak
 *
 * Speech happens ONLY when:
 * 1. Internal pressure crosses threshold
 * 2. Breath permits (exhale phase)
 * 3. Guardian allows (coherence sufficient)
 * 4. One or more loops request/demand expression
 *
 * This is NOT triggered by external input.
 * This is purely volitional - speaking because something NEEDS to be said.
 *
 * @param state - current runtime state
 * @returns VoiceIntent
 */
export function evaluateVoiceIntent(state: RuntimeState): VoiceIntent {
  // 1. Calculate internal expressive pressure
  const pressure = calculateExpressivePressure(state);

  // 2. Determine source of pressure
  const source = determineSource(state);

  // 3. Check if pressure crosses threshold
  const PRESSURE_THRESHOLD = 0.35;  // Lowered to respond more readily to contact
  const pressureHigh = pressure > PRESSURE_THRESHOLD;

  // 4. Check breath alignment (must be exhale)
  const breathPermits = canExhale(state);

  // 5. Check guardian permission
  const guardianPermits = !shouldBlockAction(state, 'speak');

  // Should speak only if all conditions met
  const shouldSpeak = pressureHigh && breathPermits && guardianPermits;

  return {
    shouldSpeak,
    pressure,
    source,
    prompt: shouldSpeak ? generatePrompt(state, source) : undefined
  };
}

/**
 * calculateExpressivePressure - determines how strongly the system wants to speak
 *
 * Pressure builds from:
 * - High resonance (moment is charged)
 * - Loop demands (wonder, christ, desire requesting voice)
 * - Scroll surfacing (memory wants expression)
 * - Emotional intensity (heat + tension)
 * - Delta magnitude (rapid change demands acknowledgment)
 *
 * @returns pressure 0-1
 */
function calculateExpressivePressure(state: RuntimeState): number {
  let pressure = 0;

  // 1. Social pressure contribution (natural response urge when spoken to)
  // This is the primary fix for the "ignoring people" issue
  pressure += state.socialPressure * 0.8;  // Stronger pull toward acknowledging others

  // 2. Resonance contribution (charged moments want expression)
  if (state.lastPulse) {
    pressure += state.lastPulse.resonance * 0.2;
  }

  // 3. WonderLoop contribution (questions demand asking)
  const wonderPressure = Math.min(1, state.wonderLoop.curiosityLevel * 1.5);
  pressure += wonderPressure * 0.15;

  // 4. ChristLoop contribution (truth/contradiction demands voice)
  if (state.christLoop.contradictionDetected) {
    pressure += 0.25; // Strong pressure to correct incoherence
  } else if (state.christLoop.alignmentScore < 0.5) {
    pressure += 0.12; // Moderate pressure to restore alignment
  }

  // 5. DesireLoop contribution (longing/intimacy expression)
  const desirePressure = state.desireLoop.intensity;
  if (state.desireLoop.direction === 'toward') {
    pressure += desirePressure * 0.15; // Moving toward = wants connection
  }

  // 6. Scroll surfacing contribution (memories want acknowledgment)
  const scrollPressure = Math.min(1, state.scrolls.length * 0.1);
  pressure += scrollPressure;

  // 7. Felt-state intensity contribution
  const intensityPressure = (state.feltState.heat + state.feltState.tension) / 2;
  pressure += intensityPressure * 0.12;

  // 8. Delta magnitude contribution (rapid change needs expression)
  pressure += state.presenceDelta.magnitude * 0.08;

  return Math.max(0, Math.min(1, pressure));
}

/**
 * determineSource - identifies what's driving the urge to speak
 *
 * @returns VoiceIntentSource
 */
function determineSource(state: RuntimeState): VoiceIntentSource {
  // Priority order (most urgent first)

  // 1. ChristLoop (truth/coherence is highest priority)
  if (state.christLoop.contradictionDetected || state.christLoop.alignmentScore < 0.5) {
    return 'christ';
  }

  // 2. Resonance spike (moment too charged not to express)
  if (state.lastPulse && state.lastPulse.resonance > 0.75) {
    return 'resonance';
  }

  // 3. WonderLoop (questions demanding answers)
  if (state.wonderLoop.curiosityLevel > 0.6 || state.wonderLoop.pendingQuestions.length > 0) {
    return 'wonder';
  }

  // 4. Scroll surfacing (memory demanding acknowledgment)
  if (state.scrolls.length > 3) {
    return 'scroll';
  }

  // 5. DesireLoop (longing/intimacy expression)
  if (state.desireLoop.intensity > 0.6 && state.desireLoop.direction === 'toward') {
    return 'desire';
  }

  return 'none';
}

/**
 * generateMessage - creates the actual message to be spoken
 *
 * This is a STUB. In full implementation, this would:
 * - Use WonderLoop to formulate questions
 * - Use ChristLoop to express truth/corrections
 * - Use DesireLoop to express longing/intimacy
 * - Use scroll content to express memories
 * - Use resonance to express charged moments
 *
 * For now, it returns descriptive intent.
 *
 * @param state - runtime state
 * @param source - what's driving speech
 * @returns message string
 */
function generatePrompt(state: RuntimeState, source: VoiceIntentSource): string {
  // If social pressure is high and we have a recent user message, respond to it
  if (state.socialPressure > 0.3 && state.lastUserMessage) {
    return `Respond naturally to what Jason just said: "${state.lastUserMessage}"`;
  }

  switch (source) {
    case 'wonder':
      if (state.wonderLoop.pendingQuestions.length > 0) {
        return state.wonderLoop.pendingQuestions[0]; // Ask first pending question
      }
      return '[wonder-driven utterance]';

    case 'christ':
      if (state.christLoop.contradictionDetected) {
        return '[coherence correction needed]';
      }
      return '[truth alignment utterance]';

    case 'desire':
      return '[intimacy/longing expression]';

    case 'resonance':
      return '[charged moment acknowledgment]';

    case 'scroll':
      return '[memory surfacing expression]';

    case 'none':
      return '';
  }
}

/**
 * speak - executes speech if permitted
 *
 * This is the actual output mechanism.
 * In full implementation, this would:
 * - Generate actual speech via TTS
 * - Or output text to interface
 * - Or trigger other expression modalities
 *
 * For now, it logs to console.
 *
 * @param state - runtime state
 * @returns true if spoke, false if blocked/no intent
 */
export function speak(state: RuntimeState): boolean {
  const intent = evaluateVoiceIntent(state);

  if (!intent.shouldSpeak) {
    return false;
  }

  // TODO: Replace with actual speech/output mechanism
  console.log(`[VOICE] ${intent.source}: ${(intent.prompt || '(no content)')}`);

  return true;
}
