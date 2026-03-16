import fs from 'fs';
import path from 'path';

const repoRoot = path.resolve(__dirname, '..', '..');

export type BrainModelSource = 'local' | 'huggingface' | 'ollama' | 'lmstudio';
export type BrainModelRole = 'router' | 'language';

export interface CatalogModelEntry {
  id: string;
  label: string;
  role: BrainModelRole | 'either';
  source: BrainModelSource;
  backend: 'llamacpp' | 'ollama' | 'openai-compatible' | 'unknown';
  installed: boolean;
  quantization?: string;
  parameterSize?: string;
  localPath?: string;
  remoteId?: string;
}

export interface ModelCatalog {
  list(role?: BrainModelRole): Promise<CatalogModelEntry[]>;
}

export class StaticModelCatalog implements ModelCatalog {
  constructor(private readonly models: CatalogModelEntry[] = []) {}

  async list(role?: BrainModelRole): Promise<CatalogModelEntry[]> {
    if (!role) return [...this.models];
    return this.models.filter(model => model.role === role || model.role === 'either');
  }
}

const DEFAULT_MODEL_SCAN_DIRS = [
  path.resolve(repoRoot, 'runtime', 'models'),
  path.resolve(repoRoot, 'models'),
];

const MODEL_FILE_EXTENSIONS = new Set([
  '.gguf',
  '.bin',
  '.safetensors',
]);

function inferRole(fileName: string): CatalogModelEntry['role'] {
  const source = fileName.toLowerCase();
  if (source.includes('phi')) return 'router';
  if (
    source.includes('qwen')
    || source.includes('llama')
    || source.includes('mistral')
    || source.includes('gemma')
    || source.includes('claude')
  ) {
    return 'language';
  }
  return 'either';
}

function inferBackend(fileName: string): CatalogModelEntry['backend'] {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.gguf') return 'llamacpp';
  return 'unknown';
}

function inferQuantization(fileName: string): string | undefined {
  const base = path.basename(fileName, path.extname(fileName));
  const match = base.match(/(?:^|[._ -])((?:IQ\d(?:_[A-Z0-9]+)?)|(?:Q\d(?:_[A-Z0-9]+)*)|(?:F16)|(?:BF16)|(?:FP16)|(?:FP32))(?:$|[._ -])/i);
  return match ? match[1].toUpperCase() : undefined;
}

function inferParameterSize(fileName: string): string | undefined {
  const base = path.basename(fileName, path.extname(fileName));
  const match = base.match(/(?:^|[._ -])(\d+(?:\.\d+)?)B(?:$|[._ -])/i);
  return match ? `${match[1]}B` : undefined;
}

function stripKnownSuffixes(label: string, quantization?: string): string {
  let cleaned = label;
  if (quantization) {
    cleaned = cleaned.replace(new RegExp(`(?:[._ -])${quantization.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[._ -])`, 'i'), ' ');
  }
  cleaned = cleaned.replace(/(?:[._ -])(gguf|safetensors|bin)$/i, ' ');
  return cleaned.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildLabel(filePath: string): { label: string; quantization?: string; parameterSize?: string } {
  const base = path.basename(filePath, path.extname(filePath));
  const quantization = inferQuantization(base);
  const parameterSize = inferParameterSize(base);
  const cleanBase = stripKnownSuffixes(base, quantization);
  const suffixParts = [parameterSize, quantization].filter(Boolean);
  return {
    label: suffixParts.length ? `${cleanBase} (${suffixParts.join(' | ')})` : cleanBase,
    quantization,
    parameterSize,
  };
}

function walkModels(rootDir: string, depth: number, out: string[]): void {
  if (depth < 0 || !fs.existsSync(rootDir)) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      walkModels(fullPath, depth - 1, out);
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (MODEL_FILE_EXTENSIONS.has(ext)) {
      out.push(fullPath);
    }
  }
}

export class FileSystemModelCatalog implements ModelCatalog {
  constructor(
    private readonly modelDirs: string[] = DEFAULT_MODEL_SCAN_DIRS,
    private readonly maxDepth: number = 4,
  ) {}

  async list(role?: BrainModelRole): Promise<CatalogModelEntry[]> {
    const discovered: string[] = [];
    for (const dir of this.modelDirs) {
      walkModels(dir, this.maxDepth, discovered);
    }

    const models = discovered.map<CatalogModelEntry>(filePath => {
      const meta = buildLabel(filePath);
      return {
        id: filePath,
        label: meta.label,
        role: inferRole(filePath),
        source: 'local',
        backend: inferBackend(filePath),
        installed: true,
        quantization: meta.quantization,
        parameterSize: meta.parameterSize,
        localPath: filePath,
      };
    });

    if (!role) return models;
    return models.filter(model => model.role === role || model.role === 'either');
  }
}
