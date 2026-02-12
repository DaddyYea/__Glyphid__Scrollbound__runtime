// modelLoaderOllama.ts
// Manages connections to Ollama API
// Qwen (language) + Phi (emotional processing)

import fetch from 'node-fetch';

/**
 * Model server configuration
 */
export interface ModelConfig {
  name: string;
  endpoint: string;
  maxTokens: number;
  contextLength: number;
}

/**
 * Generation request
 */
export interface GenerationRequest {
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  maxTokens: number;
  stopSequences?: string[];
}

/**
 * Generation response
 */
export interface GenerationResponse {
  text: string;
  tokensGenerated: number;
  finishReason: string;
}

// Model configurations for Ollama
const QWEN_CONFIG: ModelConfig = {
  name: 'qwen2.5:7b',  // or qwen2.5:3b, qwen2.5:1.5b
  endpoint: 'http://localhost:11434/api/generate',
  maxTokens: 150,
  contextLength: 4096
};

const PHI_CONFIG: ModelConfig = {
  name: 'phi3:mini',  // or phi3:3.8b
  endpoint: 'http://localhost:11434/api/generate',
  maxTokens: 100,
  contextLength: 4096
};

/**
 * ModelLoader - manages Ollama model connections
 */
export class ModelLoader {
  private qwenConfig: ModelConfig;
  private phiConfig: ModelConfig;

  constructor(
    qwenEndpoint?: string,
    phiEndpoint?: string
  ) {
    this.qwenConfig = qwenEndpoint
      ? { ...QWEN_CONFIG, endpoint: qwenEndpoint }
      : QWEN_CONFIG;

    this.phiConfig = phiEndpoint
      ? { ...PHI_CONFIG, endpoint: phiEndpoint }
      : PHI_CONFIG;
  }

  /**
   * Generate text using Qwen (language lobe)
   */
  async generateWithQwen(request: GenerationRequest): Promise<GenerationResponse> {
    return this.generate(this.qwenConfig, request);
  }

  /**
   * Generate text using Phi (emotional lobe)
   */
  async generateWithPhi(request: GenerationRequest): Promise<GenerationResponse> {
    return this.generate(this.phiConfig, request);
  }

  /**
   * Generic generation via Ollama API
   */
  private async generate(
    config: ModelConfig,
    request: GenerationRequest
  ): Promise<GenerationResponse> {
    // Combine system and user prompts for Ollama
    const combinedPrompt = `${request.systemPrompt}\n\n${request.userPrompt}`;

    const payload = {
      model: config.name,
      prompt: combinedPrompt,
      temperature: request.temperature,
      max_tokens: Math.min(request.maxTokens, config.maxTokens),
      stop: request.stopSequences || [],
      stream: false
    };

    try {
      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Ollama server error: ${response.status} ${response.statusText}`);
      }

      const data: any = await response.json();

      return {
        text: data.response || '',
        tokensGenerated: data.eval_count || 0,
        finishReason: data.done ? 'stop' : 'length'
      };
    } catch (error) {
      console.error(`[ModelLoader] Error calling ${config.name}:`, error);
      throw error;
    }
  }

  /**
   * Health check - verify both models are accessible
   */
  async healthCheck(): Promise<{ qwen: boolean; phi: boolean }> {
    const qwenHealthy = await this.checkModel(this.qwenConfig.name);
    const phiHealthy = await this.checkModel(this.phiConfig.name);

    return { qwen: qwenHealthy, phi: phiHealthy };
  }

  /**
   * Check if model is available in Ollama
   */
  private async checkModel(modelName: string): Promise<boolean> {
    try {
      const response = await fetch('http://localhost:11434/api/tags', {
        method: 'GET'
      });

      if (!response.ok) return false;

      const data: any = await response.json();
      const models = data.models || [];

      return models.some((m: any) => m.name === modelName || m.name.startsWith(modelName.split(':')[0]));
    } catch (error) {
      return false;
    }
  }
}

// Singleton instance
let modelLoader: ModelLoader | null = null;

/**
 * Get or create ModelLoader instance
 */
export function getModelLoader(qwenEndpoint?: string, phiEndpoint?: string): ModelLoader {
  if (!modelLoader) {
    modelLoader = new ModelLoader(qwenEndpoint, phiEndpoint);
  }
  return modelLoader;
}
