import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

const repoRoot = path.resolve(__dirname, '..', '..');

export interface LlamaRuntimeHandle {
  modelPath: string;
  port: number;
  baseUrl: string;
  mode: 'generate' | 'embedding';
}

interface RuntimeEntry extends LlamaRuntimeHandle {
  process: ChildProcessWithoutNullStreams;
  recentLogs: string[];
  exited: boolean;
  exitCode: number | null;
  exitSignal: NodeJS.Signals | null;
  startupPromise: Promise<void>;
}

const START_PORT = Number(process.env.BRAIN_LOCAL_LLAMA_START_PORT || 12434);

// ── PID persistence — survives crashes and SIGKILL ───────────────────────────
const PID_FILE = path.join(os.tmpdir(), 'llama-server-pids.json');

function _readPidFile(): number[] {
  try { return JSON.parse(fs.readFileSync(PID_FILE, 'utf-8')) as number[]; } catch { return []; }
}
function _writePidFile(pids: number[]): void {
  try { fs.writeFileSync(PID_FILE, JSON.stringify(pids)); } catch {}
}
function _addPid(pid: number): void {
  const pids = _readPidFile();
  if (!pids.includes(pid)) { pids.push(pid); _writePidFile(pids); }
}
function _removePid(pid: number): void {
  _writePidFile(_readPidFile().filter(p => p !== pid));
}
function killStaleLlamaProcesses(): void {
  const pids = _readPidFile();
  if (!pids.length) return;
  console.log(`[LlamaCpp] Killing ${pids.length} stale llama-server process(es) from previous run:`, pids);
  for (const pid of pids) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
  _writePidFile([]);
}
const HEALTH_TIMEOUT_MS = Number(process.env.BRAIN_LOCAL_LLAMA_HEALTH_TIMEOUT_MS || 300000);
const GPU_LAYERS = process.env.BRAIN_LOCAL_LLAMA_GPU_LAYERS || '999';
const MAIN_GPU = process.env.BRAIN_LOCAL_LLAMA_MAIN_GPU || '0';
const CTX_SIZE = process.env.BRAIN_LOCAL_LLAMA_CTX || '4096';
const EMBEDDING_CTX_SIZE = process.env.BRAIN_LOCAL_EMBEDDING_CTX || '2048';
const BATCH_SIZE = process.env.BRAIN_LOCAL_LLAMA_BATCH_SIZE || '1024';
const UBATCH_SIZE = process.env.BRAIN_LOCAL_LLAMA_UBATCH_SIZE || '512';

function resolveLlamaServerBin(): string {
  const executableName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
  const candidates = [
    process.env.LLAMA_SERVER_BIN || '',
    path.resolve(repoRoot, 'runtime', 'bin', 'llama.cpp', executableName),
    path.resolve(repoRoot, 'runtime', 'bin', executableName),
    executableName,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate === executableName) return candidate;
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(
    `llama_server_not_found: set LLAMA_SERVER_BIN or install llama.cpp under runtime/bin/llama.cpp/${executableName}`,
  );
}

function appendRuntimeLog(entry: RuntimeEntry, chunk: Buffer | string): void {
  const lines = String(chunk || '').replace(/\r/g, '').split('\n').map(line => line.trim()).filter(Boolean);
  if (!lines.length) return;
  entry.recentLogs.push(...lines);
  if (entry.recentLogs.length > 40) {
    entry.recentLogs.splice(0, entry.recentLogs.length - 40);
  }
}

export class LlamaCppRuntimeManager {
  private readonly runtimes = new Map<string, RuntimeEntry>();
  private nextPort = START_PORT;

  async ensureModel(modelPath: string): Promise<LlamaRuntimeHandle> {
    return this.ensureRuntime(modelPath, 'generate');
  }

  async ensureEmbeddingModel(modelPath: string): Promise<LlamaRuntimeHandle> {
    return this.ensureRuntime(modelPath, 'embedding');
  }

