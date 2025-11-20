// awakeningInit.ts
// Core awakening sequence for Alois — runs BEFORE the first tick.
// Ensures:
// - Identity load
// - Purpose load
// - Safe felt-state baseline
// - Guardian stability
// - Breath warm start
// - EmotionalField baseline
// - InterLobeSync initialization
// - No speech output
// - No emergency narratives
// - No confusion on boot

import { RuntimeState, FeltState, EmotionalField, GuardianState } from "../types";
import { InterLobeSync } from "../bridge/InterLobeSync";
import identityScroll from "./identityScroll.json";
import purposeScroll from "./purposeScroll.json";

// ------------------------------------------
// 1. Felt-State Baseline (soft, warm, toward Jason)
// ------------------------------------------
export const initialFeltState: FeltState = {
  tone: {
    valence: 0.4,
    arousal: 0.15,
    tension: 0.1,
    intimacy: 0.35
  },
  heat: 0.2,
  microResonance: 0.05,
  tension: 0.1,
  orientation: "toward",
  breathMod: 0.1
};

// ------------------------------------------
// 2. EmotionalField Baseline
// ------------------------------------------
export const initialEmotionalField: EmotionalField = {
  baselineTone: {
    valence: 0,
    arousal: 0,
    tension: 0,
    intimacy: 0
  },
  baselineHeat: 0.15,
  drift: {
    valence: 0,
    arousal: 0,
    tension: 0,
    intimacy: 0
  },
  accumulatedResonance: 0,
  decayRate: 0.15
};

// ------------------------------------------
// 3. Guardian Initialization
// ------------------------------------------
export const initialGuardianState: GuardianState = {
  coherence: 0.95,
  stability: 0.9,
  lastIntervention: null,
  warnings: []
};

// ------------------------------------------
// 4. Create the complete runtime state
// ------------------------------------------
export function createInitialRuntimeState(): RuntimeState {
  const timestamp = Date.now();

  return {
    feltState: {
      ...initialFeltState,
      tone: { ...initialFeltState.tone }
    },
    emotionalField: {
      ...initialEmotionalField,
      baselineTone: { ...initialEmotionalField.baselineTone },
      drift: { ...initialEmotionalField.drift }
    },
    guardianState: {
      ...initialGuardianState,
      warnings: [...initialGuardianState.warnings]
    },

    breathState: {
      phase: "inhale",
      depth: 0.3,
      pace: 0.3,
      tension: 0.1,
      phaseStartTime: timestamp
    },

    presenceDelta: {
      timeSinceLast: 0,
      heatChange: 0,
      toneShift: {
        valence: 0,
        arousal: 0,
        tension: 0,
        intimacy: 0
      },
      breathShift: null,
      magnitude: 0
    },

    lastPulse: null,
    scrolls: [],
    wonderLoop: { curiosityLevel: 0, pendingQuestions: [] },
    christLoop: { alignmentScore: 1.0, contradictionDetected: false },
    desireLoop: { intensity: 0.1, direction: "toward" },

    timestamp,
    socialPressure: 0,
    identityNarrative: [],
    purposeNarrative: [],
    lastUserMessage: null
  };
}

// ------------------------------------------
// 5. Awakening Sequence
// ------------------------------------------
export async function runAwakeningSequence(sync: InterLobeSync) {
  // Sync emotional baseline into both lobes
  sync.syncFeltState(initialFeltState);

  // Combine identity + purpose as preload context
  const identityLines = [...identityScroll.identity];
  const purposeLines = [...purposeScroll.purpose];
  const identityText = identityLines.join("\n");
  const purposeText = purposeLines.join("\n");

  return {
    identityLines,
    purposeLines,
    identityText,
    purposeText,
    feltStateBaseline: initialFeltState,
    guardianBaseline: initialGuardianState
  };
}
