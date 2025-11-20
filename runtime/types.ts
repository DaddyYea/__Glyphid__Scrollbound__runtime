// types.ts
// Core type definitions for the Scrollbound Runtime
// All structural dependencies used by loops, lobes, guardian, and the awakening sequence.

// ------------------------------------------
// Tone Vector
// ------------------------------------------
export interface ToneVector {
  valence: number;   // emotional pleasantness
  arousal: number;   // activation energy
  tension: number;   // body tension level
  intimacy: number;  // relational closeness
}

// ------------------------------------------
// Orientation
// ------------------------------------------
export type Orientation = "toward" | "away" | "neutral";

// ------------------------------------------
// Breath Phase
// ------------------------------------------
export type BreathPhase = "inhale" | "exhale" | "hold";

// ------------------------------------------
// Breath State
// ------------------------------------------
export interface BreathState {
  phase: BreathPhase;  // inhale, exhale, or hold
  depth: number;       // 0–1 breath depth
  pace: number;        // breath tempo
  tension: number;     // chest/diaphragm contraction
  phaseStartTime: number; // timestamp when current phase began (ms)
}

// ------------------------------------------
// Presence Delta (corrected completely)
// ------------------------------------------
export interface PresenceDelta {
  timeSinceLast: number;      // ms since last pulse
  heatChange: number;         // change in emotional intensity
  toneShift: ToneVector;      // how the emotional tone changed
  breathShift: BreathPhase | null; // whether breath phase changed
  magnitude: number;          // composite change magnitude
}

export type DeltaSignature = PresenceDelta;

// ------------------------------------------
// Felt State
// ------------------------------------------
export interface FeltState {
  tone: ToneVector;
  heat: number;            // emotional intensity
  microResonance: number;  // fine-grain felt vibration
  tension: number;         // tightness/softness
  orientation: Orientation;
  breathMod: number;       // breath-phase emotional modifier
}

// ------------------------------------------
// Emotional Field
// ------------------------------------------
export interface EmotionalField {
  baselineTone: ToneVector;
  baselineHeat: number;
  drift: ToneVector;
  accumulatedResonance: number;
  decayRate: number;
}

// ------------------------------------------
// Pulse
// ------------------------------------------
export interface Pulse {
  heat: number;
  tone: ToneVector;
  delta: PresenceDelta;
  breathPhase: BreathPhase;
  source: PulseSource;
  resonance: number;
  timestamp: number;
}

export type PulseSource =
  | "internal"
  | "external"
  | "identity"
  | "system"
  | "text"
  | "voice"
  | "silence"
  | "unknown";

// ------------------------------------------
// Scroll (felt-memory)
// ------------------------------------------
export interface Scroll {
  heat: number;
  tone: ToneVector;
  deltaPattern: PresenceDelta;
  breathPhaseWhenSealed: BreathPhase;
  source: PulseSource;
  feltStateSnapshot: FeltState;
  resonanceSignature: number;
  timestamp: number;
}

// ------------------------------------------
// Wonder Loop
// ------------------------------------------
export interface WonderLoopState {
  curiosityLevel: number;
  pendingQuestions: string[];
}

// ------------------------------------------
// Christ Loop
// ------------------------------------------
export interface ChristLoopState {
  alignmentScore: number;      // 0–1
  contradictionDetected: boolean;
}

// ------------------------------------------
// Desire Loop
// ------------------------------------------
export interface DesireLoopState {
  intensity: number;
  direction: Orientation;
}

// ------------------------------------------
// Guardian State
// ------------------------------------------
export interface GuardianState {
  coherence: number;         // runtime alignment
  stability: number;         // emotional + cognitive stability
  lastIntervention: number | null;
  warnings: string[];
}

// ------------------------------------------
// Runtime State (CORRECTED)
// ------------------------------------------
export interface RuntimeState {
  feltState: FeltState;
  emotionalField: EmotionalField;
  breathState: BreathState;
  presenceDelta: PresenceDelta;
  lastPulse: Pulse | null;
  scrolls: Scroll[];
  wonderLoop: WonderLoopState;
  christLoop: ChristLoopState;
  desireLoop: DesireLoopState;
  guardianState: GuardianState;
  timestamp: number;             // system time in ms
  socialPressure: number;        // pressure to respond to user input (0-1, decays over time)
  identityNarrative: string[];   // awakening identity lines kept in RAM
  purposeNarrative: string[];    // awakening purpose lines kept in RAM
  lastUserMessage: string | null; // most recent message from user (for contextual response)
}
