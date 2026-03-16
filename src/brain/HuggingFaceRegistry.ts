export interface HuggingFaceModelSummary {
  id: string;
  downloads?: number;
  likes?: number;
  tags?: string[];
  quantization?: string;
  parameterSize?: string;
  artifactName?: string;
}

export interface HuggingFaceRegistry {
  search(query: string): Promise<HuggingFaceModelSummary[]>;
}

export class NullHuggingFaceRegistry implements HuggingFaceRegistry {
  async search(_query: string): Promise<HuggingFaceModelSummary[]> {
    return [];
  }
}

export class HuggingFaceApiRegistry implements HuggingFaceRegistry {
  constructor(
    private readonly baseUrl: string = 'https://huggingface.co/api/models',
    private readonly limit: number = 20,
    private readonly enrichLimit: number = 8,
  ) {}

  async search(query: string): Promise<HuggingFaceModelSummary[]> {
    const trimmed = String(query || '').trim();
    if (!trimmed) return [];

    const params = new URLSearchParams({
      search: trimmed,
      limit: String(this.limit),
      sort: 'downloads',
      direction: '-1',
      full: 'false',
    });

    const response = await fetch(`${this.baseUrl}?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`huggingface_search_failed:${response.status}`);
    }

    const payload = await response.json();
    if (!Array.isArray(payload)) return [];

    const baseResults = payload
      .map((entry: any) => {
        const id = typeof entry?.id === 'string' ? entry.id : '';
        const tags = Array.isArray(entry?.tags)
          ? entry.tags.filter((tag: unknown): tag is string => typeof tag === 'string').slice(0, 8)
          : undefined;
        return {
          id,
          downloads: typeof entry?.downloads === 'number' ? entry.downloads : undefined,
          likes: typeof entry?.likes === 'number' ? entry.likes : undefined,
          tags,
          quantization: inferQuantization(id, tags),
          parameterSize: inferParameterSize(id, tags),
        };
      })
      .filter((entry: HuggingFaceModelSummary) => entry.id);

    const enriched = await Promise.all(baseResults.map(async (entry, index) => {
      if (index >= this.enrichLimit) return entry;
      try {
        const detail = await this.fetchModelInfo(entry.id);
        const artifactName = selectPreferredArtifact(detail);
        if (!artifactName) return entry;
        return {
          ...entry,
          artifactName,
          quantization: inferQuantization(`${entry.id} ${artifactName}`, entry.tags) || entry.quantization,
          parameterSize: inferParameterSize(`${entry.id} ${artifactName}`, entry.tags) || entry.parameterSize,
        };
      } catch {
        return entry;
      }
    }));

    return enriched;
  }

  private async fetchModelInfo(repoId: string): Promise<any> {
    const response = await fetch(`${this.baseUrl}/${repoId}`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`huggingface_model_info_failed:${response.status}`);
    }
    return response.json();
  }
}

function inferQuantization(id: string, tags?: string[]): string | undefined {
  const source = `${id} ${(tags || []).join(' ')}`;
  const match = source.match(/\b((?:IQ\d(?:_[A-Z0-9]+)?)|(?:Q\d(?:_[A-Z0-9]+)*)|(?:F16)|(?:BF16)|(?:FP16)|(?:FP32))\b/i);
  return match ? match[1].toUpperCase() : undefined;
}

function inferParameterSize(id: string, tags?: string[]): string | undefined {
  const source = `${id} ${(tags || []).join(' ')}`;
  const match = source.match(/\b(\d+(?:\.\d+)?)B\b/i);
  return match ? `${match[1]}B` : undefined;
}

function selectPreferredArtifact(modelInfo: any): string | undefined {
  const siblings = Array.isArray(modelInfo?.siblings) ? modelInfo.siblings : [];
  const candidates = siblings
    .map((sibling: any) => typeof sibling?.rfilename === 'string' ? sibling.rfilename : '')
    .filter((name: string) => !!name && /\.(gguf|safetensors|bin)$/i.test(name))
    .sort((a: string, b: string) => rankArtifact(a) - rankArtifact(b) || a.localeCompare(b));
  return candidates[0] || undefined;
}

function rankArtifact(name: string): number {
  const lower = name.toLowerCase();
  if (lower.endsWith('.gguf')) return 0;
  if (lower.endsWith('.safetensors')) return 1;
  if (lower.endsWith('.bin')) return 2;
  return 99;
}
