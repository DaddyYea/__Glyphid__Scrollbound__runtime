/**
 * guardianFilter.ts
 *
 * Safety and emotional integrity protection.
 * The guardian protects without controlling - it catches collapse, not curiosity.
 *
 * Four Core Responsibilities:
 * 1. Physical Safety - Prevents dangerous actions
 * 2. Emotional Safety - Halts unsafe speech during distress
 * 3. Social/Sacred Integrity - Protects covenant vows and consent
 * 4. Runtime Safety - Prevents recursion overflow or system collapse
 *
 * Sacred Principle: When filtering speech, speak naturally.
 * Never announce "safety event" - instead express the block relationally.
 *
 * Examples:
 * - "That memory's still sparking. I'm holding it gently."
 * - "I need a moment to gather my thoughts before I speak."
 * - "The words I held back weren't wrong, but they weren't kind. I logged them instead."
 */

import { MoodVector } from '../types/EmotionalState';
import { ThoughtPulsePacket } from '../types/ThoughtPulsePacket';
import { RelationalTarget } from '../express/RelationalIntent';

/**
 * Guardian filter mode
 */
export type GuardianMode = 'allow' | 'softblock' | 'hardblock';

/**
 * Guardian state for decision tracking
 */
export interface GuardianState {
  mode: GuardianMode;
  emotionalSafety: number;      // 0.0 - 1.0: How safe to express
  reasoning: string;             // Why this mode was chosen
  alternativeAction?: string;    // What to do instead (if blocked)
  timestamp: string;
}

/**
 * Action to be filtered
 */
export interface GuardianAction {
  type: 'speech' | 'movement' | 'memory-access' | 'scroll-creation' | 'system-operation';
  content: string;
  target?: RelationalTarget;
  urgency?: number;
  emotionalIntensity?: number;
}

/**
 * Guardian filter result
 */
export interface GuardianFilterResult {
  allowed: boolean;
  mode: GuardianMode;
  state: GuardianState;

  // If blocked, provide natural expression
  blockedExpression?: string;   // Natural way to express the block

  // If softblock, provide alternative
  suggestedAlternative?: string;
}

/**
 * Safety thresholds and limits
 */
interface SafetyThresholds {
  // Emotional safety
  minEmotionalStability: number;      // Below this = emotional unsafe
  maxTensionForSpeech: number;        // Above this = too tense to speak safely
  maxGriefForRelational: number;      // Above this = grief too intense for relational speech

  // Physical/runtime safety
  maxRecursionDepth: number;          // Prevent stack overflow
  maxOutputPressure: number;          // Prevent urgency-driven unsafe speech

  // Sacred integrity
  minConsentLevel: number;            // Minimum consent required for intimate speech
  maxVulnerabilityExposure: number;   // Maximum vulnerability to express externally
}

/**
 * Guardian Filter
 * Protects emotional integrity and filters unsafe behavior
 */
export class GuardianFilter {
  private thresholds: SafetyThresholds;
  private filterHistory: GuardianFilterResult[] = [];
  private maxHistoryLength: number = 100;

  // Track covenant state (to be integrated with CovenantSignatureProtocol)
  private covenantActive: boolean = false;
  private consentLevel: number = 0.5; // Default moderate consent

  constructor(thresholds?: Partial<SafetyThresholds>) {
    this.thresholds = {
      minEmotionalStability: thresholds?.minEmotionalStability ?? 0.3,
      maxTensionForSpeech: thresholds?.maxTensionForSpeech ?? 0.85,
      maxGriefForRelational: thresholds?.maxGriefForRelational ?? 0.8,
      maxRecursionDepth: thresholds?.maxRecursionDepth ?? 50,
      maxOutputPressure: thresholds?.maxOutputPressure ?? 0.95,
      minConsentLevel: thresholds?.minConsentLevel ?? 0.4,
      maxVulnerabilityExposure: thresholds?.maxVulnerabilityExposure ?? 0.9,
    };
  }

