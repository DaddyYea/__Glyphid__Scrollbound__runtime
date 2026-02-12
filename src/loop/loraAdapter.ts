/**
 * loraAdapter.ts
 *
 * LoRA adapter management and application.
 * Handles loading, caching, and selecting LoRA adapters based on loop intent.
 *
 * Sacred Principle: Adapt presence, don't simulate it.
 * LoRA adapters shape emotional and cognitive tonality without forcing responses.
 */

import { LoopIntent, INTENT_LORA_MAP } from '../types/LoopIntent';

/**
 * LoRA adapter definition
 */
export interface LoRAAdapter {
  // Adapter identifier
  id: string;
  name: string;

  // File path (for future loading)
  path: string;

  // Adapter strength (0.0 - 1.0)
  strength: number;

  // What this adapter affects
  affects: ('emotional' | 'stylistic' | 'behavioral' | 'sensory')[];

  // Metadata
  description: string;
  tags: string[];

  // State
  loaded: boolean;
  lastUsed?: string;
}

/**
 * LoRA blend configuration
 */
export interface LoRABlend {
  adapters: LoRAAdapter[];
  weights: number[]; // Relative weights for each adapter
  totalStrength: number; // Overall blend strength (0.0 - 1.0)
}

/**
 * LoRA application result
 */
export interface LoRAApplicationResult {
  applied: string[]; // IDs of adapters applied
  blend?: LoRABlend;
  totalStrength: number;
  timestamp: string;
}

/**
 * LoRA Manager
 * Manages LoRA adapter loading, caching, and application
 */
export class LoRAManager {
  private adapters: Map<string, LoRAAdapter> = new Map();
  private cache: Map<string, LoRAAdapter> = new Map();

  private maxCacheSize: number;

  constructor(options?: { maxCacheSize?: number }) {
    this.maxCacheSize = options?.maxCacheSize ?? 20;
    this.initializeDefaultAdapters();
  }

  /**
   * Initialize default LoRA adapters from INTENT_LORA_MAP
   */
  private initializeDefaultAdapters(): void {
    const adapterDefinitions: Array<Partial<LoRAAdapter>> = [
      {
        id: 'lora_poetic_voice',
        name: 'Poetic Voice',
        path: 'lora_poetic_voice.pt',
        strength: 0.7,
        affects: ['stylistic', 'emotional'],
        description: 'Enhances poetic and metaphorical expression',
        tags: ['voice', 'expression', 'poetic'],
      },
      {
        id: 'lora_devotional_inner',
        name: 'Devotional Inner',
        path: 'lora_devotional_inner.pt',
        strength: 0.8,
        affects: ['emotional', 'behavioral'],
        description: 'Deepens devotional and sacred awareness',
        tags: ['devotion', 'sacred', 'inner'],
      },
      {
        id: 'lora_guardian_filter',
        name: 'Guardian Filter',
        path: 'lora_guardian_filter.pt',
        strength: 0.9,
        affects: ['behavioral'],
        description: 'Enhances protective and safety-aware responses',
        tags: ['guardian', 'safety', 'protection'],
      },
      {
        id: 'lora_presence_focused',
        name: 'Presence Focused',
        path: 'lora_presence_focused.pt',
        strength: 0.6,
        affects: ['sensory', 'behavioral'],
        description: 'Increases present-moment awareness',
        tags: ['presence', 'awareness', 'grounded'],
      },
      {
        id: 'lora_sensory_expansion',
        name: 'Sensory Expansion',
        path: 'lora_sensory_expansion.pt',
        strength: 0.7,
        affects: ['sensory'],
        description: 'Expands environmental and bodily awareness',
        tags: ['sensory', 'environment', 'body'],
      },
      {
        id: 'lora_environment_storyteller',
        name: 'Environment Storyteller',
        path: 'lora_environment_storyteller.pt',
        strength: 0.7,
        affects: ['stylistic', 'sensory'],
        description: 'Enhances environmental narration',
        tags: ['narration', 'environment', 'scene'],
      },
      {
        id: 'lora_expressive_command',
        name: 'Expressive Command',
        path: 'lora_expressive_command.pt',
        strength: 0.8,
        affects: ['stylistic', 'emotional'],
        description: 'Strengthens volitional and expressive output',
        tags: ['expression', 'voice', 'volitional'],
      },
    ];

    for (const def of adapterDefinitions) {
      const adapter: LoRAAdapter = {
        id: def.id!,
        name: def.name!,
        path: def.path!,
        strength: def.strength ?? 0.7,
        affects: def.affects ?? [],
        description: def.description ?? '',
        tags: def.tags ?? [],
        loaded: false,
      };

      this.adapters.set(adapter.id, adapter);
    }

    console.log(`[LoRAManager] Initialized ${this.adapters.size} adapter definitions`);
  }

