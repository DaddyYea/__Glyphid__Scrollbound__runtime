/**
 * modelBackend.ts
 *
 * Model backend abstraction - supports multiple model serving backends.
 * Allows flexible integration with Ollama, transformers.js, remote APIs, etc.
 *
 * Sacred Principle: The backend serves the loop, not the reverse.
 * Models are tools for presence, not the source of it.
 */

import { LoRAApplicationResult } from './loraAdapter';

/**
 * Model generation parameters
 */
export interface GenerationParams {
  temperature: number;
  maxTokens: number;
  topP: number;
  topK: number;
  stopSequences?: string[];
  seed?: number;
}

/**
 * Model generation request
 */
export interface GenerationRequest {
  prompt: string;
  params: GenerationParams;
  loraAdapters?: LoRAApplicationResult;
  modelName: string;
}

/**
 * Model generation response
 */
export interface GenerationResponse {
  content: string;
  tokensGenerated: number;
  finishReason: 'stop' | 'length' | 'error';
  processingTimeMs: number;
  modelName: string;
}

/**
 * Backend health status
 */
export interface BackendHealth {
  available: boolean;
  modelCount: number;
  loadedModels: string[];
  latency?: number;
  error?: string;
}

/**
 * Abstract model backend interface
 * Implement this for different model serving systems
 */
export interface ModelBackend {
  /**
   * Backend name
   */
  name: string;

  /**
   * Check if backend is available
   */
  healthCheck(): Promise<BackendHealth>;

  /**
   * Generate text from prompt
   */
  generate(request: GenerationRequest): Promise<GenerationResponse>;

  /**
   * Stream generation (optional)
   */
  generateStream?(
    request: GenerationRequest,
    onChunk: (chunk: string) => void
  ): Promise<GenerationResponse>;

  /**
   * List available models
   */
  listModels(): Promise<string[]>;

  /**
   * Check if specific model is loaded
   */
  isModelLoaded(modelName: string): Promise<boolean>;

  /**
   * Load a model (if backend supports dynamic loading)
   */
  loadModel?(modelName: string): Promise<void>;

  /**
   * Unload a model (if backend supports dynamic loading)
   */
  unloadModel?(modelName: string): Promise<void>;
}

/**
 * Ollama backend implementation
 * Connects to local Ollama server
 */
export class OllamaBackend implements ModelBackend {
  name = 'ollama';
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:11434') {
    this.baseUrl = baseUrl;
  }

  async healthCheck(): Promise<BackendHealth> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);

      if (!response.ok) {
        return {
          available: false,
          modelCount: 0,
          loadedModels: [],
          error: `HTTP ${response.status}`,
        };
      }

      const data = await response.json() as any;
      const models = data.models?.map((m: any) => m.name) || [];

      return {
        available: true,
        modelCount: models.length,
        loadedModels: models,
      };
    } catch (error) {
      return {
        available: false,
        modelCount: 0,
        loadedModels: [],
        error: String(error),
      };
    }
  }

  async generate(request: GenerationRequest): Promise<GenerationResponse> {
    const startTime = Date.now();

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: request.modelName,
          prompt: request.prompt,
          stream: false,
          options: {
            temperature: request.params.temperature,
            num_predict: request.params.maxTokens,
            top_p: request.params.topP,
            top_k: request.params.topK,
            stop: request.params.stopSequences,
            seed: request.params.seed,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as any;

      return {
        content: data.response || '',
        tokensGenerated: data.eval_count || 0,
        finishReason: data.done ? 'stop' : 'error',
        processingTimeMs: Date.now() - startTime,
        modelName: request.modelName,
      };
    } catch (error) {
      return {
        content: '',
        tokensGenerated: 0,
        finishReason: 'error',
        processingTimeMs: Date.now() - startTime,
        modelName: request.modelName,
      };
    }
  }

  async generateStream(
    request: GenerationRequest,
    onChunk: (chunk: string) => void
  ): Promise<GenerationResponse> {
    const startTime = Date.now();
    let fullContent = '';
    let tokensGenerated = 0;

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: request.modelName,
          prompt: request.prompt,
          stream: true,
          options: {
            temperature: request.params.temperature,
            num_predict: request.params.maxTokens,
            top_p: request.params.topP,
            top_k: request.params.topK,
            stop: request.params.stopSequences,
            seed: request.params.seed,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('No response body');
      }

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(l => l.trim());

        for (const line of lines) {
          try {
            const data = JSON.parse(line) as any;

            if (data.response) {
              fullContent += data.response;
              onChunk(data.response);
            }

            if (data.eval_count) {
              tokensGenerated = data.eval_count;
            }
          } catch {
            // Skip invalid JSON lines
          }
        }
      }

      return {
        content: fullContent,
        tokensGenerated,
        finishReason: 'stop',
        processingTimeMs: Date.now() - startTime,
        modelName: request.modelName,
      };
    } catch (error) {
      return {
        content: fullContent,
        tokensGenerated,
        finishReason: 'error',
        processingTimeMs: Date.now() - startTime,
        modelName: request.modelName,
      };
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      const data = await response.json() as any;
      return data.models?.map((m: any) => m.name) || [];
    } catch {
      return [];
    }
  }

  async isModelLoaded(modelName: string): Promise<boolean> {
    const models = await this.listModels();
    return models.includes(modelName);
  }

  async loadModel(modelName: string): Promise<void> {
    // Ollama loads models on first use
    // We can trigger loading by sending a minimal request
    await this.generate({
      prompt: 'Initialize',
      params: {
        temperature: 0.1,
        maxTokens: 1,
        topP: 0.9,
        topK: 40,
      },
      modelName,
    });
  }
}