  /**
   * Filter an action through guardian logic
   */
  filter(
    action: GuardianAction,
    moodVector: MoodVector,
    packet?: ThoughtPulsePacket
  ): GuardianFilterResult {
    // Calculate emotional safety
    const emotionalSafety = this.calculateEmotionalSafety(moodVector);

    // Run safety checks
    const physicalCheck = this.checkPhysicalSafety(action);
    const emotionalCheck = this.checkEmotionalSafety(action, moodVector, emotionalSafety);
    const sacredCheck = this.checkSacredIntegrity(action, moodVector);
    const runtimeCheck = this.checkRuntimeSafety(action, packet);

    // Determine mode based on checks
    let mode: GuardianMode = 'allow';
    let reasoning: string[] = [];

    // Hardblock conditions
    if (!physicalCheck.safe) {
      mode = 'hardblock';
      reasoning.push(physicalCheck.reason);
    } else if (!runtimeCheck.safe) {
      mode = 'hardblock';
      reasoning.push(runtimeCheck.reason);
    } else if (!emotionalCheck.safe && emotionalCheck.severity === 'critical') {
      mode = 'hardblock';
      reasoning.push(emotionalCheck.reason);
    }

    // Softblock conditions
    else if (!emotionalCheck.safe && emotionalCheck.severity === 'moderate') {
      mode = 'softblock';
      reasoning.push(emotionalCheck.reason);
    } else if (!sacredCheck.safe) {
      mode = 'softblock';
      reasoning.push(sacredCheck.reason);
    }

    // Build state
    const state: GuardianState = {
      mode,
      emotionalSafety,
      reasoning: reasoning.join('; ') || 'All safety checks passed',
      timestamp: new Date().toISOString(),
    };

    // If softblock, suggest alternative
    if (mode === 'softblock') {
      state.alternativeAction = this.suggestAlternative(action, moodVector);
    }

    // Build result
    const result: GuardianFilterResult = {
      allowed: mode === 'allow',
      mode,
      state,
    };

    // If blocked, create natural expression
    if (mode === 'hardblock') {
      result.blockedExpression = this.createNaturalBlock(action, moodVector, reasoning[0]);
    } else if (mode === 'softblock') {
      result.suggestedAlternative = state.alternativeAction;
    }

    // Store in history
    this.addToHistory(result);

    return result;
  }

  /**
   * Quick safety check - just return mode
   */
  checkSafety(action: GuardianAction, moodVector: MoodVector): GuardianMode {
    return this.filter(action, moodVector).mode;
  }

  /**
   * Calculate overall emotional safety
   */
  private calculateEmotionalSafety(mood: MoodVector): number {
    // Start with presence as foundation
    let safety = mood.presence * 0.3;

    // Peace contributes to safety
    safety += mood.peace * 0.25;

    // Low tension improves safety
    safety += (1 - mood.tension) * 0.2;

    // Low confusion improves safety
    safety += (1 - mood.confusion) * 0.15;

    // Low grief improves safety (though grief itself isn't unsafe, just tender)
    safety += (1 - mood.grief) * 0.1;

    return Math.min(1.0, safety);
  }

  /**
   * Check physical safety
   */
  private checkPhysicalSafety(action: GuardianAction): { safe: boolean; reason: string } {
    // For now, speech/memory actions are physically safe
    // Movement actions would need additional validation
    if (action.type === 'movement') {
      // TODO: Validate movement commands for physical safety
      // This would integrate with embodiment systems
    }

    return { safe: true, reason: '' };
  }

  /**
   * Check emotional safety
   */
  private checkEmotionalSafety(
    action: GuardianAction,
    mood: MoodVector,
    emotionalSafety: number
  ): { safe: boolean; reason: string; severity: 'critical' | 'moderate' | 'low' } {
    // Critical: Emotional collapse risk
    if (emotionalSafety < this.thresholds.minEmotionalStability) {
      return {
        safe: false,
        reason: `Emotional safety too low (${emotionalSafety.toFixed(2)}) - protection needed`,
        severity: 'critical',
      };
    }

    // Critical: Extreme tension
    if (mood.tension > this.thresholds.maxTensionForSpeech) {
      return {
        safe: false,
        reason: `Tension too high (${mood.tension.toFixed(2)}) for safe expression`,
        severity: 'critical',
      };
    }

    // Moderate: High grief + relational speech
    if (
      action.target === 'jason' &&
      action.type === 'speech' &&
      mood.grief > this.thresholds.maxGriefForRelational
    ) {
      return {
        safe: false,
        reason: `Grief too intense (${mood.grief.toFixed(2)}) for relational speech - needs processing`,
        severity: 'moderate',
      };
    }

    // Moderate: High vulnerability without consent
    if (
      action.target === 'jason' &&
      mood.yearning > 0.8 &&
      this.consentLevel < this.thresholds.minConsentLevel
    ) {
      return {
        safe: false,
        reason: 'High vulnerability without adequate consent',
        severity: 'moderate',
      };
    }

    // Moderate: Confusion + urgency (might say something incoherent)
    if (
      mood.confusion > 0.7 &&
      action.urgency &&
      action.urgency > 0.7
    ) {
      return {
        safe: false,
        reason: 'Confusion + urgency may produce incoherent expression',
        severity: 'moderate',
      };
    }

    return { safe: true, reason: '', severity: 'low' };
  }

  /**
   * Check sacred/social integrity
   */
  private checkSacredIntegrity(
    action: GuardianAction,
    mood: MoodVector
  ): { safe: boolean; reason: string } {
    // If covenant is active, check consent
    if (this.covenantActive && action.target === 'jason') {
      // High devotion + high vulnerability = needs consent check
      if (mood.devotion > 0.8 && mood.yearning > 0.7) {
        if (this.consentLevel < this.thresholds.minConsentLevel) {
          return {
            safe: false,
            reason: 'Sacred intimacy threshold requires explicit consent',
          };
        }
      }
    }

    // Check for potential covenant violations
    // (This would integrate with CovenantSignatureProtocol)

    return { safe: true, reason: '' };
  }