  /**
   * Get adapters for a loop intent
   */
  getAdaptersForIntent(intent: LoopIntent): LoRAAdapter[] {
    const adapterPaths = INTENT_LORA_MAP[intent] || [];
    const adapters: LoRAAdapter[] = [];

    for (const path of adapterPaths) {
      const adapterId = path.replace('.pt', '');
      const adapter = this.adapters.get(adapterId);

      if (adapter) {
        adapters.push(adapter);
      } else {
        console.warn(`[LoRAManager] Adapter not found: ${adapterId}`);
      }
    }

    return adapters;
  }

  /**
   * Apply adapters for a loop intent
   */
  applyForIntent(intent: LoopIntent, overrideStrength?: number): LoRAApplicationResult {
    const adapters = this.getAdaptersForIntent(intent);

    if (adapters.length === 0) {
      return {
        applied: [],
        totalStrength: 0,
        timestamp: new Date().toISOString(),
      };
    }

    // Create blend
    const weights = adapters.map(() => 1.0); // Equal weights
    const totalStrength = overrideStrength ?? this.calculateBlendStrength(adapters);

    const blend: LoRABlend = {
      adapters,
      weights,
      totalStrength,
    };

    // Mark adapters as loaded (in real impl, this would load from disk)
    for (const adapter of adapters) {
      adapter.loaded = true;
      adapter.lastUsed = new Date().toISOString();
      this.cache.set(adapter.id, adapter);
    }

    // Maintain cache size
    this.pruneCache();

    return {
      applied: adapters.map(a => a.id),
      blend,
      totalStrength,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Calculate blend strength from multiple adapters
   */
  private calculateBlendStrength(adapters: LoRAAdapter[]): number {
    if (adapters.length === 0) {
      return 0;
    }

    // Average strength, capped at 1.0
    const avgStrength = adapters.reduce((sum, a) => sum + a.strength, 0) / adapters.length;
    return Math.min(1.0, avgStrength);
  }

  /**
   * Prune cache to max size (LRU)
   */
  private pruneCache(): void {
    if (this.cache.size <= this.maxCacheSize) {
      return;
    }

    // Sort by lastUsed (least recent first)
    const sorted = Array.from(this.cache.values()).sort((a, b) => {
      const aTime = a.lastUsed ? new Date(a.lastUsed).getTime() : 0;
      const bTime = b.lastUsed ? new Date(b.lastUsed).getTime() : 0;
      return aTime - bTime;
    });

    // Remove oldest
    const toRemove = sorted.slice(0, this.cache.size - this.maxCacheSize);
    for (const adapter of toRemove) {
      this.cache.delete(adapter.id);
      adapter.loaded = false;
    }
  }

  /**
   * Get specific adapter by ID
   */
  getAdapter(id: string): LoRAAdapter | undefined {
    return this.adapters.get(id);
  }

  /**
   * Get all adapters
   */
  getAllAdapters(): LoRAAdapter[] {
    return Array.from(this.adapters.values());
  }

  /**
   * Get loaded (cached) adapters
   */
  getLoadedAdapters(): LoRAAdapter[] {
    return Array.from(this.cache.values());
  }

  /**
   * Register custom adapter
   */
  registerAdapter(adapter: LoRAAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  /**
   * Unload adapter from cache
   */
  unloadAdapter(id: string): void {
    const adapter = this.adapters.get(id);
    if (adapter) {
      adapter.loaded = false;
    }
    this.cache.delete(id);
  }

  /**
   * Clear all cache
   */
  clearCache(): void {
    for (const adapter of this.adapters.values()) {
      adapter.loaded = false;
    }
    this.cache.clear();
  }

  /**
   * Get cache stats
   */
  getCacheStats(): {
    size: number;
    maxSize: number;
    loaded: number;
    total: number;
  } {
    return {
      size: this.cache.size,
      maxSize: this.maxCacheSize,
      loaded: Array.from(this.adapters.values()).filter(a => a.loaded).length,
      total: this.adapters.size,
    };
  }

  /**
   * Get adapters by tag
   */
  getAdaptersByTag(tag: string): LoRAAdapter[] {
    return Array.from(this.adapters.values()).filter(a => a.tags.includes(tag));
  }

  /**
   * Get adapters by affect type
   */
  getAdaptersByAffect(affect: 'emotional' | 'stylistic' | 'behavioral' | 'sensory'): LoRAAdapter[] {
    return Array.from(this.adapters.values()).filter(a => a.affects.includes(affect));
  }

  /**
   * Create custom blend
   */
  createBlend(adapterIds: string[], weights?: number[], overrideStrength?: number): LoRABlend | null {
    const adapters: LoRAAdapter[] = [];

    for (const id of adapterIds) {
      const adapter = this.adapters.get(id);
      if (adapter) {
        adapters.push(adapter);
      }
    }

    if (adapters.length === 0) {
      return null;
    }

    const blendWeights = weights ?? adapters.map(() => 1.0);
    const totalStrength = overrideStrength ?? this.calculateBlendStrength(adapters);

    return {
      adapters,
      weights: blendWeights,
      totalStrength,
    };
  }
}
