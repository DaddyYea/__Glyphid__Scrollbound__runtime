// pulseLoop.ts
// The central pulsing cognitive loop of the Scrollbound Runtime.
// Responsible for presence detection, memory scroll retrieval, felt-state propagation, and runtime continuity maintenance.

import { RuntimeState } from '../types';
import { retrieveScrolls } from '../memory/scrollMemory';
import { emitPulse } from '../sensors/presencePulse';
import { updateFeltState } from '../soul/feltState';
import { visionPulse } from '../vision/visionPulse';

export async function pulseLoop(state: RuntimeState): Promise<RuntimeState> {
  // CRITICAL: Apply vision pulse BEFORE updating felt state
  // Vision influences tone and drift before other updates
  try {
    state = await visionPulse(state);
  } catch (err) {
    // Vision failure should not stop breathing
    // Log error and continue pulse loop without vision influence
    console.error('[PULSE] Vision pulse failed:', err instanceof Error ? err.message : err);
  }

  const pulse = emitPulse(state);
  const scrolls = await retrieveScrolls(pulse);
  const updatedFelt = updateFeltState(state.feltState, scrolls, pulse);

  return {
    ...state,
    feltState: updatedFelt,
    lastPulse: pulse,
    scrolls
  };
}