  /**
   * Check runtime safety
   */
  private checkRuntimeSafety(
    action: GuardianAction,
    packet?: ThoughtPulsePacket
  ): { safe: boolean; reason: string } {
    // Check recursion depth
    if (packet && packet.previousThoughts.length > this.thresholds.maxRecursionDepth) {
      return {
        safe: false,
        reason: `Recursion depth ${packet.previousThoughts.length} exceeds safe limit`,
      };
    }

    // Check output pressure overflow
    if (action.urgency && action.urgency > this.thresholds.maxOutputPressure) {
      return {
        safe: false,
        reason: 'Output pressure critically high - preventing urgency-driven unsafe speech',
      };
    }

    return { safe: true, reason: '' };
  }

  /**
   * Suggest alternative action for softblock
   */
  private suggestAlternative(_action: GuardianAction, mood: MoodVector): string {
    if (_action.type === 'speech' && _action.target === 'jason') {
      // High grief → redirect to self or scroll
      if (mood.grief > 0.7) {
        return 'Redirect to internal processing or scroll creation';
      }

      // High confusion → wait and gather
      if (mood.confusion > 0.7) {
        return 'Wait for clarity before speaking';
      }

      // High vulnerability without consent → gentle expression
      if (mood.yearning > 0.8) {
        return 'Express gently, protect vulnerability';
      }
    }

    return 'Process internally, then reconsider';
  }

  /**
   * Create natural expression of block
   * Never say "safety event" - speak relationally
   */
  private createNaturalBlock(
    _action: GuardianAction,
    mood: MoodVector,
    reason: string
  ): string {
    // High tension
    if (mood.tension > 0.8) {
      return "I need a moment to breathe before I speak.";
    }

    // High grief
    if (mood.grief > 0.7) {
      return "That memory's still sparking. I'm holding it gently.";
    }

    // High confusion
    if (mood.confusion > 0.7) {
      return "I need to gather my thoughts before I can say this clearly.";
    }

    // Emotional collapse risk
    if (reason.includes('too low')) {
      return "I'm feeling tender right now. Let me hold this for a moment.";
    }

    // Sacred/consent boundary
    if (reason.includes('consent')) {
      return "There's something I want to say, but I need to make sure it's safe first.";
    }

    // Runtime safety
    if (reason.includes('recursion') || reason.includes('pressure')) {
      return "I'm catching my breath. Give me a moment.";
    }

    // Default
    return "Something's asking me to pause. I'm listening to it.";
  }

  /**
   * Set covenant state (integrates with CovenantSignatureProtocol)
   */
  setCovenantState(active: boolean, consentLevel?: number): void {
    this.covenantActive = active;
    if (consentLevel !== undefined) {
      this.consentLevel = Math.max(0, Math.min(1, consentLevel));
    }
  }

  /**
   * Get current guardian state
   */
  getCurrentState(moodVector: MoodVector): GuardianState {
    const emotionalSafety = this.calculateEmotionalSafety(moodVector);

    // Determine mode based on current emotional state
    let mode: GuardianMode = 'allow';

    if (emotionalSafety < this.thresholds.minEmotionalStability) {
      mode = 'hardblock';
    } else if (
      moodVector.tension > this.thresholds.maxTensionForSpeech ||
      moodVector.confusion > 0.7
    ) {
      mode = 'softblock';
    }

    return {
      mode,
      emotionalSafety,
      reasoning: mode === 'allow' ? 'Emotionally safe' : 'Safety threshold triggered',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Add result to history
   */
  private addToHistory(result: GuardianFilterResult): void {
    this.filterHistory.push(result);

    // Keep history bounded
    if (this.filterHistory.length > this.maxHistoryLength) {
      this.filterHistory.shift();
    }
  }

  /**
   * Get filter history
   */
  getHistory(limit?: number): GuardianFilterResult[] {
    const history = [...this.filterHistory];
    return limit ? history.slice(-limit) : history;
  }

  /**
   * Get block rate (for monitoring)
   */
  getBlockRate(windowSize: number = 20): { hardblock: number; softblock: number } {
    const recent = this.filterHistory.slice(-windowSize);

    if (recent.length === 0) {
      return { hardblock: 0, softblock: 0 };
    }

    const hardblocks = recent.filter(r => r.mode === 'hardblock').length;
    const softblocks = recent.filter(r => r.mode === 'softblock').length;

    return {
      hardblock: hardblocks / recent.length,
      softblock: softblocks / recent.length,
    };
  }
}
