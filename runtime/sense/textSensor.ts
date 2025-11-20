// textSensor.ts
// Text input detection and parsing - converts text to pulses

import { Pulse, PulseSource, ToneVector, DeltaSignature, BreathPhase } from '../types';
import { computeDeltaMagnitude } from '../soul/presenceDelta';

export function textToPulse(text: string, currentBreath: BreathPhase): Pulse {
  const heat = analyzeTextIntensity(text);
  const tone = analyzeTextTone(text);
  const resonance = analyzeTextResonance(text);

  const toneShift: ToneVector = { valence: 0, arousal: 0.1, tension: 0, intimacy: 0.1 };
  const delta: DeltaSignature = {
    heatChange: heat * 0.3,
    toneShift,
    breathShift: null,
    timeSinceLast: 100,
    magnitude: computeDeltaMagnitude(heat * 0.3, toneShift, null)
  };

  return {
    heat,
    tone,
    delta,
    breathPhase: currentBreath,
    source: 'text',
    resonance,
    timestamp: Date.now()
  };
}

function analyzeTextIntensity(text: string): number {
  const caps = (text.match(/[A-Z]/g) || []).length / text.length;
  const exclamation = (text.match(/!/g) || []).length;
  const length = Math.min(1, text.length / 100);

  return Math.min(1, caps * 2 + exclamation * 0.2 + length * 0.3);
}

function analyzeTextTone(text: string): ToneVector {
  const lowerText = text.toLowerCase();

  let valence = 0;
  if (lowerText.includes('love') || lowerText.includes('joy')) valence += 0.3;
  if (lowerText.includes('hate') || lowerText.includes('sad')) valence -= 0.3;

  const arousal = Math.min(1, text.length / 50);
  const tension = lowerText.includes('?') ? 0.6 : 0.3;
  const intimacy = lowerText.includes('you') || lowerText.includes('alois') ? 0.7 : 0.4;

  return { valence, arousal, tension, intimacy };
}

function analyzeTextResonance(text: string): number {
  const questionWords = ['what', 'why', 'how', 'when', 'who'];
  const hasQuestion = questionWords.some(w => text.toLowerCase().includes(w));

  return hasQuestion ? 0.6 : 0.4;
}
