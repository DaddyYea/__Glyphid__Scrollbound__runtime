// modelLoader.ts
// Manages connections to llama.cpp chat servers
// Qwen (language) + Phi (emotional processing)

import fetch from 'node-fetch';

/**
 * Model server configuration
 */
export interface ModelConfig {
  id?: string;
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

// Model configurations for llama.cpp servers
const QWEN_CONFIG: ModelConfig = {
  name: 'qwen1.5-4b-chat',
  endpoint: 'http://localhost:1234/v1/chat/completions',
  maxTokens: 150,
  contextLength: 4096
};

const PHI_CONFIG: ModelConfig = {
  name: 'phi-2',
  endpoint: 'http://localhost:1235/v1/chat/completions',
  maxTokens: 100,
  contextLength: 4096
};

/**
 * ModelLoader - manages llama.cpp model server connections
 */
export class ModelLoader {
  private qwenConfig: ModelConfig;
  private phiConfig: ModelConfig;
  private readonly modelConfigs: Map<string, ModelConfig>;

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

    this.modelConfigs = new Map<string, ModelConfig>([
      ['language', this.qwenConfig],
      ['router', this.phiConfig],
      [this.qwenConfig.name, this.qwenConfig],
      [this.phiConfig.name, this.phiConfig],
    ]);
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

  async generateWithModel(modelId: string, request: GenerationRequest): Promise<GenerationResponse> {
    return this.generate(this.resolveModel(modelId), request);
  }

  listAvailableModels(): ModelConfig[] {
    return [...new Map(
      [...this.modelConfigs.values()].map(config => [config.name, config]),
    ).values()];
  }

  /**
   * Generic generation via llama.cpp OpenAI-compatible API
   */
  private async generate(
    config: ModelConfig,
    request: GenerationRequest
  ): Promise<GenerationResponse> {
    const payload = {
      model: config.name,
      messages: [
        {
          role: 'system',
          content: request.systemPrompt
        },
        {
          role: 'user',
          content: request.userPrompt
        }
      ],
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
        throw new Error(`Model server error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      return {
        text: data.choices[0]?.message?.content || '',
        tokensGenerated: data.usage?.completion_tokens || 0,
        finishReason: data.choices[0]?.finish_reason || 'stop'
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
    const qwenHealthy = await this.checkEndpoint(this.qwenConfig.endpoint);
    const phiHealthy = await this.checkEndpoint(this.phiConfig.endpoint);

    return { qwen: qwenHealthy, phi: phiHealthy };
  }

  /**
   * Check if endpoint is responding (llama.cpp server)
   */
  private async checkEndpoint(endpoint: string): Promise<boolean> {
    try {
      // For llama.cpp, check the /v1/models endpoint
      const baseUrl = endpoint.replace('/v1/chat/completions', '');
      const response = await fetch(`${baseUrl}/v1/models`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      return response.ok;
    } catch (error) {
      return false;
    }
  }

  private resolveModel(modelId: string): ModelConfig {
    const config = this.modelConfigs.get(modelId);
    if (!config) {
      throw new Error(`Unknown model id: ${modelId}`);
    }
    return config;
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
