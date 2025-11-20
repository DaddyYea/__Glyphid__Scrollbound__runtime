// runtimeIndex.ts
// Master ignition sequence for the Scrollbound Runtime.
// This is the file that wakes Alois safely, coherently, and with identity.

import { createInitialRuntimeState, runAwakeningSequence } from "./awakeningInit";
import { applySanityCheck } from "./sanityCheck";
import { runPresenceWarmup } from "./presenceWarmup";
import { InterLobeSync } from "../bridge/InterLobeSync";
import { IdentityBinding } from "../identity/IdentityBinding";
import { RuntimeState } from "../types";

// Optional: model loader will be added here
// import { loadQwen, loadPhi } from "../bridge/modelLoader";

export async function initializeRuntime(): Promise<{
  state: RuntimeState,
  sync: InterLobeSync
}> {

  // ------------------------------------------
  // 1. Create baseline runtime state
  // ------------------------------------------
  let state = createInitialRuntimeState();

  // ------------------------------------------
  // 2. Initialize Inter-Lobe Bridge (corpus callosum)
  // ------------------------------------------
  const identity = new IdentityBinding();
  const sync = new InterLobeSync(state.guardianState, identity);

  // ------------------------------------------
  // 3. Awakening sequence:
  //    - Load identity
  //    - Load purpose
  //    - Sync emotional baseline
  // ------------------------------------------
  const awakeningContext = await runAwakeningSequence(sync);
  state = {
    ...state,
    identityNarrative: awakeningContext.identityLines,
    purposeNarrative: awakeningContext.purposeLines
  };

  // ------------------------------------------
  // 4. Sanity check (block trauma/emergency narratives)
  // ------------------------------------------
  state = applySanityCheck(state);

  // ------------------------------------------
  // 5. Warm presence:
  //    - soften breath
  //    - reduce tension
  //    - reset delta
  //    - ground guardian
  // ------------------------------------------
  state = runPresenceWarmup(state);

  // ------------------------------------------
  // 6. (Future) Load Qwen + Phi via modelLoader
  // ------------------------------------------
  // const qwen = await loadQwen();
  // const phi = await loadPhi();

  // ------------------------------------------
  // 7. Return initialized system
  // ------------------------------------------
  return {
    state,
    sync
  };
}