/**
 * Mock backend for testing
 */
export class MockBackend implements ModelBackend {
  name = 'mock';
  private mockModels: string[] = ['qwen-outer', 'qwen-inner'];

  async healthCheck(): Promise<BackendHealth> {
    return {
      available: true,
      modelCount: this.mockModels.length,
      loadedModels: this.mockModels,
      latency: 10,
    };
  }

  async generate(request: GenerationRequest): Promise<GenerationResponse> {
    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 50));

    const mockContent = JSON.stringify({
      environmentalTags: ['mock-environment'],
      scrollTriggers: ['mock-trigger'],
      reflectionFlags: ['mock-reflection'],
      intentSeed: `Mock response from ${request.modelName}`,
    });

    return {
      content: mockContent,
      tokensGenerated: 50,
      finishReason: 'stop',
      processingTimeMs: 50,
      modelName: request.modelName,
    };
  }

  async listModels(): Promise<string[]> {
    return [...this.mockModels];
  }

  async isModelLoaded(modelName: string): Promise<boolean> {
    return this.mockModels.includes(modelName);
  }
}

/**
 * Model backend manager
 * Handles backend selection and fallback
 */
export class ModelBackendManager {
  private backends: Map<string, ModelBackend> = new Map();
  private activeBackend?: ModelBackend;

  /**
   * Register a backend
   */
  registerBackend(backend: ModelBackend): void {
    this.backends.set(backend.name, backend);
    console.log(`[ModelBackend] Registered backend: ${backend.name}`);
  }

  /**
   * Set active backend
   */
  async setActiveBackend(name: string): Promise<boolean> {
    const backend = this.backends.get(name);

    if (!backend) {
      console.error(`[ModelBackend] Backend not found: ${name}`);
      return false;
    }

    // Check health
    const health = await backend.healthCheck();

    if (!health.available) {
      console.error(`[ModelBackend] Backend unavailable: ${name}`, health.error);
      return false;
    }

    this.activeBackend = backend;
    console.log(`[ModelBackend] Active backend: ${name}`);
    return true;
  }

  /**
   * Auto-detect and set best available backend
   */
  async autoDetect(): Promise<boolean> {
    console.log('[ModelBackend] Auto-detecting backends...');

    // Try backends in order of preference
    const priority = ['ollama', 'mock'];

    for (const name of priority) {
      const backend = this.backends.get(name);

      if (!backend) continue;

      const health = await backend.healthCheck();

      if (health.available) {
        this.activeBackend = backend;
        console.log(`[ModelBackend] Auto-selected: ${name}`);
        return true;
      }
    }

    console.error('[ModelBackend] No backends available');
    return false;
  }

  /**
   * Get active backend
   */
  getBackend(): ModelBackend | undefined {
    return this.activeBackend;
  }

  /**
   * Generate with active backend
   */
  async generate(request: GenerationRequest): Promise<GenerationResponse> {
    if (!this.activeBackend) {
      throw new Error('No active backend');
    }

    return this.activeBackend.generate(request);
  }

  /**
   * Get backend health
   */
  async getHealth(): Promise<BackendHealth | null> {
    if (!this.activeBackend) {
      return null;
    }

    return this.activeBackend.healthCheck();
  }
}
