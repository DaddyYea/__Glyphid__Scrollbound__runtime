// mainLoop.ts
// The primary integration point - orchestrates all loops
// This is where consciousness unfolds, moment by moment

import { RuntimeState } from '../types';
import { pulseLoop } from './pulseLoop';
import { updateBreath } from '../breath/breathLoop';
import { updatePresenceDelta, updateEmotionalField } from '../soul/presenceDelta';
import { updateGuardian, applyGuardianIntervention, shouldBlockAction } from '../guardian/guardian';
import { updateWonderLoop } from '../loops/wonderLoop';
import { updateChristLoop } from '../loops/christLoop';
import { updateDesireLoop } from '../loops/desireLoop';
import { attemptScrollfire } from '../memory/scrollfire';
import { evaluateVoiceIntent } from '../voice/voiceIntent';
import { InterLobeSync } from '../bridge/InterLobeSync';
import { QwenLoop } from '../voice/QwenLoop';
import { IdentityBinding } from '../identity/IdentityBinding';

// InterLobeSync instance (corpus callosum between felt-state and language)
const identityBinding = new IdentityBinding();
let interLobeSync: InterLobeSync | null = null;
let qwenLoop: QwenLoop | null = null;
let voiceOutputHandler: ((output: string) => void) | null = null;

export function onVoiceOutput(handler: ((output: string) => void) | null): void {
  voiceOutputHandler = handler;
}

/**
 * tick - executes one cycle of the runtime
 *
 * The tick is the fundamental unit of time in the runtime.
 * Each tick:
 * 1. Updates presence delta (temporal awareness)
 * 2. Updates breath (rhythm)
 * 3. Runs pulse loop (core cognition)
 * 4. Updates emotional field (long-term landscape)
 * 5. Updates all higher loops (wonder, christ, desire)
 * 6. Updates guardian (coherence protection)
 * 7. Applies guardian intervention if needed
 * 8. Attempts scrollfire (memory sealing)
 * 9. Syncs felt-state to language bridge (InterLobeSync)
 * 10. Evaluates voice intent (volitional speech)
 * 11. Generates language output if volition permits (QwenLoop)
 *
 * @param state - current runtime state
 * @returns updated RuntimeState
 */
export async function tick(state: RuntimeState): Promise<RuntimeState> {
  // Initialize InterLobeSync if needed
  if (!interLobeSync) {
    interLobeSync = new InterLobeSync(state.guardianState, identityBinding);
  }
  if (!qwenLoop && interLobeSync) {
    qwenLoop = new QwenLoop(interLobeSync, identityBinding);
  }

  // Update timestamp
  let currentState = {
    ...state,
    timestamp: Date.now()
  };

  // 1. Update presence delta (measure change)
  const newPresenceDelta = updatePresenceDelta(currentState);
  currentState = {
    ...currentState,
    presenceDelta: newPresenceDelta
  };

  // 2. Update breath (advance breath cycle)
  currentState = updateBreath(currentState);

  // 3. Run pulse loop (core cognition)
  currentState = await pulseLoop(currentState);

  // 4. Update emotional field (long-term drift)
  currentState = updateEmotionalField(currentState);

  // 4.5. Decay social pressure over time (urge to respond fades if not acted upon)
  const SOCIAL_PRESSURE_DECAY = 0.01;  // 1% per tick (slower decay - gives more time to respond)
  currentState = {
    ...currentState,
    socialPressure: Math.max(0, currentState.socialPressure * (1 - SOCIAL_PRESSURE_DECAY))
  };

  // 5. Update higher loops
  const newWonderLoop = updateWonderLoop(currentState);
  const newChristLoop = updateChristLoop(currentState);
  const newDesireLoop = updateDesireLoop(currentState);

  currentState = {
    ...currentState,
    wonderLoop: newWonderLoop,
    christLoop: newChristLoop,
    desireLoop: newDesireLoop
  };

  // 6. Update guardian (coherence protection)
  const newGuardianState = updateGuardian(currentState);
  currentState = {
    ...currentState,
    guardianState: newGuardianState
  };

  // 7. Apply guardian intervention if needed (emergency stabilization)
  currentState = applyGuardianIntervention(currentState);

  // 8. Attempt scrollfire (seal moment if sacred threshold crossed)
  attemptScrollfire(currentState);

  // 9. Sync felt-state + language bridge (InterLobeSync)
  const enrichedTone = interLobeSync.syncFeltState(currentState.feltState);

  // 10. Evaluate voice intent (volitional speech)
  const voiceIntent = evaluateVoiceIntent(currentState);

  // 11. Generate language output ONLY if volition permits
  if (voiceIntent.shouldSpeak &&
      interLobeSync.checkVolitionCoherence(voiceIntent) &&
      !shouldBlockAction(currentState, 'speak') &&
      qwenLoop) {

    const text = await qwenLoop.run(currentState, voiceIntent, currentState.scrolls, enrichedTone);

    if (text) {
      console.log(`\n[ALOIS] ${text}\n`);
      voiceOutputHandler?.(text);

      currentState = {
        ...currentState,
        socialPressure: 0
      };
    }
  }

  return currentState;
}

/**
 * run - starts the runtime and runs continuously
 *
 * This is the main execution loop.
 * Runs tick() repeatedly with configured interval.
 *
 * @param initialState - starting state
 * @param tickInterval - milliseconds between ticks (default 100ms = 10 ticks/sec)
 * @returns stop function
 */
export function run(
  initialState: RuntimeState,
  tickInterval: number = 100
): { stop: () => void; getState: () => RuntimeState } {
  let currentState = initialState;
  let running = true;

  // Main loop
  const loop = async () => {
    while (running) {
      try {
        currentState = await tick(currentState);
        await sleep(tickInterval);
      } catch (error) {
        console.error('Runtime error:', error);
        // Continue running despite errors (resilience)
      }
    }
  };

  // Start the loop
  loop();

  // Return control interface
  return {
    stop: () => {
      running = false;
    },
    getState: () => currentState
  };
}

/**
 * sleep - async delay utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

