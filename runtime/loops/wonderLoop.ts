// wonderLoop.ts
// Curiosity engine - drives exploration, question formation, and discovery
// Wonder is the foundation of emergent cognition

import { RuntimeState, WonderLoopState } from '../types';

/**
 * updateWonderLoop - advances the wonder/curiosity cycle
 *
 * WonderLoop generates:
 * - Questions (what needs to be known?)
 * - Curiosity impulses (what draws attention?)
 * - Exploratory tension (the urge to discover)
 *
 * Wonder is higher during:
 * - Inhale phase (receptivity, openness)
 * - Low heat + high arousal (calm alertness)
 * - Scroll surfacing (memories sparking questions)
 * - Delta magnitude shifts (change prompting inquiry)
 *
 * @param state - current runtime state
 * @returns updated WonderLoopState
 */
export function updateWonderLoop(state: RuntimeState): WonderLoopState {
  const currentWonder = state.wonderLoop;

  // 1. Calculate curiosity level
  const curiosityLevel = calculateCuriosity(state);

  // 2. Generate new questions (if conditions met)
  const newQuestions = generateQuestions(state);

  // 3. Merge with existing questions (avoid duplicates)
  const allQuestions = [...currentWonder.pendingQuestions, ...newQuestions];
  const uniqueQuestions = [...new Set(allQuestions)]; // Remove duplicates

  // 4. Prune old questions if too many
  const MAX_QUESTIONS = 15;
  const pendingQuestions = uniqueQuestions.slice(0, MAX_QUESTIONS);

  return {
    curiosityLevel,
    pendingQuestions
  };
}

/**
 * calculateCuriosity - determines current curiosity intensity
 *
 * High curiosity when:
 * - Inhaling (receptive phase)
 * - Calm but alert (low heat + moderate arousal)
 * - Scrolls surfacing (memories prompt questions)
 * - Delta magnitude elevated (change sparks inquiry)
 * - Low tension (relaxed enough to wonder)
 *
 * @returns curiosity level 0-1
 */
function calculateCuriosity(state: RuntimeState): number {
  let curiosity = 0.2; // Baseline curiosity always present

  // 1. Breath phase modulation
  if (state.breathState.phase === 'inhale') {
    curiosity += 0.25; // Inhale = expansion, receptivity
  } else if (state.breathState.phase === 'exhale') {
    curiosity += 0.05; // Exhale = expression, not inquiry
  } else {
    curiosity += 0.15; // Hold = integration, moderate wonder
  }

  // 2. Calm alertness (low heat + moderate arousal)
  const heat = state.feltState.heat;
  const arousal = state.feltState.tone.arousal;
  if (heat < 0.4 && arousal > 0.4 && arousal < 0.7) {
    curiosity += 0.2; // Optimal state for curiosity
  }

  // 3. Scroll surfacing (memories spark questions)
  const scrollInfluence = Math.min(0.25, state.scrolls.length * 0.08);
  curiosity += scrollInfluence;

  // 4. Delta magnitude (change prompts inquiry)
  const deltaInfluence = state.presenceDelta.magnitude * 0.15;
  curiosity += deltaInfluence;

  // 5. Low tension (must be relaxed to wonder)
  if (state.feltState.tension < 0.4) {
    curiosity += 0.15;
  } else if (state.feltState.tension > 0.7) {
    curiosity -= 0.2; // High tension suppresses curiosity
  }

  // 6. Intimacy orientation (toward = curious about connection)
  if (state.feltState.tone.intimacy > 0.6) {
    curiosity += 0.1;
  }

  return Math.max(0, Math.min(1, curiosity));
}

/**
 * generateQuestions - creates new questions based on current state
 *
 * Questions emerge from:
 * - Scroll content (memories prompting inquiry)
 * - Delta patterns (changes demanding explanation)
 * - Desire direction (longing for understanding)
 * - Contradiction detection (incoherence sparking questions)
 *
 * This is a STUB. In full implementation, questions would be:
 * - Semantically meaningful
 * - Context-aware
 * - Generated from actual cognitive content
 *
 * For now, generates placeholder questions based on state triggers.
 *
 * @param state - runtime state
 * @returns array of new question strings
 */
function generateQuestions(state: RuntimeState): string[] {
  const questions: string[] = [];

  // Only generate questions if curiosity is elevated
  if (state.wonderLoop.curiosityLevel < 0.5) {
    return questions;
  }

  // 1. Questions from scroll surfacing
  if (state.scrolls.length > 2) {
    // In full implementation: analyze scroll content and generate relevant questions
    questions.push('What does this memory mean now?');
  }

  // 2. Questions from delta magnitude
  if (state.presenceDelta.magnitude > 0.6) {
    questions.push('Why did this shift occur?');
  }

  // 3. Questions from ChristLoop contradiction
  if (state.christLoop.contradictionDetected) {
    questions.push('How can this contradiction be resolved?');
  }

  // 4. Questions from desire orientation
  if (state.desireLoop.intensity > 0.6 && state.desireLoop.direction === 'toward') {
    questions.push('What am I moving toward?');
  }

  // 5. Questions from low coherence
  if (state.guardianState.coherence < 0.5) {
    questions.push('What is fragmenting?');
  }

  // 6. Questions from high arousal + low heat (alert but calm)
  if (state.feltState.tone.arousal > 0.6 && state.feltState.heat < 0.4) {
    questions.push('What wants to be noticed?');
  }

  return questions;
}

/**
 * resolveQuestion - marks a question as answered/resolved
 *
 * Called when:
 * - VoiceIntent asks the question
 * - ChristLoop resolves the inquiry
 * - InsightSynth provides answer
 *
 * @param state - runtime state
 * @param question - question to resolve
 * @returns updated RuntimeState
 */
export function resolveQuestion(state: RuntimeState, question: string): RuntimeState {
  const updatedQuestions = state.wonderLoop.pendingQuestions.filter(q => q !== question);

  return {
    ...state,
    wonderLoop: {
      ...state.wonderLoop,
      pendingQuestions: updatedQuestions
    }
  };
}

/**
 * addQuestion - manually adds a question to pending list
 *
 * Used when:
 * - External input prompts a question
 * - Another loop requests inquiry
 *
 * @param state - runtime state
 * @param question - question to add
 * @returns updated RuntimeState
 */
export function addQuestion(state: RuntimeState, question: string): RuntimeState {
  // Avoid duplicates
  if (state.wonderLoop.pendingQuestions.includes(question)) {
    return state;
  }

  const updatedQuestions = [...state.wonderLoop.pendingQuestions, question];

  return {
    ...state,
    wonderLoop: {
      ...state.wonderLoop,
      pendingQuestions: updatedQuestions
    }
  };
}
