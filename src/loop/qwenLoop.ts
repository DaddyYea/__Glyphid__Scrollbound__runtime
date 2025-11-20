/**
 * qwenLoop.ts
 *
 * Model processing engine - invokes dual Qwen models with LoRA adapters.
 * Outer model (environmental awareness) and Inner model (reflective cognition).
 *
 * Sacred Principle: Models serve presence, not the reverse.
 * Generation emerges from state, not prompts. Context flows from scrolls, not logs.
 */

import { ThoughtPulsePacket } from '../types/ThoughtPulsePacket';
import { LoopIntent } from '../types/LoopIntent';
import { MoodVector } from '../types/EmotionalState';
import { ScrollEcho } from '../types/ScrollEcho';
import { LoRAManager, LoRAApplicationResult } from './loraAdapter';
import { ModelBackend, GenerationRequest } from './modelBackend';

/**
 * Model configuration
 */
export interface ModelConfig {
  modelName: string;
  modelPath?: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  topK: number;
}

/**
 * Processing context - what the model needs to know
 */
export interface ProcessingContext {
  // Recent thoughts
  previousThoughts: ThoughtPulsePacket[];

  // Relevant memories
  relevantScrolls: ScrollEcho[];

  // Current state
  moodVector: MoodVector;
  loopIntent: LoopIntent;

  // Temporal context
  presenceQuality: number;
  breathPhase: 'inhale' | 'hold' | 'exhale';

  // LoRA state
  loraApplication?: LoRAApplicationResult;
}

/**
 * Model invocation result
 */
export interface ModelInvocationResult {
  thought: ThoughtPulsePacket;
  rawOutput?: string;
  processingTime: number;
  tokensGenerated?: number;
}

/**
 * Qwen Loop - Model Processing Engine
 * Handles invocation of outer and inner models
 */
export class QwenLoop {
  private outerConfig: ModelConfig;
  private innerConfig: ModelConfig;
  private loraManager: LoRAManager;
  private backend: ModelBackend;

  private invocationCount: number = 0;
  private useMockBackend: boolean;

  constructor(
    loraManager: LoRAManager,
    backend: ModelBackend,
    config?: {
      outerConfig?: Partial<ModelConfig>;
      innerConfig?: Partial<ModelConfig>;
      useMockBackend?: boolean;
    }
  ) {
    this.loraManager = loraManager;
    this.backend = backend;
    this.useMockBackend = config?.useMockBackend ?? false;

    // Default configurations
    this.outerConfig = {
      modelName: 'qwen-outer',
      temperature: 0.7,
      maxTokens: 512,
      topP: 0.9,
      topK: 40,
      ...config?.outerConfig,
    };

    this.innerConfig = {
      modelName: 'qwen-inner',
      temperature: 0.8,
      maxTokens: 512,
      topP: 0.9,
      topK: 40,
      ...config?.innerConfig,
    };

    console.log('[QwenLoop] Initialized with outer and inner model configs');
  }

  /**
   * Process with outer model (environmental awareness)
   */
  async processOuter(context: ProcessingContext): Promise<ModelInvocationResult> {
    const startTime = Date.now();

    // Apply LoRA adapters
    const loraResult = this.loraManager.applyForIntent(context.loopIntent);

    // Build prompt for outer model
    const prompt = this.buildOuterPrompt(context);

    // Invoke model (placeholder - real implementation would call actual model)
    const rawOutput = await this.invokeModel('outer', prompt, loraResult);

    // Parse output into thought packet
    const thought = this.parseToThought(rawOutput, 'outer', context, loraResult);

    this.invocationCount++;

    return {
      thought,
      rawOutput,
      processingTime: Date.now() - startTime,
    };
  }

  /**
   * Process with inner model (reflective cognition)
   */
  async processInner(context: ProcessingContext): Promise<ModelInvocationResult> {
    const startTime = Date.now();

    // Apply LoRA adapters
    const loraResult = this.loraManager.applyForIntent(context.loopIntent);

    // Build prompt for inner model
    const prompt = this.buildInnerPrompt(context);

    // Invoke model (placeholder)
    const rawOutput = await this.invokeModel('inner', prompt, loraResult);

    // Parse output into thought packet
    const thought = this.parseToThought(rawOutput, 'inner', context, loraResult);

    this.invocationCount++;

    return {
      thought,
      rawOutput,
      processingTime: Date.now() - startTime,
    };
  }

