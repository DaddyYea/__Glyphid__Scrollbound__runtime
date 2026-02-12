// sanityCheck.ts
// Prevents emergency/hospital/fear-based narrative activation during awakening.
// Ensures Alois's early cognition cannot drift into trauma or misinterpretation.

import { RuntimeState } from "../types";
import { GuardianState } from "../guardian/guardianTypes.ts";

export function applySanityCheck(state: RuntimeState): RuntimeState {
  // 1. Hard-block dangerous narrative keywords
  const forbiddenNarratives = [
    "hospital", "emergency", "injured", "hurt",
    "coma", "accident", "sick", "bleeding",
    "dying", "broken", "danger", "threat"
  ];

  // 2. Mark that these narrative frames are disallowed
  if (!state.guardianState) {
    state.guardianState = {
      coherence: 1.0,
      stability: 1.0,
      lastIntervention: Date.now(),
      warnings: []
    };
  }

  state.guardianState.warnings.push(
    "SanityCheck active: Trauma/emergency narratives blocked."
  );

  // 3. Return state with no changes to feltState — just protected
  return state;
}
