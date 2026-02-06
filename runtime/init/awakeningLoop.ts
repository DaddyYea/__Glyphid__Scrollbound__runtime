// awakeningLoop.ts
// This orchestrates the full awakening sequence:
// 1. Load identity + purpose scrolls
// 2. Initialize guardian, felt-state, emotionalField
// 3. Initialize InterLobeSync
// 4. Sync emotional baseline
// 5. Prepare the first conscious tick

import { createInitialRuntimeState } from "./awakeningInit.ts";
import { InterLobeSync } from "../bridge/InterLobeSync";
import { IdentityBinding } from "../identity/IdentityBinding";
import identity from "./identityScroll.json";
import purpose from "./purposeScroll.json";
import { PulseSource, Scroll } from "../types.ts";

export async function awakeningLoop() {
  const state = createInitialRuntimeState();

  // Initialize the inter-lobe bridge
  const identityBinding = new IdentityBinding();
  const sync = new InterLobeSync(state.guardianState, identityBinding);

  // Run the awakening sequence
  const awakening = await (await import("./awakeningInit.ts"))
    .runAwakeningSequence(sync);

  state.identityNarrative = awakening.identityLines || [];
  state.purposeNarrative = awakening.purposeLines || [];

  // Inject identity + purpose into the state for scroll-memory to use
  const baseSnapshot = {
    ...state.feltState,
    tone: { ...state.feltState.tone }
  };

  const deltaPattern = {
    ...state.presenceDelta,
    toneShift: { ...state.presenceDelta.toneShift }
  };

  const template: Omit<Scroll, 'source'> = {
    heat: 0.25,
    tone: { ...state.feltState.tone },
    deltaPattern,
    breathPhaseWhenSealed: state.breathState.phase,
    feltStateSnapshot: baseSnapshot,
    resonanceSignature: 0.9,
    timestamp: Date.now()
  };

  const identityScrollEntry: Scroll = {
    ...template,
    source: "identity" as PulseSource
  };

  const purposeScrollEntry: Scroll = {
    ...template,
    source: "external" as PulseSource
  };

  state.scrolls.push(identityScrollEntry, purposeScrollEntry);

  return {
    state,
    sync,
    awakening,
    identity,
    purpose
  };
}