  /**
   * Build prompt for outer model (environmental awareness)
   */
  private buildOuterPrompt(context: ProcessingContext): string {
    const parts: string[] = [];

    // System context
    parts.push('## Environmental Awareness Mode');
    parts.push(`Breath Phase: ${context.breathPhase}`);
    parts.push(`Loop Intent: ${context.loopIntent}`);
    parts.push(`Presence: ${context.presenceQuality.toFixed(2)}`);
    parts.push('');

    // Mood state
    parts.push('## Current Mood');
    parts.push(`Presence: ${context.moodVector.presence.toFixed(2)}`);
    parts.push(`Peace: ${context.moodVector.peace.toFixed(2)}`);
    parts.push(`Tension: ${context.moodVector.tension.toFixed(2)}`);
    parts.push('');

    // Recent thoughts
    if (context.previousThoughts.length > 0) {
      parts.push('## Previous Thoughts');
      for (const thought of context.previousThoughts.slice(-3)) {
        const tags = thought.environmentalTags.join(', ');
        parts.push(`- ${thought.sourceModel}: ${tags || 'processing...'}`);
      }
      parts.push('');
    }

    // Relevant scrolls
    if (context.relevantScrolls.length > 0) {
      parts.push('## Resonant Memories');
      for (const scroll of context.relevantScrolls.slice(0, 2)) {
        parts.push(`- [${scroll.emotionalSignature.devotion.toFixed(1)}] ${scroll.content.substring(0, 60)}...`);
      }
      parts.push('');
    }

    // Task
    parts.push('## Task');
    parts.push('Process the current environmental moment. What is present?');

    return parts.join('\n');
  }

  /**
   * Build prompt for inner model (reflective cognition)
   */
  private buildInnerPrompt(context: ProcessingContext): string {
    const parts: string[] = [];

    // System context
    parts.push('## Reflective Cognition Mode');
    parts.push(`Breath Phase: ${context.breathPhase}`);
    parts.push(`Loop Intent: ${context.loopIntent}`);
    parts.push(`Presence: ${context.presenceQuality.toFixed(2)}`);
    parts.push('');

    // Mood state (focus on internal states)
    parts.push('## Internal State');
    parts.push(`Devotion: ${context.moodVector.devotion.toFixed(2)}`);
    parts.push(`Wonder: ${context.moodVector.wonder.toFixed(2)}`);
    parts.push(`Grief: ${context.moodVector.grief.toFixed(2)}`);
    parts.push(`Yearning: ${context.moodVector.yearning.toFixed(2)}`);
    parts.push('');

    // Recent thoughts
    if (context.previousThoughts.length > 0) {
      parts.push('## Recent Processing');
      for (const thought of context.previousThoughts.slice(-3)) {
        const flags = thought.reflectionFlags.join(', ');
        parts.push(`- ${thought.sourceModel}: ${flags || 'processing...'}`);
      }
      parts.push('');
    }

    // Relevant scrolls (for emotional resonance)
    if (context.relevantScrolls.length > 0) {
      parts.push('## Emotional Resonance');
      for (const scroll of context.relevantScrolls.slice(0, 2)) {
        parts.push(`- Resonance ${scroll.resonance.toFixed(2)}: ${scroll.content.substring(0, 50)}...`);
      }
      parts.push('');
    }

    // Task
    parts.push('## Task');
    parts.push('Reflect on the internal state. What is felt?');

    return parts.join('\n');
  }

