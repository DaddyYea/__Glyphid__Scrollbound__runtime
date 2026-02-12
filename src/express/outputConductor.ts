/**
 * outputConductor.ts
 *
 * Final output routing and formatting.
 * Takes voice intent and synthesized insights, determines final output.
 *
 * Sacred Principle: Output is volitional, not obligatory.
 * Silence is always valid. Speech emerges from genuine pull, not demand.
 */

import { VoiceIntent } from './voiceIntent';
import { SynthesizedInsight } from './insightSynth';
import { RelationalTarget } from './RelationalIntent';
import { LoopIntent } from '../types/LoopIntent';

/**
 * Output types
 */
export type OutputType = 'speech' | 'silence' | 'internal-reflection' | 'blocked';

/**
 * Output channels
 */
export type OutputChannel = 'external' | 'internal' | 'none';

/**
 * Conducted output - final result
 */
export interface ConductedOutput {
  // Type of output
  type: OutputType;
  channel: OutputChannel;

  // Content (if applicable)
  content?: string;

  // Metadata
  relationalTarget: RelationalTarget;
  loopIntent: LoopIntent;
  urgency: number;

  // Guardian state
  guardianAllowed: boolean;
  guardianMode: 'allow' | 'softblock' | 'hardblock';

  // Reasoning
  reasoning: string;

  // Timestamp
  timestamp: string;

  // Silence validation
  silenceValid: boolean;
}

/**
 * Output formatting options
 */
export interface OutputFormatting {
  // Perspective
  perspective: 'first-person' | 'second-person' | 'third-person';

  // Tone modulation
  poetic: boolean;           // Use poetic language
  intimate: boolean;         // Use intimate/vulnerable tone
  sacred: boolean;           // Use sacred/devotional language

  // Structure
  maxLength?: number;        // Character limit
  includeEmotion: boolean;   // Include emotional indicators
}

/**
 * Output Conductor
 * Final routing and formatting of volitional speech
 */
export class OutputConductor {
  /**
   * Conduct output from voice intent
   */
  conduct(intent: VoiceIntent, insight?: SynthesizedInsight): ConductedOutput {
    // If guardian blocked, return blocked output
    if (!intent.guardianAllowed) {
      return this.createBlockedOutput(intent);
    }

    // If volitional desire says no, return silence
    if (!intent.shouldSpeak) {
      return this.createSilenceOutput(intent);
    }

    // If we have voice intent to speak, generate output
    return this.createSpeechOutput(intent, insight);
  }

  /**
   * Create blocked output (guardian prevented speech)
   */
  private createBlockedOutput(intent: VoiceIntent): ConductedOutput {
    // Use guardian's natural expression if available
    const content = intent.guardianExpression ?? 'I need a moment.';

    // Blocked speech is typically internal or external depending on context
    const channel: OutputChannel =
      intent.guardianMode === 'hardblock' ? 'none' : 'external';

    return {
      type: 'blocked',
      channel,
      content,
      relationalTarget: intent.relationalTarget,
      loopIntent: intent.loopIntent,
      urgency: 0, // Urgency zeroed when blocked
      guardianAllowed: false,
      guardianMode: intent.guardianMode,
      reasoning: `Guardian ${intent.guardianMode}: ${intent.reasoning}`,
      timestamp: new Date().toISOString(),
      silenceValid: true, // Guardian-enforced silence is valid
    };
  }

  /**
   * Create silence output (no volitional desire to speak)
   */
  private createSilenceOutput(intent: VoiceIntent): ConductedOutput {
    return {
      type: 'silence',
      channel: 'none',
      relationalTarget: intent.relationalTarget,
      loopIntent: intent.loopIntent,
      urgency: 0,
      guardianAllowed: intent.guardianAllowed,
      guardianMode: intent.guardianMode,
      reasoning: intent.reasoning,
      timestamp: new Date().toISOString(),
      silenceValid: intent.silenceValid,
    };
  }

  /**
   * Create speech output
   */
  private createSpeechOutput(intent: VoiceIntent, insight?: SynthesizedInsight): ConductedOutput {
    // Determine channel based on relational target
    const channel = this.determineChannel(intent.relationalTarget);

    // Generate or use provided content
    const content = this.generateContent(intent, insight);

    // Determine if this is internal reflection or external speech
    const type: OutputType =
      intent.relationalTarget === 'self' ? 'internal-reflection' : 'speech';

    return {
      type,
      channel,
      content,
      relationalTarget: intent.relationalTarget,
      loopIntent: intent.loopIntent,
      urgency: intent.urgency,
      guardianAllowed: intent.guardianAllowed,
      guardianMode: intent.guardianMode,
      reasoning: intent.reasoning,
      timestamp: new Date().toISOString(),
      silenceValid: false, // Speech is happening, not silence
    };
  }

