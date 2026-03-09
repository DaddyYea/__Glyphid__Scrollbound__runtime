/**
 * workerBridge.ts
 *
 * Generic WorkerBridge — spawns a persistent worker thread, routes
 * request/response pairs by sequence number, auto-restarts on crash.
 *
 * Workers are spawned with `--require tsx/cjs` so TypeScript files run
 * directly without a separate compile step.
 */

import { Worker } from 'worker_threads';
import path from 'node:path';

interface PendingRequest<TRes> {
  resolve: (value: TRes) => void;
  reject: (err: Error) => void;
  timeout: NodeJS.Timeout | null;
}

export class WorkerBridge<TReq extends object, TRes extends { seq: number }> {
  private worker: Worker | null = null;
  private pending = new Map<number, PendingRequest<TRes>>();
  private seq = 0;
  private readonly workerPath: string;
  private restartTimer: NodeJS.Timeout | null = null;
  private readonly restartDelayMs: number;
  private readonly requestTimeoutMs: number;
  private terminated = false;

  constructor(workerPath: string, opts: { restartDelayMs?: number; requestTimeoutMs?: number } = {}) {
    this.workerPath = workerPath;
    this.restartDelayMs = opts.restartDelayMs ?? 5000;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 120_000; // 2 min default
    this.spawn();
  }

  private spawn(): void {
    if (this.terminated) return;
    const name = path.basename(this.workerPath);
    try {
      this.worker = new Worker(this.workerPath, {
        execArgv: ['--require', 'tsx/cjs'],
      });
      this.worker.on('message', (msg: TRes) => {
        const p = this.pending.get(msg.seq);
        if (p) {
          if (p.timeout) clearTimeout(p.timeout);
          p.resolve(msg);
          this.pending.delete(msg.seq);
        }
      });
      this.worker.on('error', (err) => {
        console.error(`[WORKER:${name}] Error:`, err.message);
        this.rejectAll(err);
        this.scheduleRestart();
      });
      this.worker.on('exit', (code) => {
        if (code !== 0 && !this.terminated) {
          console.error(`[WORKER:${name}] Exited with code ${code}`);
          this.rejectAll(new Error(`Worker ${name} exited with code ${code}`));
          this.scheduleRestart();
        }
      });
    } catch (err) {
      console.error(`[WORKER:${name}] Failed to spawn:`, err);
      this.worker = null;
      this.scheduleRestart();
    }
  }

  private rejectAll(err: Error): void {
    for (const p of this.pending.values()) {
      if (p.timeout) clearTimeout(p.timeout);
      p.reject(err);
    }
    this.pending.clear();
    this.worker = null;
  }

  private scheduleRestart(): void {
    if (this.terminated || this.restartTimer) return;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.spawn();
    }, this.restartDelayMs);
  }

  send(msg: Omit<TReq, 'seq'>, transfer: ArrayBuffer[] = []): Promise<TRes> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error(`Worker ${path.basename(this.workerPath)} not available`));
        return;
      }
      const seq = ++this.seq;
      const timeout = this.requestTimeoutMs > 0
        ? setTimeout(() => {
            this.pending.delete(seq);
            reject(new Error(`Worker ${path.basename(this.workerPath)} request timed out (seq=${seq})`));
          }, this.requestTimeoutMs)
        : null;
      this.pending.set(seq, { resolve, reject, timeout });
      this.worker.postMessage({ ...msg, seq }, transfer);
    });
  }

  terminate(): void {
    this.terminated = true;
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    this.rejectAll(new Error('Worker terminated'));
    this.worker?.terminate();
    this.worker = null;
  }
}