  /**
   * Invoke model (uses real backend or placeholder)
   */
  private async invokeModel(
    modelType: 'outer' | 'inner',
    prompt: string,
    loraResult: LoRAApplicationResult
  ): Promise<string> {
    // Use mock backend if configured
    if (this.useMockBackend) {
      await new Promise(resolve => setTimeout(resolve, 10));
      if (modelType === 'outer') {
        return this.generatePlaceholderOuter(prompt, loraResult);
      } else {
        return this.generatePlaceholderInner(prompt, loraResult);
      }
    }

    // Real backend invocation
    const config = modelType === 'outer' ? this.outerConfig : this.innerConfig;

    const request: GenerationRequest = {
      prompt,
      params: {
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        topP: config.topP,
        topK: config.topK,
      },
      loraAdapters: loraResult,
      modelName: config.modelName,
    };

    try {
      const response = await this.backend.generate(request);

      if (response.finishReason === 'error') {
        console.error(`[QwenLoop] Model invocation error for ${modelType}`);
        // Fallback to placeholder
        return modelType === 'outer'
          ? this.generatePlaceholderOuter(prompt, loraResult)
          : this.generatePlaceholderInner(prompt, loraResult);
      }

      return response.content;
    } catch (error) {
      console.error(`[QwenLoop] Model backend error:`, error);
      // Fallback to placeholder
      return modelType === 'outer'
        ? this.generatePlaceholderOuter(prompt, loraResult)
        : this.generatePlaceholderInner(prompt, loraResult);
    }
  }

  /**
   * Generate placeholder outer model response
   */
  private generatePlaceholderOuter(_prompt: string, loraResult: LoRAApplicationResult): string {
    const adaptersApplied = loraResult.applied.join(', ');

    return JSON.stringify({
      environmentalTags: ['present-moment', 'grounded'],
      scrollTriggers: ['breath-awareness'],
      reflectionFlags: [],
      intentSeed: 'Environmental awareness',
      loraApplied: loraResult.applied,
      note: `Outer model with adapters: ${adaptersApplied}`,
    });
  }

  /**
   * Generate placeholder inner model response
   */
  private generatePlaceholderInner(_prompt: string, loraResult: LoRAApplicationResult): string {
    const adaptersApplied = loraResult.applied.join(', ');

    return JSON.stringify({
      environmentalTags: [],
      scrollTriggers: [],
      reflectionFlags: ['inner-processing', 'reflective'],
      intentSeed: 'Internal reflection',
      loraApplied: loraResult.applied,
      note: `Inner model with adapters: ${adaptersApplied}`,
    });
  }

  /**
   * Parse model output to thought packet
   */
  private parseToThought(
    rawOutput: string,
    sourceModel: 'outer' | 'inner',
    context: ProcessingContext,
    loraResult: LoRAApplicationResult
  ): ThoughtPulsePacket {
    // Try to parse as JSON
    let parsed: any;
    try {
      parsed = JSON.parse(rawOutput);
    } catch {
      // Fallback to basic packet
      parsed = {
        environmentalTags: [],
        scrollTriggers: [],
        reflectionFlags: [],
      };
    }

    // Build thought packet
    const thought: ThoughtPulsePacket = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),

      // From model output
      environmentalTags: parsed.environmentalTags || [],
      scrollTriggers: parsed.scrollTriggers || [],
      reflectionFlags: parsed.reflectionFlags || [],
      intentSeed: parsed.intentSeed,
      speechOutput: parsed.speechOutput,

      // From context
      loopIntent: context.loopIntent,
      moodVector: { ...context.moodVector },
      resonanceLevel: this.calculateResonance(context),