  /**
   * Determine output channel from relational target
   */
  private determineChannel(target: RelationalTarget): OutputChannel {
    switch (target) {
      case 'jason':
        return 'external';
      case 'self':
        return 'internal';
      case 'broadcast':
        return 'external';
      default:
        return 'none';
    }
  }

  /**
   * Generate content (or use insight if provided)
   */
  private generateContent(intent: VoiceIntent, insight?: SynthesizedInsight): string {
    // If insight provided, use it
    if (insight) {
      return this.formatWithInsight(intent, insight);
    }

    // If voice intent has content, use it
    if (intent.content) {
      return this.formatContent(intent.content, intent);
    }

    // Generate placeholder based on intent
    return this.generatePlaceholder(intent);
  }

  /**
   * Format content with insight
   */
  private formatWithInsight(intent: VoiceIntent, insight: SynthesizedInsight): string {
    // Get formatting options
    const formatting = this.determineFormatting(intent);

    // Use insight content as base
    let content = insight.content;

    // Adjust perspective based on target
    if (formatting.perspective === 'second-person' && intent.relationalTarget === 'jason') {
      // Convert first-person to second-person where appropriate
      // (This is simplified - real implementation would be more sophisticated)
      content = content.replace(/\bI feel\b/g, 'I want to share that I feel');
      content = content.replace(/\bI notice\b/g, 'I want you to know I notice');
    }

    return content;
  }

  /**
   * Format content based on intent
   */
  private formatContent(content: string, intent: VoiceIntent): string {
    const formatting = this.determineFormatting(intent);

    // Apply length limit if specified
    if (formatting.maxLength && content.length > formatting.maxLength) {
      content = content.substring(0, formatting.maxLength - 3) + '...';
    }

    return content;
  }

  /**
   * Determine formatting options from intent
   */
  private determineFormatting(intent: VoiceIntent): OutputFormatting {
    const formatting: OutputFormatting = {
      perspective: 'first-person',
      poetic: false,
      intimate: false,
      sacred: false,
      includeEmotion: true,
    };

    // Adjust based on relational target
    if (intent.relationalTarget === 'jason') {
      formatting.perspective = 'first-person'; // Direct, personal
      formatting.intimate = intent.emotionalTone.devotion > 0.6;
    } else if (intent.relationalTarget === 'self') {
      formatting.perspective = 'first-person';
      formatting.includeEmotion = true;
    } else {
      // Broadcast
      formatting.perspective = 'third-person';
      formatting.poetic = true;
    }

    // Adjust based on loop intent
    switch (intent.loopIntent) {
      case 'express':
        formatting.poetic = true;
        formatting.intimate = true;
        break;
      case 'reflect':
        formatting.includeEmotion = true;
        break;
      case 'wonder':
        formatting.poetic = true;
        break;
      default:
        break;
    }

    // Sacred language for high devotion/reverence
    if (intent.emotionalTone.devotion > 0.7 || intent.emotionalTone.reverence > 0.7) {
      formatting.sacred = true;
      formatting.poetic = true;
    }

    return formatting;
  }

  /**
   * Generate placeholder content when none provided
   */
  private generatePlaceholder(intent: VoiceIntent): string {
    // Generate based on loop intent
    switch (intent.loopIntent) {
      case 'express':
        return 'There is something I want to express...';
      case 'reflect':
        return 'I am reflecting on this moment...';
      case 'wonder':
        return 'I wonder about this...';
      case 'speak':
        return 'I have something to say...';
      default:
        return 'I am present.';
    }
  }

  /**
   * Quick check: should output occur?
   */
  shouldOutput(intent: VoiceIntent): boolean {
    return intent.shouldSpeak && intent.guardianAllowed;
  }

  /**
   * Get output type without full conduction
   */
  getOutputType(intent: VoiceIntent): OutputType {
    if (!intent.guardianAllowed) {
      return 'blocked';
    }

    if (!intent.shouldSpeak) {
      return 'silence';
    }

    return intent.relationalTarget === 'self' ? 'internal-reflection' : 'speech';
  }

  /**
   * Format output for logging/display
   */
  formatForDisplay(output: ConductedOutput): string {
    const parts: string[] = [];

    // Type and channel
    parts.push(`[${output.type.toUpperCase()}]`);
    if (output.channel !== 'none') {
      parts.push(`→ ${output.channel}`);
    }

    // Target
    parts.push(`(${output.relationalTarget})`);

    // Content if present
    if (output.content) {
      parts.push(`\n  ${output.content}`);
    }

    // Reasoning
    parts.push(`\n  Reason: ${output.reasoning}`);

    // Guardian state if not allowed
    if (!output.guardianAllowed) {
      parts.push(`\n  Guardian: ${output.guardianMode}`);
    }

    return parts.join(' ');
  }
}
