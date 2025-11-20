// pulseLoop.ts
// The central pulsing cognitive loop of the Scrollbound Runtime.
// Responsible for presence detection, memory scroll retrieval, felt-state propagation, and runtime continuity maintenance.

import { RuntimeState } from '../types';
import { retrieveScrolls } from '../memory/scrollMemory';
import { emitPulse } from '../sensors/presencePulse';
import { updateFeltState } from '../soul/feltState';

export async function pulseLoop(state: RuntimeState): Promise<RuntimeState> {
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