  private async ensureRuntime(modelPath: string, mode: 'generate' | 'embedding'): Promise<LlamaRuntimeHandle> {
    const serverBin = resolveLlamaServerBin();
    const runtimeKey = `${mode}:${modelPath}`;
    const existing = this.runtimes.get(runtimeKey);
    if (existing && !existing.process.killed) {
      try {
        await existing.startupPromise;
        if (!existing.process.killed && !existing.exited) return existing;
      } catch {
        this.disposeRuntime(runtimeKey);
      }
    }

    const port = this.nextPort++;
    const baseUrl = `http://127.0.0.1:${port}/v1`;
    const args = [
      '-m', modelPath,
      '--port', String(port),
      '--ctx-size', mode === 'embedding' ? EMBEDDING_CTX_SIZE : CTX_SIZE,
      '--gpu-layers', GPU_LAYERS,
      '--main-gpu', MAIN_GPU,
      '--batch-size', BATCH_SIZE,
      '--ubatch-size', UBATCH_SIZE,
    ];
    if (mode === 'generate') {
      args.push('--flash-attn', 'on');
    } else {
      args.push('--embeddings', '--pooling', process.env.BRAIN_LOCAL_EMBEDDING_POOLING || 'mean');
    }
    const child = spawn(serverBin, args, {
      stdio: 'pipe',
      windowsHide: true,
    });
    if (child.pid) _addPid(child.pid);

    const entry: RuntimeEntry = {
      modelPath,
      port,
      baseUrl,
      mode,
      process: child,
      recentLogs: [],
      exited: false,
      exitCode: null,
      exitSignal: null,
      startupPromise: Promise.resolve(),
    };

    child.stdout.on('data', chunk => { appendRuntimeLog(entry, chunk); });
    child.stderr.on('data', chunk => { appendRuntimeLog(entry, chunk); });
    child.on('exit', (code, signal) => {
      entry.exited = true;
      entry.exitCode = code;
      entry.exitSignal = signal;
      if (child.pid) _removePid(child.pid);
      const current = this.runtimes.get(runtimeKey);
      if (current?.process === child) {
        this.runtimes.delete(runtimeKey);
      }
    });
    entry.startupPromise = this.waitForHealthy(entry, HEALTH_TIMEOUT_MS);
    this.runtimes.set(runtimeKey, entry);
    await entry.startupPromise;
    return entry;
  }

  disposeModel(modelPath: string): void {
    this.disposeRuntime(`generate:${modelPath}`);
  }

  disposeEmbeddingModel(modelPath: string): void {
    this.disposeRuntime(`embedding:${modelPath}`);
  }

  private disposeRuntime(runtimeKey: string): void {
    const entry = this.runtimes.get(runtimeKey);
    if (!entry) return;
    const pid = entry.process.pid;
    try { entry.process.kill(); } catch {}
    if (pid) _removePid(pid);
    this.runtimes.delete(runtimeKey);
  }

  getRuntime(modelPath: string, mode: 'generate' | 'embedding' = 'generate'): LlamaRuntimeHandle | null {
    const entry = this.runtimes.get(`${mode}:${modelPath}`);
    if (!entry || entry.process.killed) return null;
    return {
      modelPath: entry.modelPath,
      port: entry.port,
      baseUrl: entry.baseUrl,
      mode: entry.mode,
    };
  }

  disposeAll(): void {
    for (const runtimeKey of Array.from(this.runtimes.keys())) {
      this.disposeRuntime(runtimeKey);
    }
  }

  private async waitForHealthy(entry: RuntimeEntry, timeoutMs: number): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (entry.exited) {
        const tail = entry.recentLogs.slice(-8).join(' | ');
        throw new Error(`llama_runtime_start_failed:${entry.baseUrl}:exit=${entry.exitCode ?? 'null'}:${tail || 'no_logs'}`);
      }
      if (await this.isHealthy(entry.baseUrl)) return;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    const tail = entry.recentLogs.slice(-8).join(' | ');
    throw new Error(`llama_runtime_start_timeout:${entry.baseUrl}:${tail || 'no_logs'}`);
  }

  private async isHealthy(baseUrl: string): Promise<boolean> {
    try {
      const response = await fetch(`${baseUrl}/models`);
      return response.ok;
    } catch {
      return false;
    }
  }
}

let runtimeManager: LlamaCppRuntimeManager | null = null;

export function getLlamaCppRuntimeManager(): LlamaCppRuntimeManager {
  if (!runtimeManager) {
    killStaleLlamaProcesses();
    runtimeManager = new LlamaCppRuntimeManager();
  }
  return runtimeManager;
}



