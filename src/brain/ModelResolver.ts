import path from 'path';
import { BrainModelRole, CatalogModelEntry, ModelCatalog } from './ModelCatalog';

export interface ModelResolutionRequest {
  role: BrainModelRole;
  modelId?: string;
  localPath?: string;
  source?: CatalogModelEntry['source'] | 'openai-compatible';
  backend?: CatalogModelEntry['backend'] | 'lmstudio';
}

export interface ResolvedBrainModel {
  role: BrainModelRole;
  modelId: string;
  source: CatalogModelEntry['source'];
  backend: CatalogModelEntry['backend'];
  localPath?: string;
}

export class ModelResolver {
  constructor(private readonly catalog: ModelCatalog) {}

  async resolve(request: ModelResolutionRequest): Promise<ResolvedBrainModel> {
    if (request.localPath) {
      const ext = path.extname(request.localPath).toLowerCase();
      const backend = ext === '.gguf' ? 'llamacpp' : 'unknown';
      return {
        role: request.role,
        modelId: request.modelId || request.localPath,
        source: 'local',
        backend,
        localPath: request.localPath,
      };
    }

    const models = await this.catalog.list(request.role);
    const match = request.modelId
      ? models.find(model => model.id === request.modelId)
      : models.find(model => model.installed);

    if (!match) {
      if (request.modelId) {
        const source = request.source === 'local'
          || request.source === 'huggingface'
          || request.source === 'ollama'
          || request.source === 'lmstudio'
          ? request.source
          : 'lmstudio';
        const backend = request.backend === 'ollama'
          || request.backend === 'openai-compatible'
          ? request.backend
          : 'openai-compatible';
        return {
          role: request.role,
          modelId: request.modelId,
          source,
          backend,
        };
      }
      throw new Error(`No ${request.role} model available for resolution`);
    }

    return {
      role: request.role,
      modelId: match.id,
      source: match.source,
      backend: match.backend,
      localPath: match.localPath,
    };
  }
}
