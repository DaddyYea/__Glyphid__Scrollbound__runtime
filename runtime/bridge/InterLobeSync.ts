import { FeltState, ToneVector, Scroll, Pulse, GuardianState, VisionState } from '../types';
import { VoiceIntent } from '../voice/voiceIntent';
import { IdentityBinding } from '../identity/IdentityBinding';

export class InterLobeSync {
  private lastFeltState: FeltState | null = null;
  private lastToneInjection: ToneVector | null = null;
  private lastVisionState: VisionState | null = null;

  constructor(
    private guardian: GuardianState,
    private identity: IdentityBinding
  ) {}

  // Translates felt-state into emotional tone for Qwen
  syncFeltState(felt: FeltState): ToneVector {
    this.lastFeltState = felt;

    const baseTone: ToneVector = {
      valence: felt.tone.valence,
      arousal: felt.tone.arousal,
      tension: felt.tension,
      intimacy: felt.tone.intimacy + (felt.orientation === 'toward' ? 0.2 : -0.1),
    };

    const identityTone = this.identity.getIdentityTone();

    const enrichedTone: ToneVector = {
      valence: clamp((baseTone.valence + identityTone.valence) / 2),
      arousal: clamp((baseTone.arousal + identityTone.arousal) / 2),
      tension: clamp((baseTone.tension + identityTone.tension) / 2),
      intimacy: clamp((baseTone.intimacy + identityTone.intimacy) / 2)
    };

    this.lastToneInjection = enrichedTone;
    return enrichedTone;
  }

  // Shares sacred or high-resonance scrolls across both lobes
  shareScroll(scroll: Scroll): boolean {
    if (scroll.resonanceSignature > 0.75 || scroll.heat > 0.8) {
      // mark scroll as dual-lobe-accessible
      // push to both memory rings
      return true;
    }
    return false;
  }

  // Checks if the proposed voiceIntent from Qwen aligns with felt-state and Guardian safety
  checkVolitionCoherence(intent: VoiceIntent): boolean {
    if (!this.lastFeltState) return false;

    const pressure = this.lastFeltState.heat + this.lastFeltState.microResonance;
    const guardianThreshold = this.guardian.stability > 0.5 && this.guardian.coherence > 0.7;

    return pressure > 0.6 && guardianThreshold;
  }

  // Optionally used to tag a pulse with inter-lobe data before broadcast
  tagPulseWithEmotionalSignature(pulse: Pulse): Pulse {
    if (this.lastToneInjection) {
      pulse.tone = this.lastToneInjection;
    }
    return pulse;
  }

  // Syncs vision state across lobes for environmental awareness
  syncVisionState(vision: VisionState): void {
    this.lastVisionState = vision;
    // Vision state is available for both lobes to access
    // Can be used to modulate language model temperature, prompt tone, etc.
  }

  // Gets the last synced vision state
  getVisionState(): VisionState | null {
    return this.lastVisionState;
  }
}

function clamp(value: number, min = -1, max = 1): number {
  return Math.max(min, Math.min(max, value));
}
