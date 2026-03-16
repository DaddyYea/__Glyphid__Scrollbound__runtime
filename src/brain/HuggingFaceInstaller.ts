import fs from 'fs';
import path from 'path';
import { InstallResult } from './ModelInstaller';

export interface HuggingFaceInstallRequest {
  repoId: string;
  destinationDir: string;
  fileName?: string;
  signal?: AbortSignal;
  onProgress?: (progress: {
    phase: 'metadata' | 'downloading' | 'complete';
    bytesDownloaded: number;
    totalBytes: number | null;
    fileName?: string;
  }) => void;
}

const SUPPORTED_EXTENSIONS = ['.gguf', '.safetensors', '.bin'];

function sanitizeRepoId(repoId: string): string {
  return repoId.replace(/[^a-zA-Z0-9._-]+/g, '__');
}

function isSupportedModelFile(name: string): boolean {
  const lower = name.toLowerCase();
  return SUPPORTED_EXTENSIONS.some(ext => lower.endsWith(ext));
}

function rankModelFile(name: string): number {
  const lower = name.toLowerCase();
  if (lower.endsWith('.gguf')) return 0;
  if (lower.endsWith('.safetensors')) return 1;
  if (lower.endsWith('.bin')) return 2;
  return 99;
}

export class HuggingFaceInstaller {
  constructor(
    private readonly apiBaseUrl: string = 'https://huggingface.co/api/models',
    private readonly fileBaseUrl: string = 'https://huggingface.co',
  ) {}

  async install(request: HuggingFaceInstallRequest): Promise<InstallResult> {
    const repoId = String(request.repoId || '').trim();
    if (!repoId) {
      throw new Error('missing_repo_id');
    }

    request.onProgress?.({
      phase: 'metadata',
      bytesDownloaded: 0,
      totalBytes: null,
    });
    const modelInfo = await this.fetchModelInfo(repoId);
    const fileName = request.fileName || this.selectFileName(modelInfo);
    if (!fileName) {
      throw new Error(`no_supported_model_file:${repoId}`);
    }

    const targetDir = path.join(request.destinationDir, sanitizeRepoId(repoId));
    fs.mkdirSync(targetDir, { recursive: true });
    const targetPath = path.join(targetDir, path.basename(fileName));
    if (fs.existsSync(targetPath)) {
      const existingBytes = fs.statSync(targetPath).size;
      request.onProgress?.({
        phase: 'complete',
        bytesDownloaded: existingBytes,
        totalBytes: existingBytes,
        fileName: path.basename(fileName),
      });
      return {
        id: repoId,
        installed: true,
        localPath: targetPath,
      };
    }
    const downloadUrl = `${this.fileBaseUrl}/${repoId}/resolve/main/${fileName}?download=true`;

    await this.downloadFile(downloadUrl, targetPath, progress => request.onProgress?.({
      ...progress,
      fileName: path.basename(fileName),
    }), request.signal);

    request.onProgress?.({
      phase: 'complete',
      bytesDownloaded: fs.existsSync(targetPath) ? fs.statSync(targetPath).size : 0,
      totalBytes: fs.existsSync(targetPath) ? fs.statSync(targetPath).size : null,
      fileName: path.basename(fileName),
    });

    return {
      id: repoId,
      installed: true,
      localPath: targetPath,
    };
  }

  private async fetchModelInfo(repoId: string): Promise<any> {
    const response = await fetch(`${this.apiBaseUrl}/${repoId}`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`huggingface_model_info_failed:${response.status}`);
    }
    return response.json();
  }

  private selectFileName(modelInfo: any): string | null {
    const siblings = Array.isArray(modelInfo?.siblings) ? modelInfo.siblings : [];
    const candidates = siblings
      .map((sibling: any) => typeof sibling?.rfilename === 'string' ? sibling.rfilename : '')
      .filter((name: string) => !!name && isSupportedModelFile(name))
      .sort((a: string, b: string) => rankModelFile(a) - rankModelFile(b) || a.localeCompare(b));
    return candidates[0] || null;
  }

  private async downloadFile(
    url: string,
    destination: string,
    onProgress?: (progress: { phase: 'downloading'; bytesDownloaded: number; totalBytes: number | null }) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const response = await fetch(url, { signal });
    if (!response.ok || !response.body) {
      throw new Error(`huggingface_download_failed:${response.status}`);
    }

    const totalBytesHeader = response.headers.get('content-length');
    const totalBytes = totalBytesHeader ? Number(totalBytesHeader) : null;

    const fileStream = fs.createWriteStream(destination);
    let bytesDownloaded = 0;
    try {
      for await (const chunk of response.body as any) {
        if (signal?.aborted) {
          throw new Error('install_cancelled');
        }
        fileStream.write(chunk);
        bytesDownloaded += chunk.length || chunk.byteLength || 0;
        onProgress?.({
          phase: 'downloading',
          bytesDownloaded,
          totalBytes: Number.isFinite(totalBytes) ? totalBytes : null,
        });
      }
    } finally {
      fileStream.end();
      if (signal?.aborted && fs.existsSync(destination)) {
        try { fs.unlinkSync(destination); } catch {}
      }
    }
  }
}
