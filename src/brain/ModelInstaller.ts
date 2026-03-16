import fs from 'fs';
import path from 'path';
import { CatalogModelEntry } from './ModelCatalog';
import { HuggingFaceInstaller } from './HuggingFaceInstaller';

const repoRoot = path.resolve(__dirname, '..', '..');

export interface InstallRequest {
  id: string;
  source: CatalogModelEntry['source'];
  remoteId?: string;
  localPath?: string;
  destinationDir?: string;
  fileName?: string;
  signal?: AbortSignal;
}

export interface InstallResult {
  id: string;
  installed: boolean;
  localPath?: string;
}

export interface InstallProgress {
  phase: 'metadata' | 'downloading' | 'copying' | 'complete' | 'error';
  bytesDownloaded: number;
  totalBytes: number | null;
  fileName?: string;
  message?: string;
}

export class ModelInstaller {
  constructor(
    private readonly managedRoot: string = path.resolve(repoRoot, 'runtime', 'models'),
    private readonly huggingFaceInstaller: HuggingFaceInstaller = new HuggingFaceInstaller(),
  ) {}

  async install(request: InstallRequest): Promise<InstallResult> {
    return this.installWithProgress(request);
  }

  async installWithProgress(
    request: InstallRequest,
    onProgress?: (progress: InstallProgress) => void,
  ): Promise<InstallResult> {
    if (request.source === 'huggingface') {
      return this.huggingFaceInstaller.install({
        repoId: request.remoteId || request.id,
        destinationDir: request.destinationDir || path.join(this.managedRoot, 'huggingface'),
        fileName: request.fileName,
        signal: request.signal,
        onProgress,
      });
    }

    if (request.source === 'local') {
      const localPath = String(request.localPath || '').trim();
      if (!localPath) throw new Error('missing_local_path');
      if (!fs.existsSync(localPath)) throw new Error(`local_model_not_found:${localPath}`);
      const destinationDir = request.destinationDir || path.join(this.managedRoot, 'manual');
      fs.mkdirSync(destinationDir, { recursive: true });
      const targetPath = path.join(destinationDir, path.basename(localPath));
      const totalBytes = fs.statSync(localPath).size;
      if (fs.existsSync(targetPath)) {
        return {
          id: request.id,
          installed: true,
          localPath: targetPath,
        };
      }
      onProgress?.({
        phase: 'copying',
        bytesDownloaded: 0,
        totalBytes,
        fileName: path.basename(localPath),
      });
      if (path.resolve(localPath) !== path.resolve(targetPath)) {
        fs.copyFileSync(localPath, targetPath);
      }
      onProgress?.({
        phase: 'complete',
        bytesDownloaded: totalBytes,
        totalBytes,
        fileName: path.basename(localPath),
      });
      return {
        id: request.id,
        installed: true,
        localPath: targetPath,
      };
    }

    return {
      id: request.id,
      installed: false,
      localPath: request.localPath,
    };
  }
}