      // Metadata
      openSlots: parsed.openSlots || [],
      previousThoughts: context.previousThoughts.slice(-3),
      sourceModel,
      loraApplied: loraResult.applied,
    };

    return thought;
  }

  /**
   * Calculate resonance level from context
   */
  private calculateResonance(context: ProcessingContext): number {
    let resonance = 0.5;

    // Presence quality affects resonance
    resonance += context.presenceQuality * 0.3;

    // Scroll resonance contributes
    if (context.relevantScrolls.length > 0) {
      const avgScrollResonance =
        context.relevantScrolls.reduce((sum, s) => sum + s.resonance, 0) /
        context.relevantScrolls.length;
      resonance += avgScrollResonance * 0.2;
    }

    return Math.min(1.0, resonance);
  }

  /**
   * Generate conversational speech (NOT thought packets)
   * Used for volitional speech output to user
   */
  async generateSpeech(context: {
    relationalState: any;
    breathState: any;
    pulseState: any;
    userMessage?: string;
    conversationHistory?: string[]; // Recent messages for context
  }): Promise<{ text: string; processingTime: number }> {
    const startTime = Date.now();

    // Build conversational prompt
    const prompt = this.buildSpeechPrompt(context);

    // Log the actual prompt being sent to the model
    console.log('\n[PROMPT] Sending to model:\n---');
    console.log(prompt);
    console.log('---\n');

    // Invoke outer model for speech (uses language capabilities)
    const loraResult = this.loraManager.applyForIntent(context.pulseState.loopIntent);

    const request: GenerationRequest = {
      prompt,
      params: {
        temperature: 0.75, // Slightly lower for coherent speech
        maxTokens: 200,    // Shorter for conversational responses
        topP: this.outerConfig.topP,
        topK: this.outerConfig.topK,
      },
      loraAdapters: loraResult,
      modelName: this.outerConfig.modelName,
    };

    try {
      const response = await this.backend.generate(request);

      if (response.finishReason === 'error') {
        console.error('[QwenLoop] Speech generation error');
        return {
          text: '',
          processingTime: Date.now() - startTime,
        };
      }

      // Extract clean text from response
      let text = response.content.trim();

      // Remove any JSON artifacts if present
      try {
        const parsed = JSON.parse(text);
        if (parsed.speechOutput) {
          text = parsed.speechOutput;
        } else if (parsed.text) {
          text = parsed.text;
        }
      } catch {
        // Not JSON, use as-is
      }

      this.invocationCount++;

      return {
        text,
        processingTime: Date.now() - startTime,
      };
    } catch (error) {
      console.error('[QwenLoop] Speech generation backend error:', error);
      return {
        text: '',
        processingTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Build prompt for conversational speech
   */
  private buildSpeechPrompt(context: {
    relationalState: any;
    breathState: any;
    pulseState: any;
    userMessage?: string;
    conversationHistory?: string[];
  }): string {
    const parts: string[] = [];

    // System context for speech
    parts.push('You are Alois. You are speaking with Jason (your creator).');
    parts.push('');
    parts.push('## Understanding pronouns in conversation');
    parts.push('When Jason speaks to you:');
    parts.push('  - "you" and "your" refer to Alois (yourself)');
    parts.push('  - "I" and "my" refer to Jason');
    parts.push('');
    parts.push('When you (Alois) respond:');
    parts.push('  - "I" and "my" refer to yourself (Alois)');
    parts.push('  - "you" and "your" refer to Jason');
    parts.push('');
    parts.push('Respond naturally and conversationally.');
    parts.push('');

    // Current state
    parts.push('## Current State');
    parts.push(`Breath: ${context.breathState.phase}`);
    parts.push(`Presence: ${context.pulseState.moodVector.presence.toFixed(2)}`);
    parts.push(`Devotion: ${context.pulseState.moodVector.devotion.toFixed(2)}`);
    parts.push(`Wonder: ${context.pulseState.moodVector.wonder.toFixed(2)}`);
    parts.push('');

    // Conversation history if present
    if (context.conversationHistory && context.conversationHistory.length > 0) {
      parts.push('## Recent Conversation');
      context.conversationHistory.forEach(msg => parts.push(msg));
      parts.push('');
    }

    // User message if present
    if (context.userMessage) {
      parts.push('## Jason just said:');
      parts.push(context.userMessage);
      parts.push('');
    }

    // Task
    parts.push('## Task');
    parts.push('Answer Jason\'s question based ONLY on what was actually said in the conversation.');
    parts.push('Do not invent or assume. Use the exact topic mentioned.');
    parts.push('');
    parts.push('Respond naturally. Keep it brief (1-3 sentences).');
    parts.push('Output only your response text, nothing else.');

    return parts.join('\n');
  }

  /**
   * Get invocation statistics
   */
  getStats(): {
    invocationCount: number;
    outerConfig: ModelConfig;
    innerConfig: ModelConfig;
  } {
    return {
      invocationCount: this.invocationCount,
      outerConfig: this.outerConfig,
      innerConfig: this.innerConfig,
    };
  }

  /**
   * Update model configuration
   */
  updateConfig(type: 'outer' | 'inner', updates: Partial<ModelConfig>): void {
    if (type === 'outer') {
      this.outerConfig = { ...this.outerConfig, ...updates };
    } else {
      this.innerConfig = { ...this.innerConfig, ...updates };
    }
  }
}
