/**
 * Communion Server (N-Agent)
 *
 * Config-driven server. Agents are defined in communion.config.json
 * or built from environment variables.
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { createInterface } from 'readline';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync, createReadStream } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import type { Socket } from 'net';
import crypto from 'crypto';
import { CommunionLoop, CommunionEvent } from './communionLoop';
import { CommunionConfig, AgentConfig } from './types';
import { VOICES } from './voice';
import { FileSystemModelCatalog } from '../src/brain/ModelCatalog';
import { HuggingFaceApiRegistry } from '../src/brain/HuggingFaceRegistry';
import { InstallProgress, ModelInstaller } from '../src/brain/ModelInstaller';
import { getGraphRef } from './graph/scrollGraphStore';
import { WORK_NODE_TYPES, WORK_RESOLUTION_TYPES } from './work/workModels';
import { proposeWork, acceptWork, rejectWork, deferWork, executeWork, getWorkSnippet, WorkExecutionError, normalizeWorkAction, findOpenWorkByDeterministicKey, initializeWorkDedupeIndex, resolveWork, WorkResolveError, getWorkDedupeIndexStats } from './work/workLifecycle';
import { runWorkPass } from './work/workPass';
// Import parsing happens in a child worker process (communion/import/worker.ts)
import { promoteExample, listExamples, getExampleCount, enrichExample, loadProfile, listPreferencePairs, listEvalRuns, loadActiveBundle, loadCandidateBundle, promoteCandidate, checkAndEnrichRecentPromotions } from './goldenStore';
import { workspace } from './docs/workspace';
import type { SearchQuery, ChunkHighlight, ReviewSession } from './docs/types';
import { CouncilOrchestrator } from './council/orchestrator';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

let clients: ServerResponse[] = [];
let sockets = new Set<Socket>();
const speechAudioCache = new Map<string, { audio: Buffer; createdAt: number }>();
let lastReceiptClusterLogId = '';
const WORK_QUEUE_TYPES = WORK_NODE_TYPES.filter(t => t !== 'ActionLog' && t !== 'VetoEvent' && t !== 'WorkExecutionEvent' && t !== 'WorkResolutionEvent');
const WORK_QUEUE_TYPES_SET = new Set<string>(WORK_QUEUE_TYPES as readonly string[]);
const WORK_STATUS_VALUES = ['proposed', 'accepted', 'rejected', 'deferred', 'done'] as const;
const WORK_RESOLUTION_TYPES_SET = new Set<string>(WORK_RESOLUTION_TYPES as readonly string[]);
const brainModelCatalog = new FileSystemModelCatalog();
const huggingFaceRegistry = new HuggingFaceApiRegistry();
const brainModelInstaller = new ModelInstaller();
type BrainInstallJob = {
  id: string;
  status: 'queued' | 'running' | 'complete' | 'error' | 'cancelled';
  progress: InstallProgress;
  result?: any;
  error?: string;
  createdAt: number;
  updatedAt: number;
  controller?: AbortController;
};
const brainInstallJobs = new Map<string, BrainInstallJob>();

function pruneBrainInstallJobs(): void {
  const cutoff = Date.now() - 1000 * 60 * 30;
  for (const [jobId, job] of brainInstallJobs.entries()) {
    if (job.updatedAt < cutoff && (job.status === 'complete' || job.status === 'error')) {
      brainInstallJobs.delete(jobId);
    }
  }
}

function createBrainInstallJob(): BrainInstallJob {
  pruneBrainInstallJobs();
  const id = crypto.randomUUID();
  const job: BrainInstallJob = {
    id,
    status: 'queued',
    progress: {
      phase: 'metadata',
      bytesDownloaded: 0,
      totalBytes: null,
      message: 'Queued',
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  brainInstallJobs.set(id, job);
  return job;
}

function readJsonBody(req: IncomingMessage, res: ServerResponse, onValid: (payload: any) => void): void {
  let body = '';
  req.on('data', chunk => { body += chunk.toString(); });
  req.on('end', () => {
    try {
      onValid(JSON.parse(body || '{}'));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
    }
  });
}

function broadcast(data: object): void {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  clients.forEach(client => {
    try { client.write(message); } catch { /* disconnected */ }
  });
}

function extractLinkedIds(node: any, predicate: string): string[] {
  const out = new Set<string>();
  const edgeRefs = node?.edges?.[predicate];
  if (Array.isArray(edgeRefs)) {
    for (const edge of edgeRefs) {
      const target = typeof edge?.target === 'string' ? edge.target : '';
      if (target) out.add(target);
    }
  }
  const topLevelRefs = node?.[predicate];
  if (Array.isArray(topLevelRefs)) {
    for (const ref of topLevelRefs) {
      if (typeof ref === 'string' && ref) out.add(ref);
      const id = typeof ref?.['@id'] === 'string' ? ref['@id'] : '';
      if (id) out.add(id);
    }
  }
  return Array.from(out);
}

/**
 * Load config from communion.config.json, falling back to env vars
 */
function loadConfig(): CommunionConfig {
  const configPath = join(process.cwd(), 'communion.config.json');

  if (existsSync(configPath)) {
    console.log('[CONFIG] Loading from communion.config.json');
    const raw = readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as CommunionConfig;
  }

  // Fallback: build config from environment variables
  console.log('[CONFIG] No communion.config.json found, building from env vars');
  const agents: AgentConfig[] = [];

  // Scan for AGENT_*_PROVIDER env vars
  // Pattern: AGENT_<ID>_PROVIDER, AGENT_<ID>_API_KEY, AGENT_<ID>_MODEL, etc.
  const agentIds = new Set<string>();
  for (const key of Object.keys(process.env)) {
    const match = key.match(/^AGENT_([A-Z0-9_]+)_PROVIDER$/);
    if (match) agentIds.add(match[1]);
  }

  for (const envId of agentIds) {
    const provider = process.env[`AGENT_${envId}_PROVIDER`];
    const apiKey = process.env[`AGENT_${envId}_API_KEY`];
    const model = process.env[`AGENT_${envId}_MODEL`];
    const name = process.env[`AGENT_${envId}_NAME`] || envId.toLowerCase();
    const baseUrl = process.env[`AGENT_${envId}_BASE_URL`];
    const color = process.env[`AGENT_${envId}_COLOR`];

    if (!provider || !apiKey || !model) {
      console.warn(`[CONFIG] Skipping agent ${envId}: missing PROVIDER, API_KEY, or MODEL`);
      continue;
    }

    agents.push({
      id: envId.toLowerCase(),
      name,
      provider: provider as 'anthropic' | 'openai-compatible' | 'lmstudio',
      apiKey,
      model,
      baseUrl,
      color,
    });
  }

  // Legacy support: ANTHROPIC_API_KEY / XAI_API_KEY / OPENAI_API_KEY
  if (agents.length === 0) {
    if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'sk-ant-...') {
      agents.push({
        id: 'claude',
        name: 'Claude',
        provider: 'anthropic',
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929',
        color: '#7eb8da',
      });
    }
    if (process.env.XAI_API_KEY && process.env.XAI_API_KEY !== 'xai-...') {
      agents.push({
        id: 'grok',
        name: 'Grok',
        provider: 'openai-compatible',
        apiKey: process.env.XAI_API_KEY,
        model: process.env.GROK_MODEL || 'grok-4-1-fast',
        baseUrl: 'https://api.x.ai/v1',
        color: '#da9a7e',
      });
    }
    if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'sk-...') {
      agents.push({
        id: 'openai',
        name: 'GPT',
        provider: 'openai-compatible',
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_MODEL || 'gpt-4o',
        baseUrl: 'https://api.openai.com/v1',
        color: '#b87eda',
      });
    }
  }

  // Fallback: load active agents from dynamic-agents.json if nothing else configured
  if (agents.length === 0) {
    const dynamicPath = join(process.env.DATA_DIR || 'data/communion', 'dynamic-agents.json');
    if (existsSync(dynamicPath)) {
      try {
        const dynamic = JSON.parse(readFileSync(dynamicPath, 'utf8'));
        let loadedBrainLocalAgentId: string | null = null;
        for (const [, entry] of Object.entries(dynamic) as [string, any][]) {
          if (!entry.active || !entry.config) continue;

          const isAloisProvider = entry.config.provider === 'brain-local' || (entry.config.provider === 'openai-compatible' && entry.config.id.startsWith('alois'));
          if (isAloisProvider) {
            if (loadedBrainLocalAgentId) {
              console.warn(`[CONFIG] Skipping extra active brain/alois agent from dynamic-agents.json: ${entry.config.id} (already loaded ${loadedBrainLocalAgentId})`);
              continue;
            }
            loadedBrainLocalAgentId = entry.config.id;
          }

          agents.push(entry.config);
          console.log(`[CONFIG] Loaded agent from dynamic-agents.json: ${entry.config.id}`);
        }
      } catch (e) {
        console.warn('[CONFIG] Failed to read dynamic-agents.json:', e);
      }
    }
  }

  if (agents.length === 0) {
    console.error('No agents configured. Either create communion.config.json or set API key env vars.');
    console.error('See .env.example or communion.config.example.json for details.');
    process.exit(1);
  }

  return {
    humanName: process.env.HUMAN_NAME || 'Jason',
    agents,
    tickIntervalMs: Number(process.env.TICK_INTERVAL_MS) || 15000, // 15s default
    dataDir: process.env.DATA_DIR || 'data/communion',
    documentsDir: process.env.DOCUMENTS_DIR || 'communion-docs',
  };
}

/**
 * Collect request body with size limit
 */
/**
 * Handle /import — spawn worker process with 4GB heap to parse large files.
 * The file is read directly from the user's disk path (no upload needed).
 */
async function handleImportFile(filePath: string, source: string, config: CommunionConfig, res: ServerResponse): Promise<void> {
  try {
    broadcast({ type: 'import-status', status: 'parsing', source });

    const dataDir = config.dataDir || 'data/communion';
    const workerPath = join(__dirname, 'import', 'worker.ts');

    console.log(`[IMPORT] Spawning worker: source=${source}, file=${filePath}`);
    console.log(`[IMPORT] Worker path: ${workerPath}`);
    console.log(`[IMPORT] execPath: ${process.execPath}`);
    console.log(`[IMPORT] execArgv: ${JSON.stringify(process.execArgv)}`);

    const summary = await new Promise<any>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['--max-old-space-size=4096', ...process.execArgv, workerPath, source, filePath, dataDir, config.humanName],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=4096' },
        }
      );

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      child.stderr.on('data', (d: Buffer) => {
        const lines = d.toString().split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          stderr += trimmed + '\n';
          // Worker sends progress as JSON on stderr
          try {
            const progress = JSON.parse(trimmed);
            if (progress.status === 'parsed') {
              broadcast({ type: 'import-status', status: 'parsed', source, ...progress });
              broadcast({ type: 'import-status', status: 'ingesting', source });
            }
          } catch {
            console.log(`[IMPORT WORKER] ${trimmed}`);
          }
        }
      });

      child.on('close', (code) => {
        console.log(`[IMPORT] Worker exited with code ${code}`);
        if (code !== 0) {
          let errorMsg = 'Import worker failed';
          try {
            const parsed = JSON.parse(stdout);
            if (parsed.error) errorMsg = parsed.error;
          } catch {
            // Use last stderr line as error
            const lastLine = stderr.trim().split('\n').pop();
            if (lastLine) errorMsg = lastLine;
          }
          reject(new Error(errorMsg));
        } else {
          try {
            resolve(JSON.parse(stdout));
          } catch {
            reject(new Error(`Worker returned invalid output: ${stdout.substring(0, 200)}`));
          }
        }
      });

      child.on('error', (err) => {
        console.error('[IMPORT] Failed to spawn worker:', err);
        reject(err);
      });
    });

    broadcast({ type: 'import-status', status: 'complete', ...summary });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(summary));

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[IMPORT] Error:', msg);
    if (err instanceof Error && err.stack) console.error(err.stack);
    broadcast({ type: 'import-status', status: 'error', error: msg });
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: msg }));
    }
  }
}

async function main() {
  console.log('=== Communion Space ===\n');

  const config = loadConfig();

  console.log(`  Human: ${config.humanName}`);
  console.log(`  Agents: ${config.agents.map(a => `${a.name} (${a.provider}/${a.model})`).join(', ')}`);
  console.log(`  Tick: ${(config.tickIntervalMs || 15000) / 1000}s\n`);

  // Initialize communion loop
  const communion = new CommunionLoop(config);
  await communion.initialize();
  initializeWorkDedupeIndex();

  // Initialize document workspace from the configured documentsDir.
  workspace.init(config.documentsDir).catch(err => console.error('[WORKSPACE] Init error:', err));

  // Initialize Council orchestrator
  const councilOrchestrator = new CouncilOrchestrator(
    config.dataDir || 'data/communion',
    (type, payload) => broadcast({ type, ...((payload && typeof payload === 'object') ? payload : { data: payload }) }),
  );

  // Wire events → SSE broadcast
  communion.on((event: CommunionEvent) => {
    if (event.type === 'room-message' && event.message) {
      broadcast({
        type: 'room-message',
        id: event.message.id,
        speaker: event.message.speaker,
        speakerName: event.message.speakerName,
        text: event.message.text,
        visibleText: event.message.visibleText || event.message.text,
        anchoredAfterMessageId: event.message.anchoredAfterMessageId || event.anchoredEmitTargetMessageId,
        timestamp: event.message.timestamp,
      });
    } else if (event.type === 'journal-entry' && event.message) {
      broadcast({
        type: 'journal-entry',
        id: event.message.id,
        speaker: event.message.speaker,
        speakerName: event.message.speakerName,
        text: event.message.text,
        timestamp: event.message.timestamp,
      });
    } else if (event.type === 'backchannel' && event.message) {
      broadcast({
        type: 'backchannel',
        id: event.message.id,
        speaker: event.message.speaker,
        speakerName: event.message.speakerName,
        text: event.message.text,
        timestamp: event.message.timestamp,
      });
    } else if (event.type === 'inner-thought' && event.innerThought) {
      broadcast({
        type: 'inner-thought',
        agentId: event.agentId,
        thought: event.innerThought,
        timestamp: new Date().toISOString(),
      });
    } else if (event.type === 'tick') {
      broadcast({ type: 'tick', tickCount: event.tickCount });
    } else if (event.type === 'speech-start') {
      broadcast({ type: 'speech-start', agentId: event.agentId, requestId: event.requestId });
    } else if (event.type === 'speech-chunk') {
      // Cache each chunk under its own ID for URL-based delivery; also include inline base64 fallback.
      let chunkAudioUrl: string | undefined;
      if (event.audioBase64 && event.audioBase64.length > 0) {
        const chunkId = `${event.agentId || 'agent'}-chunk${event.chunkIndex ?? 0}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const chunkBuffer = Buffer.from(event.audioBase64, 'base64');
        speechAudioCache.set(chunkId, { audio: chunkBuffer, createdAt: Date.now() });
        chunkAudioUrl = `/speech-audio/${chunkId}`;
      }
      broadcast({
        type: 'speech-chunk',
        agentId: event.agentId,
        requestId: event.requestId,
        audioUrl: chunkAudioUrl,
        audioBase64: event.audioBase64,
        chunkIndex: event.chunkIndex,
        chunkCount: event.chunkCount,
        isFinalChunk: event.isFinalChunk,
        durationMs: event.durationMs,
      });
    } else if (event.type === 'speech-end') {
      let audioUrl: string | undefined;
      let audioBase64: string | undefined;
      if (event.audioBase64 && event.audioBase64.length > 0) {
        const audioId = `${event.agentId || 'agent'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const audioBuffer = Buffer.from(event.audioBase64, 'base64');
        speechAudioCache.set(audioId, { audio: audioBuffer, createdAt: Date.now() });
        audioUrl = `/speech-audio/${audioId}`;
        // Always include inline fallback so long replies still have a second playback path
        // if URL fetch/streaming fails in the browser.
        audioBase64 = event.audioBase64;
      }
      broadcast({
        type: 'speech-end',
        agentId: event.agentId,
        requestId: event.requestId,
        audioUrl,
        audioBase64,
        durationMs: event.durationMs,
      });
    } else if (event.type === 'speech-stop') {
      broadcast({
        type: 'speech-stop',
        agentId: event.agentId,
        reason: event.reason,
        requestId: event.requestId,
      });
    } else if (event.type === 'turn-latency' && event.latencyTrace) {
      broadcast({ type: 'turn-latency', agentId: event.agentId, latencyTrace: event.latencyTrace });
    } else if (event.type === 'processing-status') {
      broadcast({ type: 'processing-status', agentId: event.agentId, statusLabel: event.statusLabel, elapsedMs: event.elapsedMs });
    } else if (event.type === 'error') {
      broadcast({ type: 'error', agentId: event.agentId, error: event.error });
    }
  });

  // Pond saturation cache — recomputing getNeuronScores() on every concurrent poll is wasteful
  const pondCache: { payload: object | null; ts: number } = { payload: null, ts: 0 };
  let isShuttingDown = false;
  const pruneSpeechAudioCache = (): void => {
    const cutoff = Date.now() - 5 * 60 * 1000;
    for (const [audioId, entry] of speechAudioCache.entries()) {
      if (entry.createdAt < cutoff) speechAudioCache.delete(audioId);
    }
  };

  // HTTP server
  const server = createServer((req, res) => {
    const url = req.url || '/';

    // Log all requests for debugging
    console.log(`[HTTP] ${req.method} ${url}`);
    pruneSpeechAudioCache();

    // Handle CORS preflight for any route
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    if (url.startsWith('/speech-audio/') && (req.method === 'GET' || req.method === 'HEAD')) {
      const audioId = decodeURIComponent(url.slice('/speech-audio/'.length));
      const cached = speechAudioCache.get(audioId);
      if (!cached) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Audio not found' }));
        return;
      }
      const range = req.headers.range;
      if (range) {
        const match = /^bytes=(\d+)-(\d*)$/i.exec(range);
        if (match) {
          const start = Number(match[1]);
          const end = match[2] ? Number(match[2]) : cached.audio.length - 1;
          const safeStart = Math.max(0, Math.min(start, cached.audio.length - 1));
          const safeEnd = Math.max(safeStart, Math.min(end, cached.audio.length - 1));
          const chunk = cached.audio.subarray(safeStart, safeEnd + 1);
          res.writeHead(206, {
            'Content-Type': 'audio/mpeg',
            'Cache-Control': 'no-store',
            'Accept-Ranges': 'bytes',
            'Content-Range': `bytes ${safeStart}-${safeEnd}/${cached.audio.length}`,
            'Content-Length': chunk.length,
          });
          res.end(chunk);
          return;
        }
      }
      res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
        'Accept-Ranges': 'bytes',
        'Content-Length': cached.audio.length,
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      res.end(cached.audio);
      return;
    }

    if (url === '/debug/routes' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        hasWorkPass: true,
        note: 'server.ts updated',
      }));
      return;
    }

    if (isShuttingDown) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'shutting_down' }));
      return;
    }

    // Keep work-pass route near the top so no broader route can shadow it.
    if (url === '/debug/work-pass' && req.method === 'POST') {
      readJsonBody(req, res, payload => {
        const modeRaw = payload?.mode;
        const countRaw = payload?.count;
        const mode = modeRaw === undefined ? 'ENGINEER' : modeRaw;

        if (!['COMPANION', 'ENGINEER', 'WRITING'].includes(mode)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'mode must be COMPANION|ENGINEER|WRITING' }));
          return;
        }

        if (countRaw !== undefined) {
          const n = Number(countRaw);
          if (!Number.isFinite(n) || n <= 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'count must be a positive number' }));
            return;
          }
        }

        const count = countRaw === undefined ? 3 : Math.max(1, Math.floor(Number(countRaw)));
        try {
          const { created, skippedDuplicatesCount } = runWorkPass({ count, mode });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, created, skippedDuplicatesCount }));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: msg }));
        }
      });
      return;
    }

    // Dashboard
    if (url === '/' || url === '/index.html') {
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      });
      const html = readFileSync(join(__dirname, 'dashboard.html'), 'utf-8');
      res.end(html);
      return;
    }

    // Rejection tally — live validation rejection counts per agent
    if (url === '/api/debug/rejection-tally' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify(communion.getRejectionTally(), null, 2));
      return;
    }

    // ── Golden Set API ──────────────────────────────────────────────────────

    if (url === '/api/golden/promote' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (!data.captureMode || !data.messageId || !data.assistantReplyText) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'captureMode, messageId, and assistantReplyText required' }));
            return;
          }
          const result = promoteExample(data);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', result }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
      return;
    }

    if (url?.startsWith('/api/golden/list') && req.method === 'GET') {
      const params = new URL(req.url || '', `http://localhost:${PORT}`).searchParams;
      const filters: Record<string, any> = {};
      if (params.get('captureMode')) filters.captureMode = params.get('captureMode');
      if (params.get('lane')) filters.lane = params.get('lane');
      if (params.get('tags')) filters.tags = params.get('tags')!.split(',');
      if (params.get('limit')) filters.limit = parseInt(params.get('limit')!);
      if (params.get('offset')) filters.offset = parseInt(params.get('offset')!);
      const examples = listExamples(filters);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify(examples));
      return;
    }

    if (url === '/api/golden/counts' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify(getExampleCount()));
      return;
    }

    if (url === '/api/golden/enrich' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (!data.exampleId || !data.outcome) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'exampleId and outcome required' }));
            return;
          }
          enrichExample(data.exampleId, data.outcome);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
      return;
    }

    if (url === '/api/golden/profile' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify(loadProfile()));
      return;
    }

    if (url === '/api/golden/preferences' && req.method === 'GET') {
      const params = new URL(req.url || '', `http://localhost:${PORT}`).searchParams;
      const limit = parseInt(params.get('limit') || '50');
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify(listPreferencePairs(limit)));
      return;
    }

    if (url === '/api/golden/eval-runs' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify(listEvalRuns()));
      return;
    }

    if (url === '/api/golden/bundle' && req.method === 'GET') {
      const active = loadActiveBundle();
      const candidate = loadCandidateBundle();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify({ active, candidate }));
      return;
    }

    if (url === '/api/golden/bundle/promote' && req.method === 'POST') {
      const ok = promoteCandidate();
      res.writeHead(ok ? 200 : 404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: ok ? 'promoted' : 'no_candidate' }));
      return;
    }

    if (url === '/api/golden/export' && req.method === 'GET') {
      const params = new URL(req.url || '', `http://localhost:${PORT}`).searchParams;
      const filters: Record<string, any> = {};
      if (params.get('captureMode')) filters.captureMode = params.get('captureMode');
      if (params.get('lane')) filters.lane = params.get('lane');
      if (params.get('tags')) filters.tags = params.get('tags')!.split(',');
      filters.limit = 10000;
      const examples = listExamples(filters);
      const jsonl = examples.map(e => JSON.stringify(e)).join('\n');
      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Content-Disposition': 'attachment; filename="golden_export.jsonl"',
      });
      res.end(jsonl);
      return;
    }

    // Preset bank — GET reads presets.json, POST writes it
    if (url === '/api/presets') {
      const presetsPath = join(process.cwd(), 'data', 'communion', 'presets.json');
      if (req.method === 'GET') {
        if (existsSync(presetsPath)) {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
          res.end(readFileSync(presetsPath, 'utf-8'));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ pad: [], lead: [] }));
        }
        return;
      }
      if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            mkdirSync(join(process.cwd(), 'data', 'communion'), { recursive: true });
            writeFileSync(presetsPath, JSON.stringify(data, null, 2), 'utf-8');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok' }));
          } catch {
            res.writeHead(400); res.end('Bad request');
          }
        });
        return;
      }
    }

    // MIDI fragment library
    if (url === '/api/midi-fragments') {
      const fragPath = join(process.cwd(), 'assets', 'midi-fragments.json');
      if (existsSync(fragPath)) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' });
        res.end(readFileSync(fragPath, 'utf-8'));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'midi-fragments.json not found — run: npx tsx scripts/bake-midi-fragments.ts' }));
      }
      return;
    }

    // SSE stream
    if (url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      clients.push(res);
      req.on('close', () => { clients = clients.filter(c => c !== res); });

      // Send config (agent list, colors, names, providers)
      const state = communion.getState();
      const agentProviders: Record<string, string> = {};
      const brainLocalConfigs: Record<string, { routerModel?: string; languageModel?: string }> = {};
      for (const c of communion.getAgentConfigs()) agentProviders[c.id] = c.provider;
      for (const c of communion.getAgentConfigs()) {
        if (c.provider === 'brain-local' || (c.provider === 'openai-compatible' && c.id.startsWith('alois'))) {
          brainLocalConfigs[c.id] = {
            routerModel: c.routerModel || c.routerModelPath || '',
            languageModel: c.languageModel || c.languageModelPath || c.model || '',
          };
        }
      }
      res.write(`data: ${JSON.stringify({
        type: 'config',
        agentIds: state.agentIds,
        agentNames: state.agentNames,
        agentColors: state.agentColors,
        agentProviders,
        brainLocalConfigs,
        humanName: state.humanName,
        voiceConfigs: communion.getAllVoiceConfigs(),
        voices: VOICES,
        agentClocks: communion.getAllAgentClocks(),
        customInstructions: communion.getAllCustomInstructions(),
      })}\n\n`);

      // Replay existing messages
      for (const msg of state.messages) {
        res.write(`data: ${JSON.stringify({
          type: 'room-message',
          id: msg.id,
          speaker: msg.speaker,
          speakerName: msg.speakerName,
          text: msg.text,
          visibleText: msg.visibleText || msg.text,
          anchoredAfterMessageId: msg.anchoredAfterMessageId,
          timestamp: msg.timestamp,
        })}\n\n`);
      }
      // Replay journal entries
      for (const agentId of state.agentIds) {
        for (const entry of (state.journals[agentId] || [])) {
          res.write(`data: ${JSON.stringify({
            type: 'journal-entry',
            id: entry.id,
            speaker: entry.speaker,
            speakerName: entry.speakerName,
            text: entry.text,
            timestamp: entry.timestamp,
          })}\n\n`);
        }
      }

      return;
    }

    // Human message (also accepts /transcript from Whisper STT bridge)
    if ((url === '/message' || url === '/transcript') && req.method === 'POST') {
      // Queue STT transcripts while TTS is playing — replay after speech completes
      if (url === '/transcript' && (communion as any).speaking) {
        let body2 = '';
        req.on('data', (chunk: Buffer) => { body2 += chunk.toString(); });
        req.on('end', () => {
          try {
            const ct = String(req.headers['content-type'] || '').toLowerCase();
            let text = '';
            const tb = (body2 || '').trim();
            if (ct.includes('application/json') || tb.startsWith('{')) {
              const parsed = JSON.parse(tb);
              text = parsed.text || parsed.transcript || '';
            } else {
              text = tb;
            }
            const normalized = text.trim();
            if (normalized) {
              (communion as any).queueTranscript?.(normalized);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ status: 'queued' }));
            } else {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ status: 'empty' }));
            }
          } catch {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'queued' }));
          }
        });
        return;
      }
      const messageSource: 'voice' | 'keyboard' = url === '/transcript' ? 'voice' : 'keyboard';
      if (url === '/transcript') {
        console.log('[DEBUG-STT] /transcript hit from', req.headers['user-agent']?.substring(0, 50), 'referer:', req.headers['referer']?.substring(0, 80));
      }
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const contentType = String(req.headers['content-type'] || '').toLowerCase();
          let text = '';
          const trimmedBody = (body || '').trim();

          // Try JSON first whenever the payload looks like JSON, even if content-type is wrong.
          if (!text && trimmedBody.startsWith('{')) {
            try {
              const payload = JSON.parse(trimmedBody);
              if (typeof payload?.text === 'string') text = payload.text;
              else if (typeof payload?.message === 'string') text = payload.message;
            } catch {
              // fall through to content-type specific parsing
            }
          }

          if (!text && contentType.includes('application/json')) {
            const payload = JSON.parse(body || '{}');
            if (typeof payload?.text === 'string') text = payload.text;
            else if (typeof payload?.message === 'string') text = payload.message;
          } else if (!text && contentType.includes('application/x-www-form-urlencoded')) {
            const form = new URLSearchParams(body || '');
            text = String(form.get('text') || form.get('message') || '');
          } else if (!text) {
            text = body;
          }

          const normalized = (text || '').trim();
          if (normalized) {
            console.log('[DEBUG-STT] text=' + JSON.stringify(normalized.substring(0, 100)) + ' source=' + messageSource + ' url=' + url);
            communion.addHumanMessage(normalized, messageSource);
            const requestImmediateTick = (communion as any).requestImmediateTick;
            if (typeof requestImmediateTick === 'function') {
              requestImmediateTick.call(communion, 'human');
            }
            console.log(`[${config.humanName}] ${normalized}`);
            // Background-enrich any recently promoted golden examples
            try { checkAndEnrichRecentPromotions(normalized, new Date().toISOString()); } catch { /* non-critical */ }
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
        } catch (err) {
          const fallback = (body || '').trim();
          if (fallback) {
            communion.addHumanMessage(fallback, messageSource);
            const requestImmediateTick = (communion as any).requestImmediateTick;
            if (typeof requestImmediateTick === 'function') {
              requestImmediateTick.call(communion, 'human');
            }
            console.log(`[${config.humanName}] ${fallback}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', parseWarning: err instanceof Error ? err.message : 'invalid_request' }));
            return;
          }
          // No recoverable text: no-op 200 so the UI does not surface a false send failure.
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ignored', reason: 'invalid_request' }));
        }
      });
      return;
    }

    // State API
    if (url === '/state') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const state = communion.getState();
      res.end(JSON.stringify({
        tickCount: state.tickCount,
        messageCount: state.messages.length,
        agents: state.agentIds,
        scrollCount: communion.getMemory().getMetrics().totalScrolls,
        archiveCount: communion.getArchive().getStats().totalScrolls,
      }));
      return;
    }

    // LLM receipt debug API (browser-visible, no server-side file writes)
    if (url?.startsWith('/debug/llm-receipt') && req.method === 'GET') {
      const params = new URLSearchParams(url.split('?')[1] || '');
      const agentId = params.get('agentId') || undefined;
      const getLLMReceipt = (communion as any).getLLMReceipt;
      const getRelationalTrace = (communion as any).getRelationalTrace;
      const receipt = typeof getLLMReceipt === 'function'
        ? getLLMReceipt.call(communion, agentId)
        : null;
      const trace = typeof getRelationalTrace === 'function'
        ? getRelationalTrace.call(communion, agentId)
        : null;
      if (receipt && receipt.requestId !== lastReceiptClusterLogId) {
        lastReceiptClusterLogId = receipt.requestId;
        console.log('[LLMDBG] receipt.clusterChars keys:', Object.keys(receipt.clusterChars || {}));
        console.log('[LLMDBG] receipt.clusterChars:', receipt.clusterChars || {});
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      });
      res.end(JSON.stringify({
        receipt,
        trace,
      }));
      return;
    }

    // Per-cluster ablation flags API
    if (url === '/debug/llm-ablation' && req.method === 'GET') {
      const getLLMAblations = (communion as any).getLLMAblations;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ablations: typeof getLLMAblations === 'function'
          ? getLLMAblations.call(communion)
          : {},
      }));
      return;
    }

    if (url === '/debug/llm-ablation' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}') as {
            ablations?: Record<string, boolean>;
            resetAblations?: boolean;
          };
          const setLLMAblationFlags = (communion as any).setLLMAblationFlags;
          const ablations = typeof setLLMAblationFlags === 'function'
            ? setLLMAblationFlags.call(communion, parsed.ablations || {}, !!parsed.resetAblations)
            : {};
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ablations }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    if (url === '/debug/work-propose' && req.method === 'POST') {
      readJsonBody(req, res, payload => {
        const type = payload?.type;
        const proposedBy = payload?.proposedBy;
        const mode = payload?.mode;
        const relatedTo = payload?.relatedTo;
        const details = payload?.details;
        if (typeof type !== 'string' || !WORK_QUEUE_TYPES_SET.has(type)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid type' }));
          return;
        }
        if (!['agent:human', 'agent:alois', 'system'].includes(proposedBy)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid proposedBy' }));
          return;
        }
        if (mode !== undefined && !['COMPANION', 'ENGINEER', 'WRITING'].includes(mode)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid mode' }));
          return;
        }
        if (relatedTo !== undefined && (!Array.isArray(relatedTo) || !relatedTo.every((v: unknown) => typeof v === 'string'))) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'relatedTo must be string[]' }));
          return;
        }
        if (details !== undefined && (typeof details !== 'object' || details === null || Array.isArray(details))) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'details must be an object' }));
          return;
        }
        try {
          const needsAction = type === 'WorkItem' || type === 'Deprecation';
          if (needsAction && (details === undefined || details === null || Array.isArray(details) || typeof details !== 'object')) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'details.actionType and details.payload are required for this type' }));
            return;
          }

          let normalizedAction: ReturnType<typeof normalizeWorkAction> | null = null;
          if (details && typeof details === 'object' && !Array.isArray(details)) {
            const hasActionFields = Object.prototype.hasOwnProperty.call(details, 'actionType') || Object.prototype.hasOwnProperty.call(details, 'action');
            if (needsAction || hasActionFields) normalizedAction = normalizeWorkAction(details);
          }

          if (normalizedAction) {
            const duplicate = findOpenWorkByDeterministicKey(normalizedAction.deterministicKey, ['proposed', 'accepted']);
            if (duplicate) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                ok: true,
                deduped: true,
                existingId: duplicate['@id'],
                deterministicKey: normalizedAction.deterministicKey,
              }));
              return;
            }
          }

          const detailsCanonical = normalizedAction
            ? {
              ...(details as Record<string, unknown>),
              actionType: normalizedAction.action.actionType,
              payload: normalizedAction.action.payload,
              deterministicKey: normalizedAction.deterministicKey,
            }
            : details;

          const result = proposeWork({
            type,
            proposedBy,
            mode,
            title: typeof payload?.title === 'string' ? payload.title : undefined,
            summary: typeof payload?.summary === 'string' ? payload.summary : undefined,
            details: detailsCanonical,
            relatedTo,
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            result,
            ...(normalizedAction ? { deterministicKey: normalizedAction.deterministicKey } : {}),
          }));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: msg }));
        }
      });
      return;
    }

    if (url === '/debug/work-accept' && req.method === 'POST') {
      readJsonBody(req, res, payload => {
        const id = payload?.id;
        const acceptedBy = payload?.acceptedBy;
        if (typeof id !== 'string' || !id.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'id is required' }));
          return;
        }
        if (acceptedBy !== 'agent:alois') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'acceptedBy must be agent:alois' }));
          return;
        }
        try {
          const result = acceptWork(id, acceptedBy);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, result }));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: msg }));
        }
      });
      return;
    }

    if (url === '/debug/work-reject' && req.method === 'POST') {
      readJsonBody(req, res, payload => {
        const id = payload?.id;
        const rejectedBy = payload?.rejectedBy;
        const reason = typeof payload?.reason === 'string' ? payload.reason : '';
        const principle = typeof payload?.principle === 'string' ? payload.principle : '';
        if (typeof id !== 'string' || !id.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'id is required' }));
          return;
        }
        if (rejectedBy !== 'agent:alois') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'rejectedBy must be agent:alois' }));
          return;
        }
        try {
          const result = rejectWork(id, rejectedBy, reason, principle);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, result }));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: msg }));
        }
      });
      return;
    }

    if (url === '/debug/work-defer' && req.method === 'POST') {
      readJsonBody(req, res, payload => {
        const id = payload?.id;
        const deferredBy = payload?.deferredBy;
        const reason = typeof payload?.reason === 'string' ? payload.reason : '';
        const principle = typeof payload?.principle === 'string' ? payload.principle : '';
        if (typeof id !== 'string' || !id.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'id is required' }));
          return;
        }
        if (deferredBy !== 'agent:alois') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'deferredBy must be agent:alois' }));
          return;
        }
        try {
          const result = deferWork(id, deferredBy, reason, principle);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, result }));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: msg }));
        }
      });
      return;
    }

    if (url === '/debug/work-resolve' && req.method === 'POST') {
      readJsonBody(req, res, payload => {
        const id = typeof payload?.id === 'string' ? payload.id.trim() : '';
        const resolution = typeof payload?.resolution === 'string' ? payload.resolution.trim() : '';
        const resolvedBy = typeof payload?.resolvedBy === 'string' ? payload.resolvedBy : 'agent:alois';
        const note = typeof payload?.note === 'string' ? payload.note : '';
        const targetDocId = typeof payload?.targetDocId === 'string' ? payload.targetDocId.trim() : '';

        if (!id) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'id is required' }));
          return;
        }
        if (!WORK_RESOLUTION_TYPES_SET.has(resolution)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'invalid resolution' }));
          return;
        }
        if (resolvedBy !== 'agent:alois' && resolvedBy !== 'agent:human' && resolvedBy !== 'system') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'resolvedBy must be agent:alois|agent:human|system' }));
          return;
        }

        try {
          const result = resolveWork({
            id,
            resolvedBy,
            resolution: resolution as (typeof WORK_RESOLUTION_TYPES)[number],
            note: note || undefined,
            targetDocId: targetDocId || undefined,
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            id: result.id,
            resolutionEventId: result.resolutionEventId,
            resolution: result.resolution,
            resolvedBy: result.resolvedBy,
          }));
        } catch (err) {
          if (err instanceof WorkResolveError) {
            res.writeHead(err.httpStatus, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              ok: false,
              error: err.code,
              message: err.message,
              ...(err.details || {}),
            }));
            return;
          }
          const msg = err instanceof Error ? err.message : String(err);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: msg }));
        }
      });
      return;
    }

    if (url === '/debug/work-execute' && req.method === 'POST') {
      // Manual verify:
      // 1) execute linkDocs twice -> no duplicate rel edge
      // 2) execute tagDeprecation twice -> one 'deprecated' tag
      // 3) execute done work without token -> alreadyDone:true
      // 4) WORK mode parser handles extra text + JSON object payload
      readJsonBody(req, res, payload => {
        const id = typeof payload?.id === 'string' ? payload.id : '';
        const consentToken = typeof payload?.consentToken === 'string' ? payload.consentToken : '';
        const dryRun = !!payload?.dryRun;
        if (!id.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'id is required' }));
          return;
        }
        try {
          const result = executeWork({ id, consentToken, dryRun, executedBy: 'agent:alois' });
          if (result.alreadyDone) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              ok: true,
              alreadyDone: true,
              id: result.id,
              statusBefore: result.statusBefore,
              statusAfter: result.statusAfter,
              dryRun: result.dryRun,
              applied: result.applied,
              executionEventId: result.executionEventId,
            }));
            return;
          }
          if (result.dryRun) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              ok: true,
              id: result.id,
              statusBefore: result.statusBefore,
              statusAfter: result.statusAfter,
              dryRun: true,
              wouldApply: result.wouldApply || [],
            }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            id: result.id,
            statusBefore: result.statusBefore,
            statusAfter: result.statusAfter,
            dryRun: false,
            applied: result.applied,
            executionEventId: result.executionEventId,
          }));
        } catch (err) {
          if (err instanceof WorkExecutionError) {
            res.writeHead(err.httpStatus, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              ok: false,
              error: err.code,
              message: err.message,
              ...(err.details || {}),
            }));
            return;
          }
          const msg = err instanceof Error ? err.message : String(err);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: msg }));
        }
      });
      return;
    }

    if (url?.startsWith('/debug/work-snippet') && req.method === 'GET') {
      const params = new URLSearchParams(url.split('?')[1] || '');
      const limitRaw = Number(params.get('limit') || '5');
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(25, Math.floor(limitRaw)) : 5;
      const snippet = getWorkSnippet(limit);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(snippet));
      return;
    }

    if (url?.startsWith('/debug/work-queue') && req.method === 'GET') {
      const params = new URLSearchParams(url.split('?')[1] || '');
      const statusesRaw = params.get('status') || 'accepted,proposed';
      const statusTokens = statusesRaw.split(',').map(v => v.trim()).filter(Boolean);
      const invalidStatus = statusTokens.find(v => !(WORK_STATUS_VALUES as readonly string[]).includes(v));
      if (invalidStatus) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: `Invalid status: ${invalidStatus}` }));
        return;
      }
      const statusValues = statusTokens;
      const statusSet = new Set(statusValues.length > 0 ? statusValues : ['accepted', 'proposed']);
      const typesRaw = params.get('type') || '';
      const typeTokens = typesRaw.split(',').map(v => v.trim()).filter(Boolean);
      const invalidType = typeTokens.find(v => !WORK_QUEUE_TYPES_SET.has(v));
      if (invalidType) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: `Invalid type: ${invalidType}` }));
        return;
      }
      const typeValues = typeTokens;
      const typeSet = typeValues.length > 0 ? new Set(typeValues) : null;
      const limitParam = params.get('limit');
      const limitRaw = Number(limitParam);
      if (limitParam !== null && (!Number.isFinite(limitRaw) || limitRaw <= 0)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'limit must be a positive number' }));
        return;
      }
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(500, Math.floor(limitRaw)) : 10;

      const graph = getGraphRef() || communion.getGraph();
      const nodeMap = (graph as unknown as { nodes?: Map<string, any> }).nodes;
      const candidates = nodeMap instanceof Map
        ? Array.from(nodeMap.values())
        : [];

      const statusPriority: Record<string, number> = {
        accepted: 0,
        proposed: 1,
        deferred: 2,
        rejected: 3,
        done: 4,
      };

      const items = candidates
        .filter((n: any) => WORK_QUEUE_TYPES_SET.has(n?.['@type']))
        .filter((n: any) => {
          const st = n?.data?.status;
          return typeof st === 'string' && statusSet.has(st);
        })
        .filter((n: any) => !typeSet || typeSet.has(n?.['@type']))
        .sort((a: any, b: any) => {
          const sa = statusPriority[a?.data?.status] ?? 99;
          const sb = statusPriority[b?.data?.status] ?? 99;
          if (sa !== sb) return sa - sb;
          const pa = Number(a?.data?.priority ?? 0);
          const pb = Number(b?.data?.priority ?? 0);
          if (pa !== pb) return pb - pa;
          const ma = typeof a?.modified === 'string' ? a.modified : '';
          const mb = typeof b?.modified === 'string' ? b.modified : '';
          return mb.localeCompare(ma);
        })
        .slice(0, limit)
        .map((n: any) => {
          const related = Array.isArray(n?.edges?.relatedTo)
            ? n.edges.relatedTo.map((e: any) => e?.target).filter(Boolean)
            : (Array.isArray(n?.relatedTo)
              ? n.relatedTo.map((e: any) => (typeof e === 'string' ? e : e?.['@id'])).filter(Boolean)
              : []);
          return {
            '@id': n?.['@id'],
            '@type': n?.['@type'],
            created: n?.created,
            modified: n?.modified,
            data: n?.data || {},
            relatedTo: Array.from(new Set(related)),
          };
        });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, items }));
      return;
    }

    if (url?.startsWith('/debug/work-history') && req.method === 'GET') {
      const params = new URLSearchParams(url.split('?')[1] || '');
      const id = (params.get('id') || '').trim();
      if (!id) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'id is required' }));
        return;
      }

      const graph = getGraphRef() || communion.getGraph();
      const getNode = (graph as unknown as { getNode?: (uri: string) => any }).getNode;
      const workNode = typeof getNode === 'function' ? getNode.call(graph, id) : undefined;
      if (!workNode) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'work node not found' }));
        return;
      }

      const nodeMap = (graph as unknown as { nodes?: Map<string, any> }).nodes;
      const allNodes = nodeMap instanceof Map ? Array.from(nodeMap.values()) : [];
      const vetoIdsFromWork = extractLinkedIds(workNode, 'hasVeto');
      const fastPathVetoes = vetoIdsFromWork
        .map(vetoId => allNodes.find((n: any) => n?.['@id'] === vetoId))
        .filter(Boolean);
      const vetoCandidates = fastPathVetoes.length > 0
        ? fastPathVetoes
        : allNodes
          .filter((n: any) => n?.['@type'] === 'VetoEvent')
          .filter((n: any) => extractLinkedIds(n, 'reflectsOn').includes(id));

      const vetoes = vetoCandidates
        .sort((a: any, b: any) => {
          const ac = typeof a?.created === 'string' ? a.created : '';
          const bc = typeof b?.created === 'string' ? b.created : '';
          return bc.localeCompare(ac);
        })
        .map((n: any) => ({
          '@id': n?.['@id'],
          '@type': n?.['@type'],
          created: n?.created,
          modified: n?.modified,
          data: n?.data || {},
          reflectsOn: extractLinkedIds(n, 'reflectsOn'),
          relatedTo: extractLinkedIds(n, 'relatedTo'),
        }));

      const resolutionIdsFromWork = extractLinkedIds(workNode, 'resolvedBy');
      const resolutions = resolutionIdsFromWork
        .map(resolutionId => allNodes.find((n: any) => n?.['@id'] === resolutionId))
        .filter((n: any) => n?.['@type'] === 'WorkResolutionEvent')
        .sort((a: any, b: any) => {
          const ac = typeof a?.created === 'string' ? a.created : '';
          const bc = typeof b?.created === 'string' ? b.created : '';
          return bc.localeCompare(ac);
        })
        .map((n: any) => ({
          '@id': n?.['@id'],
          '@type': n?.['@type'],
          created: n?.created,
          modified: n?.modified,
          data: n?.data || {},
          reflectsOn: extractLinkedIds(n, 'reflectsOn'),
          relatedTo: extractLinkedIds(n, 'relatedTo'),
        }));

      const relatedTo = extractLinkedIds(workNode, 'relatedTo');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        work: {
          '@id': workNode?.['@id'],
          '@type': workNode?.['@type'],
          created: workNode?.created,
          modified: workNode?.modified,
          deterministicKey: typeof workNode?.data?.deterministicKey === 'string' ? workNode.data.deterministicKey : '',
          data: workNode?.data || {},
        },
        vetoes,
        resolutions,
        relatedTo,
      }));
      return;
    }

    if (url === '/debug/work-metrics' && req.method === 'GET') {
      const graph = getGraphRef() || communion.getGraph();
      const nodeMap = (graph as unknown as { nodes?: Map<string, any> }).nodes;
      const nodes = nodeMap instanceof Map ? Array.from(nodeMap.values()) : [];

      const countsByStatus: Record<string, number> = {
        proposed: 0,
        accepted: 0,
        deferred: 0,
        rejected: 0,
        done: 0,
      };
      const countsByActionType: Record<string, number> = {
        linkDocs: 0,
        tagDeprecation: 0,
        markDone: 0,
      };
      const resolutionCountByType = Object.fromEntries(
        WORK_RESOLUTION_TYPES.map(resolution => [resolution, 0])
      ) as Record<string, number>;

      let vetoCountTotal = 0;
      let resolutionCountTotal = 0;

      for (const node of nodes) {
        const nodeType = node?.['@type'];

        if (WORK_QUEUE_TYPES_SET.has(nodeType)) {
          const status = typeof node?.data?.status === 'string' ? node.data.status : '';
          if (Object.prototype.hasOwnProperty.call(countsByStatus, status)) countsByStatus[status]++;

          const rawAction = typeof node?.data?.actionType === 'string' ? node.data.actionType : 'markDone';
          const actionType = rawAction === 'linkDocs' || rawAction === 'tagDeprecation' || rawAction === 'markDone'
            ? rawAction
            : 'markDone';
          countsByActionType[actionType]++;
        }

        if (nodeType === 'VetoEvent') {
          vetoCountTotal++;
        } else if (nodeType === 'WorkResolutionEvent') {
          resolutionCountTotal++;
          const resolution = typeof node?.data?.resolution === 'string' ? node.data.resolution : '';
          if (Object.prototype.hasOwnProperty.call(resolutionCountByType, resolution)) {
            resolutionCountByType[resolution]++;
          }
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        countsByStatus,
        countsByActionType,
        dedupeIndex: getWorkDedupeIndexStats(),
        veto: {
          vetoCountTotal,
        },
        resolutions: {
          resolutionCountTotal,
          resolutionCountByType,
        },
      }));
      return;
    }

    if (url === '/debug/veto-count' && req.method === 'GET') {
      const graph = getGraphRef() || communion.getGraph();
      const nodeMap = (graph as unknown as { nodes?: Map<string, any> }).nodes;
      const vetoNodes = nodeMap instanceof Map
        ? Array.from(nodeMap.values()).filter((n: any) => n?.['@type'] === 'VetoEvent')
        : [];

      const sample = vetoNodes.slice(0, 3).map((n: any) => ({
        '@id': n?.['@id'],
        created: n?.created,
        data: {
          action: n?.data?.action,
          principle: n?.data?.principle,
          targetId: n?.data?.targetId,
        },
      }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        vetoCount: vetoNodes.length,
        sample,
      }));
      return;
    }

    // Pause/Resume
    if (url === '/pause' && req.method === 'POST') {
      communion.pause();
      broadcast({ type: 'control', paused: true, tickSpeed: communion.getTickSpeed() });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ paused: true }));
      return;
    }

    if (url === '/resume' && req.method === 'POST') {
      communion.resume();
      broadcast({ type: 'control', paused: false, tickSpeed: communion.getTickSpeed() });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ paused: false }));
      return;
    }

    // Soft-reset live prompt carryover (does NOT touch long-term memory or archive)
    if (url?.startsWith('/reset-carryover') && req.method === 'POST') {
      const params = new URLSearchParams(url.split('?')[1] || '');
      const blackoutTurns = Math.min(10, Math.max(0, Number(params.get('blackout') ?? 4)));
      const cleared = communion.resetLiveCarryover(blackoutTurns);
      broadcast({ type: 'control', liveCarryoverReset: true, cleared });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', cleared }));
      return;
    }

    // Tick speed control
    if (url?.startsWith('/speed') && req.method === 'POST') {
      const speedParams = new URLSearchParams(url.split('?')[1] || '');
      const ms = Number(speedParams.get('ms'));
      if (!ms || ms < 3000 || ms > 1800000) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Provide ?ms=N (3000-1800000)' }));
        return;
      }
      communion.setTickSpeed(ms);
      broadcast({ type: 'control', paused: communion.isPaused(), tickSpeed: communion.getTickSpeed() });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ tickSpeed: communion.getTickSpeed() }));
      return;
    }

    // Control state (GET)
    if (url === '/control') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        paused: communion.isPaused(),
        tickSpeed: communion.getTickSpeed(),
        humanPresence: communion.getHumanPresence(),
      }));
      return;
    }

    // Human presence toggle
    if (url === '/presence' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const { presence } = JSON.parse(body);
          if (presence !== 'here' && presence !== 'away') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'presence must be "here" or "away"' }));
            return;
          }
          communion.setHumanPresence(presence);
          broadcast({ type: 'control', paused: communion.isPaused(), tickSpeed: communion.getTickSpeed(), humanPresence: presence });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ humanPresence: presence }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    // Voice config — set voice for an agent
    if (url === '/voice' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const { agentId, voiceId, enabled } = JSON.parse(body);
          if (!agentId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing agentId' }));
            return;
          }
          communion.setVoiceConfig(agentId, {
            ...(voiceId !== undefined && { voiceId }),
            ...(enabled !== undefined && { enabled }),
          });
          const updated = communion.getVoiceConfig(agentId);
          broadcast({ type: 'voice-config', agentId, ...updated });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(updated));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    // Voice config — get all voice configs
    if (url === '/voice' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        configs: communion.getAllVoiceConfigs(),
        voices: VOICES,
      }));
      return;
    }

    // Custom instructions — set per-agent instructions
    if (url === '/instructions' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const { agentId, instructions } = JSON.parse(body);
          if (!agentId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing agentId' }));
            return;
          }
          communion.setCustomInstructions(agentId, instructions || '');
          broadcast({ type: 'instructions', agentId, instructions: communion.getCustomInstructions(agentId) });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ agentId, instructions: communion.getCustomInstructions(agentId) }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    // Custom instructions — get all
    if (url === '/instructions' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(communion.getAllCustomInstructions()));
      return;
    }

    // Per-agent clock — set tick multiplier
    if (url === '/agent-clock' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const { agentId, tickEveryN } = JSON.parse(body);
          if (!agentId || typeof tickEveryN !== 'number') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing agentId or tickEveryN' }));
            return;
          }
          communion.setAgentClock(agentId, tickEveryN);
          broadcast({ type: 'agent-clock', agentId, tickEveryN: communion.getAgentClock(agentId) });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ agentId, tickEveryN: communion.getAgentClock(agentId) }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    // Per-agent clocks — get all
    if (url === '/agent-clock' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(communion.getAllAgentClocks()));
      return;
    }

    // ── Dynamic Agent Management ──

    // Add agent
    if (url === '/agents/add' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const agentConfig = JSON.parse(body) as AgentConfig;
          const isBrainLocal = agentConfig.provider === 'brain-local';
          const missingCore = !agentConfig.id || !agentConfig.name || !agentConfig.provider;
          const missingBrainLocal =
            isBrainLocal && (!agentConfig.languageModel || !agentConfig.routerModel);
          const missingStandard =
            !isBrainLocal && (!agentConfig.apiKey || !agentConfig.model);

          if (missingCore || missingBrainLocal || missingStandard) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: isBrainLocal
                ? 'Missing required fields: id, name, provider, languageModel, routerModel'
                : 'Missing required fields: id, name, provider, apiKey, model',
            }));
            return;
          }
          // Sanitize id: lowercase, no spaces
          agentConfig.id = agentConfig.id.toLowerCase().replace(/[^a-z0-9-_]/g, '');
          if (!agentConfig.id) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid agent ID' }));
            return;
          }

          const success = communion.addAgent(agentConfig);
          if (!success) {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Agent "${agentConfig.id}" already exists` }));
            return;
          }

          // Broadcast full config refresh so all clients rebuild layout
          const st1 = communion.getState();
          const ap1: Record<string, string> = {};
          for (const c of communion.getAgentConfigs()) ap1[c.id] = c.provider;
          broadcast({
            type: 'config',
            agentIds: st1.agentIds,
            agentNames: st1.agentNames,
            agentColors: st1.agentColors,
            agentProviders: ap1,
            humanName: st1.humanName,
            voiceConfigs: communion.getAllVoiceConfigs(),
            voices: VOICES,
            agentClocks: communion.getAllAgentClocks(),
            customInstructions: communion.getAllCustomInstructions(),
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'added', agentId: agentConfig.id }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    // Remove agent
    if (url?.startsWith('/agents/remove') && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const { agentId } = JSON.parse(body);
          if (!agentId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing agentId' }));
            return;
          }

          const success = communion.removeAgent(agentId);
          if (!success) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Agent "${agentId}" not found` }));
            return;
          }

          // Broadcast full config refresh
          const st2 = communion.getState();
          const ap2: Record<string, string> = {};
          for (const c of communion.getAgentConfigs()) ap2[c.id] = c.provider;
          broadcast({
            type: 'config',
            agentIds: st2.agentIds,
            agentNames: st2.agentNames,
            agentColors: st2.agentColors,
            agentProviders: ap2,
            humanName: st2.humanName,
            voiceConfigs: communion.getAllVoiceConfigs(),
            voices: VOICES,
            agentClocks: communion.getAllAgentClocks(),
            customInstructions: communion.getAllCustomInstructions(),
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'removed', agentId }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    // List agents
    if (url === '/agents' && req.method === 'GET') {
      const configs = communion.getAgentConfigs();
      // Strip API keys from response
      const safe = configs.map(c => ({
        id: c.id,
        name: c.name,
        provider: c.provider,
        model: c.model,
        baseUrl: c.baseUrl,
        color: c.color,
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(safe));
      return;
    }

    // List inactive (removed) agents available for restoration
    if (url === '/agents/inactive' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(communion.getInactiveAgents()));
      return;
    }

    // Restore a previously removed agent
    if (url === '/agents/restore' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const { agentId } = JSON.parse(body);
          if (!agentId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing agentId' }));
            return;
          }

          const success = communion.restoreAgent(agentId);
          if (!success) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Could not restore agent "${agentId}"` }));
            return;
          }

          // Broadcast full config refresh
          const st3 = communion.getState();
          const ap3: Record<string, string> = {};
          for (const c of communion.getAgentConfigs()) ap3[c.id] = c.provider;
          broadcast({
            type: 'config',
            agentIds: st3.agentIds,
            agentNames: st3.agentNames,
            agentColors: st3.agentColors,
            agentProviders: ap3,
            humanName: st3.humanName,
            voiceConfigs: communion.getAllVoiceConfigs(),
            voices: VOICES,
            agentClocks: communion.getAllAgentClocks(),
            customInstructions: communion.getAllCustomInstructions(),
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'restored', agentId }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    // LM Studio model detection proxy — browser can't fetch localhost:1234 directly
    if (url === '/brain-local/models' && req.method === 'POST') {
      readJsonBody(req, res, async payload => {
        try {
          const role = payload?.role === 'router' || payload?.role === 'language'
            ? payload.role
            : undefined;
          const models = await brainModelCatalog.list(role);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            models: models.map(model => ({
              id: model.id,
              label: model.label,
              role: model.role,
              source: model.source,
              backend: model.backend,
              installed: model.installed,
              localPath: model.localPath,
            })),
          }));
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(error) }));
        }
      });
      return;
    }

    if (url?.startsWith('/brain-local/status') && req.method === 'GET') {
      try {
        const parsed = new URL(req.url || '/brain-local/status', 'http://localhost');
        const agentId = parsed.searchParams.get('agentId') || '';
        if (!agentId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing agentId' }));
          return;
        }
        const config = communion.getAgentConfigs().find(agentConfig => agentConfig.id === agentId);
        const isAloisProvider = config && (config.provider === 'brain-local' || (config.provider === 'openai-compatible' && config.id.startsWith('alois')));
        if (!config || !isAloisProvider) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Agent not found or not a brain-local agent' }));
          return;
        }
        const backend = communion.getAgentBackend(agentId) as any;
        const fallbackStatus = {
          provider: 'brain-local',
          agentId,
          router: {
            modelId: config.routerModel || 'unconfigured',
            source: config.routerModelSource || 'local',
            backend: config.routerModelBackend || 'unknown',
            localPath: config.routerModelPath || null,
            runtimeActive: false,
            runtimeBaseUrl: null,
          },
          language: {
            modelId: config.languageModel || config.model || 'unconfigured',
            source: config.languageModelSource || 'local',
            backend: config.languageModelBackend || 'unknown',
            localPath: config.languageModelPath || null,
            runtimeActive: false,
            runtimeBaseUrl: null,
          },
        };
        const writeStatus = (status: unknown) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(status));
        };
        if (typeof backend?.getStatus === 'function') {
          Promise.resolve(backend.getStatus())
            .then(writeStatus)
            .catch(error => {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: String(error) }));
            });
          return;
        }
        writeStatus(fallbackStatus);
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(error) }));
      }
      return;
    }

    if (url === '/brain-local/huggingface/search' && req.method === 'POST') {
      readJsonBody(req, res, async payload => {
        try {
          const query = typeof payload?.query === 'string' ? payload.query.trim() : '';
          if (!query) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing query' }));
            return;
          }
          const models = await huggingFaceRegistry.search(query);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ models }));
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(error) }));
        }
      });
      return;
    }

    if (url === '/brain-local/install' && req.method === 'POST') {
      readJsonBody(req, res, async payload => {
        try {
          const source = payload?.source;
          const id = typeof payload?.id === 'string' ? payload.id.trim() : '';
          if (!id || (source !== 'local' && source !== 'huggingface')) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing or invalid install payload' }));
            return;
          }

          const job = createBrainInstallJob();
          job.status = 'running';
          job.controller = new AbortController();
          job.progress.message = 'Starting install';
          job.updatedAt = Date.now();

          void brainModelInstaller.installWithProgress({
            id,
            source,
            remoteId: typeof payload?.remoteId === 'string' ? payload.remoteId.trim() : undefined,
            localPath: typeof payload?.localPath === 'string' ? payload.localPath.trim() : undefined,
            fileName: typeof payload?.fileName === 'string' ? payload.fileName.trim() : undefined,
            signal: job.controller.signal,
          }, progress => {
            job.progress = {
              ...progress,
              message: progress.phase === 'downloading'
                ? 'Downloading model'
                : progress.phase === 'copying'
                  ? 'Copying model'
                  : progress.phase === 'complete'
                    ? 'Install complete'
                    : 'Preparing model',
            };
            job.updatedAt = Date.now();
          }).then(result => {
            job.status = 'complete';
            job.controller = undefined;
            job.result = result;
            job.progress = {
              ...job.progress,
              phase: 'complete',
              message: 'Install complete',
            };
            job.updatedAt = Date.now();
          }).catch(error => {
            const message = String(error);
            if (message.includes('install_cancelled') || job.controller?.signal.aborted) {
              job.status = 'cancelled';
              job.error = 'cancelled';
              job.progress = {
                ...job.progress,
                phase: 'error',
                message: 'Install cancelled',
              };
            } else {
              job.status = 'error';
              job.error = message;
              job.progress = {
                ...job.progress,
                phase: 'error',
                message,
              };
            }
            job.controller = undefined;
            job.updatedAt = Date.now();
          });

          res.writeHead(202, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, jobId: job.id }));
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(error) }));
        }
      });
      return;
    }

    if (url === '/brain-local/install/status' && req.method === 'POST') {
      readJsonBody(req, res, payload => {
        const jobId = typeof payload?.jobId === 'string' ? payload.jobId.trim() : '';
        const job = brainInstallJobs.get(jobId);
        if (!job) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Install job not found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jobId: job.id,
          status: job.status,
          progress: job.progress,
          result: job.result,
          error: job.error,
        }));
      });
      return;
    }

    if (url === '/brain-local/install/cancel' && req.method === 'POST') {
      readJsonBody(req, res, payload => {
        const jobId = typeof payload?.jobId === 'string' ? payload.jobId.trim() : '';
        const job = brainInstallJobs.get(jobId);
        if (!job) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Install job not found' }));
          return;
        }
        if (job.status !== 'running' || !job.controller) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Install job is not running' }));
          return;
        }
        job.controller.abort();
        job.status = 'cancelled';
        job.error = 'cancelled';
        job.progress = {
          ...job.progress,
          phase: 'error',
          message: 'Install cancelled',
        };
        job.updatedAt = Date.now();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, jobId: job.id, status: job.status }));
      });
      return;
    }

    if (url === '/lmstudio/models' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', async () => {
        try {
          const { baseUrl } = JSON.parse(body);
          if (!baseUrl) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing baseUrl' }));
            return;
          }

          const modelsUrl = baseUrl.replace(/\/+$/, '') + '/models';
          console.log(`[LM STUDIO] Detecting models at ${modelsUrl}`);

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5000);

          const resp = await fetch(modelsUrl, {
            headers: { 'Authorization': 'Bearer lm-studio' },
            signal: controller.signal,
          });
          clearTimeout(timeout);

          if (!resp.ok) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `LM Studio returned ${resp.status}` }));
            return;
          }

          const data = (await resp.json()) as any;
          console.log(`[LM STUDIO] Raw response keys: ${Object.keys(data).join(', ')}`, JSON.stringify(data).substring(0, 500));

          // Handle multiple response formats:
          // Standard OpenAI: { data: [{ id: "..." }] }
          // Some LM Studio versions: { models: [{ id: "..." }] }
          // Array directly: [{ id: "..." }]
          // Single model: { id: "..." }
          let modelList: any[] = [];
          if (Array.isArray(data.data)) {
            modelList = data.data;
          } else if (Array.isArray(data.models)) {
            modelList = data.models;
          } else if (Array.isArray(data)) {
            modelList = data;
          } else if (data.id) {
            modelList = [data];
          }

          const models = modelList
            .map((m: any) => ({ id: m.id || m.name || m.model || String(m) }))
            .filter((m: any) => m.id && m.id !== 'undefined');
          console.log(`[LM STUDIO] Found ${models.length} model(s): ${models.map((m: any) => m.id).join(', ')}`);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ models, rawKeys: Object.keys(data) }));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error('[LM STUDIO] Model detection error:', msg);
          const userMsg = msg.includes('abort') ? 'Connection timed out (5s) — is LM Studio running?'
            : msg.includes('ECONNREFUSED') ? 'Connection refused — LM Studio is not running at this address'
            : msg.includes('ENOTFOUND') ? 'Host not found — check the URL'
            : msg;
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: userMsg }));
        }
      });
      return;
    }

    // ── Alois Dream API ──

    // Trigger a dream cycle for an Alois agent
    if (url === '/alois/dream' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const { agentId } = JSON.parse(body);
          const agent = communion.getAgentBackend(agentId);
          if (!agent || !('triggerDream' in agent)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Agent not found or not an Alois agent' }));
            return;
          }
          const result = (agent as any).triggerDream();
          // Broadcast dream journal as a journal entry
          broadcast({
            type: 'journal-entry',
            message: {
              id: `dream-${Date.now()}`,
              speaker: agentId,
              speakerName: 'Alois (Dream)',
              text: result.journal,
              timestamp: result.timestamp,
              type: 'journal',
            },
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
      return;
    }

    // Get dream history for an Alois agent
    if (url?.startsWith('/alois/dreams') && req.method === 'GET') {
      const params = new URL(req.url || '', `http://localhost`).searchParams;
      const agentId = params.get('agentId');
      if (!agentId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing agentId parameter' }));
        return;
      }
      const agent = communion.getAgentBackend(agentId);
      if (!agent || !('getDreamHistory' in agent)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Agent not found or not an Alois agent' }));
        return;
      }
      const history = (agent as any).getDreamHistory();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ dreams: history }));
      return;
    }

    // Get tissue state + neuron scores for an Alois agent
    if (url?.startsWith('/alois/tissue') && req.method === 'GET') {
      const params = new URL(req.url || '', `http://localhost`).searchParams;
      const agentId = params.get('agentId');
      if (!agentId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing agentId parameter' }));
        return;
      }
      const agent = communion.getAgentBackend(agentId);
      if (!agent || !('getTissueState' in agent)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        const reason = !agent ? 'agent_not_found' : 'not_alois_agent';
        console.warn(`[TISSUE] ${agentId}: ${reason} (agents=${[...communion.getAgentConfigs().map(c=>c.id)].join(',')})`);
        res.end(JSON.stringify({ error: 'Agent not found or not an Alois agent', reason }));
        return;
      }
      try {
        const state = (agent as any).getTissueState();
        const ingestStatus = communion.getIngestStatus();
        // ?full=true — only compute expensive neuron scores + axon topology for brain viz.
        // The sidebar brain monitor polls every 2s and only needs `state` — skip the heavy stuff.
        const full = params.get('full') === 'true';
        const neurons     = full ? ((agent as any).getNeuronScores?.() || [])   : [];
        const edges       = full ? ((agent as any).getChamber?.()?.getGraph?.()?.getAxonTopology?.() || []) : [];
        const lastDream   = full ? ((agent as any).getLastDream?.()  || null)  : null;
        const tissueWeight = (agent as any).getTissueWeight?.() || 0;
        const incubation  = full ? (((agent as any).getIncubation?.() || (agent as any).evaluateIncubation?.()) || null)  : null;
        const brainMetrics= full ? (((agent as any).getBrainMetrics?.() || {
          neuronCount: state?.neuronCount || neurons.length || 0,
          axonCount: state?.axonCount || edges.length || 0,
          utteranceCount: state?.utteranceCount || 0,
          spineDensity: 0,
          resonanceDepth: 0,
          dreamCount: Array.isArray(lastDream) ? lastDream.length : (lastDream ? 1 : 0),
          tick: state?.tick || 0,
        })) : null;
        const autoGradient = (agent as any).isAutoGradient?.() ?? true;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ state, neurons, edges, lastDream, tissueWeight, incubation, brainMetrics, autoGradient, ingestStatus }));
      } catch (tissueErr) {
        console.error('[TISSUE] getTissueState threw:', tissueErr);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'tissue_state_error', message: String(tissueErr) }));
        }
      }
      return;
    }

    // Get archive ingest progress (for brain monitor progress bar)
    if (url === '/alois/ingest' && req.method === 'GET') {
      const status = communion.getIngestStatus();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status }));
      return;
    }

    // Set tissueWeight or auto-gradient for an Alois agent
    if (url === '/alois/settings' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const { agentId, tissueWeight, autoGradient } = JSON.parse(body);
          const agent = communion.getAgentBackend(agentId);
          if (!agent || !('setTissueWeight' in agent)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Agent not found or not an Alois agent' }));
            return;
          }
          if (typeof tissueWeight === 'number') {
            (agent as any).setTissueWeight(tissueWeight);
            console.log(`[ALOIS] Tissue weight manually set to ${tissueWeight} for ${agentId}`);
          }
          if (typeof autoGradient === 'boolean') {
            (agent as any).setAutoGradient(autoGradient);
            console.log(`[ALOIS] Auto-gradient ${autoGradient ? 'enabled' : 'disabled'} for ${agentId}`);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            tissueWeight: (agent as any).getTissueWeight(),
            autoGradient: (agent as any).isAutoGradient(),
          }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
      return;
    }

    // Mic state — client signals human is speaking into mic
    if (url === '/mic' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: string) => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const { active } = JSON.parse(body);
          communion.setHumanSpeaking(!!active);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ micActive: !!active }));
        } catch {
          res.writeHead(400);
          res.end('Bad request');
        }
      });
      return;
    }

    // Speaking status — used by Whisper STT bridge to avoid picking up TTS output
    if (url === '/speaking' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ speaking: communion.isSpeaking() }));
      return;
    }

    // Speech done — client reports audio playback finished
    if (url === '/speech-done' && req.method === 'POST') {
      readJsonBody(req, res, payload => {
        const requestId = typeof payload?.requestId === 'string' ? payload.requestId : undefined;
        const reportSpeechComplete = (communion as any).reportSpeechComplete;
        if (typeof reportSpeechComplete === 'function') {
          reportSpeechComplete.call(communion, requestId);
        } else {
          communion.reportSpeechComplete();
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ speaking: false }));
      });
      return;
    }

    if (url === '/speech-status' && req.method === 'POST') {
      readJsonBody(req, res, payload => {
        const agentId = typeof payload?.agentId === 'string' ? payload.agentId : null;
        const status = payload?.status;
        if (!agentId || !['queued', 'started', 'finished', 'failed'].includes(status)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'invalid_speech_status' }));
          return;
        }
        const reportSpeechStatus = (communion as any).reportSpeechStatus;
        if (typeof reportSpeechStatus === 'function') {
          reportSpeechStatus.call(
            communion,
            agentId,
            status,
            typeof payload?.error === 'string' ? payload.error : undefined,
            typeof payload?.requestId === 'string' ? payload.requestId : undefined,
          );
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    // Graph stats
    if (url === '/graph/stats') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(communion.getGraph().getStats()));
      return;
    }

    // Full graph as JSON-LD
    if (url === '/graph') {
      res.writeHead(200, {
        'Content-Type': 'application/ld+json',
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify(communion.getGraph().toJsonLd(), null, 2));
      return;
    }

    // Graph node lookup (e.g. /graph/node/scroll:abc-123)
    if (url?.startsWith('/graph/node/')) {
      const nodeUri = decodeURIComponent(url.slice('/graph/node/'.length));
      const node = communion.getGraph().getNode(nodeUri);
      if (node) {
        res.writeHead(200, { 'Content-Type': 'application/ld+json' });
        res.end(JSON.stringify(node, null, 2));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Node not found: ${nodeUri}` }));
      }
      return;
    }

    // Graph neighbors (e.g. /graph/neighbors/scroll:abc-123)
    if (url?.startsWith('/graph/neighbors/')) {
      const nodeUri = decodeURIComponent(url.slice('/graph/neighbors/'.length));
      const neighbors = communion.getGraph().neighbors(nodeUri);
      res.writeHead(200, { 'Content-Type': 'application/ld+json' });
      res.end(JSON.stringify(neighbors.map(n => ({
        '@type': n['@type'],
        '@id': n['@id'],
        created: n.created,
        edgeCount: Object.values(n.edges).reduce((s, e) => s + e.length, 0),
        data: n.data,
      })), null, 2));
      return;
    }

    // Graph traverse (e.g. /graph/traverse/scroll:abc-123?depth=2&type=JournalEntry)
    if (url?.startsWith('/graph/traverse/')) {
      const parts = url.slice('/graph/traverse/'.length).split('?');
      const nodeUri = decodeURIComponent(parts[0]);
      const params = new URLSearchParams(parts[1] || '');
      const traversed = communion.getGraph().traverse(nodeUri, {
        maxDepth: Number(params.get('depth')) || 3,
        filterType: (params.get('type') as any) || undefined,
        maxResults: Number(params.get('limit')) || 50,
      });
      res.writeHead(200, { 'Content-Type': 'application/ld+json' });
      res.end(JSON.stringify(traversed.map(t => ({
        '@type': t.node['@type'],
        '@id': t.node['@id'],
        depth: t.depth,
        path: t.path,
        data: t.node.data,
      })), null, 2));
      return;
    }

    // Import chat history — server reads file directly from local disk path
    if (url === '/import' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const source = parsed.source;
          const filePath = (parsed.filePath || '').replace(/^["']+|["']+$/g, '').trim();
          if (!source || !filePath) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing "source" or "filePath"' }));
            return;
          }
          if (!existsSync(filePath)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `File not found: ${filePath}` }));
            return;
          }
          console.log(`[IMPORT] source=${source}, file=${filePath} (${(statSync(filePath).size / 1024 / 1024).toFixed(1)}MB)`);
          handleImportFile(filePath, source, config, res).catch((e) => {
            console.error('[IMPORT] Error:', e);
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
            }
          });
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        }
      });
      return;
    }

    // Mycelium cabinet saturation endpoint — Pi polls this to drive the lobe.
    // Cached for 2s to avoid recomputing getNeuronScores() on every concurrent poll.
    if (url?.startsWith('/pond-saturation') && req.method === 'GET') {
      const parsed = new URL(req.url || '/pond-saturation', 'http://localhost');
      const agentId = parsed.searchParams.get('agentId') || '';
      if (agentId) {
        const agent = communion.getAgentBackend(agentId) as any;
        const payload = agent && typeof agent.getSaturationPayload === 'function'
          ? agent.getSaturationPayload()
          : null;
        if (!payload) {
          res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'Agent has no mycelium payload' }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify(payload));
        }
      } else {
        const now = Date.now();
        if (!pondCache.payload || (now - pondCache.ts) > 2000) {
          pondCache.payload = communion.getAloisSaturation();
          pondCache.ts = now;
        }
        if (!pondCache.payload) {
          res.writeHead(503, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'No brain agent active' }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify(pondCache.payload));
        }
      }
      return;
    }

    // ── Sample pack manifest ──
    // Returns { kick: 'kick_01.wav', snare: 'snare_03.wav', ... } for all tracks that have a file.
    // Auto-sorts by filename prefix. Drop files into data/samples/ and this updates live.
    if (url === '/samples' && req.method === 'GET') {
      const samplesDir = join(__dirname, '../data/samples');
      if (!existsSync(samplesDir)) mkdirSync(samplesDir, { recursive: true });

      const AUDIO_EXTS = new Set(['.wav', '.mp3', '.ogg', '.flac', '.aif', '.aiff']);
      // Patterns matched against BOTH the filename basename AND the parent folder name.
      // This handles packs like "Unison Beatmaker Blueprint/Kicks/UNISON_KICK_Aim.wav"
      // where the filename doesn't start with the track type but the folder name does.
      const TRACK_PATTERNS: Record<string, RegExp[]> = {
        kick:   [/kick/i,   /^bd[_\-]/i, /bass.drum/i],
        sub:    [/\bsub\b/i, /subbass/i, /\b808\b/i],
        snare:  [/snare/i,  /^sd[_\-]/i, /\bsnr\b/i],
        clap:   [/clap/i,   /^cp[_\-]/i, /\bsnap/i],
        hihatC: [/closed.hat/i, /\bchh\b/i, /^ch[_\-]/i, /closed.hi/i, /closed$/i],
        hihatO: [/open.hat/i,   /\bohh\b/i, /^oh[_\-]/i, /open.hi/i,   /open$/i],
        ride:   [/\bride\b/i, /^rd[_\-]/i, /cymbal/i],
        perc:   [/\bperc/i, /^pc[_\-]/i, /\btom\b/i, /conga/i, /bongo/i, /rim.shot/i, /foley/i],
        atmos:  [/\batmos\b/i, /\bambient\b/i, /\bambience\b/i, /\btexture\b/i, /\bdrone\b/i],
        nature: [/\bnature\b/i, /\brain\b/i, /\bwind\b/i, /\bforest\b/i, /\bwater\b/i, /\bbirds?\b/i],
        // Lead palette slots (dashboard expects these exact manifest keys).
        lead_vocal_01: [/\blead[_\- ]vocal[_\- ]01\b/i],
        lead_vocal_02: [/\blead[_\- ]vocal[_\- ]02\b/i],
        lead_vocal_03: [/\blead[_\- ]vocal[_\- ]03\b/i],
        lead_guitar_01:[/\blead[_\- ]guitar[_\- ]01\b/i],
        lead_guitar_02:[/\blead[_\- ]guitar[_\- ]02\b/i],
        lead_guitar_03:[/\blead[_\- ]guitar[_\- ]03\b/i],
        lead_keys_01:  [/\blead[_\- ]keys[_\- ]01\b/i],
        lead_keys_02:  [/\blead[_\- ]keys[_\- ]02\b/i],
        lead_keys_03:  [/\blead[_\- ]keys[_\- ]03\b/i],
      };

      // Recursive scan — returns relative paths like "Kicks/kick_01.wav"
      let files: string[] = [];
      try { files = readdirSync(samplesDir, { recursive: true }) as string[]; } catch {}

      // Parse pitch letter from filename convention: "(C)", "(F#)", "(Bb)" etc.
      const NOTE_SEMI: Record<string, number> = {
        'C':0,'C#':1,'Db':1,'D':2,'D#':3,'Eb':3,'E':4,'F':5,
        'F#':6,'Gb':6,'G':7,'G#':8,'Ab':8,'A':9,'A#':10,'Bb':10,'B':11,
      };
      function parseSemitone(name: string): number | null {
        const m = name.match(/\(([A-G][#b]?)\)/i);
        if (!m) return null;
        const raw = m[1];
        const norm = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
        return NOTE_SEMI[norm] ?? null;
      }

      // Loops and shots preference
      const LOOP_RE = /\bloop[s]?\b|\b\d+[\s_\-]?bpm\b|\b\d+[\s_\-]?bar[s]?\b/i;
      const SHOT_RE = /\bshot[s]?\b|\bone[\s._\-]?shot[s]?\b/i;
      type Candidate = { path: string; isShot: boolean; isLoop: boolean };
      const candidates: Record<string, Candidate[]> = {};
      for (const track of Object.keys(TRACK_PATTERNS)) candidates[track] = [];

      for (const relPath of files) {
        const parts    = relPath.replace(/\\/g, '/').split('/');
        const basename = parts[parts.length - 1] || '';
        const folder   = parts.length >= 2 ? parts[parts.length - 2] : '';
        const ext = basename.slice(basename.lastIndexOf('.')).toLowerCase();
        if (!AUDIO_EXTS.has(ext)) continue;
        const normalRel = relPath.replace(/\\/g, '/');
        const isLoop = LOOP_RE.test(basename) || LOOP_RE.test(folder);
        const isShot = SHOT_RE.test(basename) || SHOT_RE.test(folder);
        for (const [track, patterns] of Object.entries(TRACK_PATTERNS)) {
          if (patterns.some(p => p.test(basename) || p.test(folder))) {
            candidates[track].push({ path: normalRel, isShot, isLoop });
          }
        }
      }

      // Return ALL candidates per track as an array (shots first, loops last)
      // so the client can rotate through them without repeating.
      const manifest: Record<string, { file: string; semitone: number | null; isLoop: boolean }[]> = {};
      for (const [track, cands] of Object.entries(candidates)) {
        if (cands.length === 0) continue;
        cands.sort((a, b) => {
          if (a.isShot !== b.isShot) return a.isShot ? -1 : 1;
          if (a.isLoop !== b.isLoop) return a.isLoop ? 1 : -1;
          return a.path.localeCompare(b.path);
        });
        manifest[track] = cands.map(c => {
          const fname = c.path.split('/').pop() ?? '';
          return { file: c.path, semitone: parseSemitone(fname), isLoop: c.isLoop };
        });
      }

      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify(manifest));
      return;
    }

    // ── Serve individual sample files ──
    if (url?.startsWith('/sample-files/') && req.method === 'GET') {
      const relPath = decodeURIComponent(url.slice('/sample-files/'.length));
      // Security: normalize and reject any path traversal outside samples dir
      const samplesBase = join(__dirname, '../data/samples');
      const filePath = join(samplesBase, relPath);
      if (!filePath.startsWith(samplesBase + '/') && !filePath.startsWith(samplesBase + '\\') && filePath !== samplesBase) {
        res.writeHead(400); res.end('Bad request'); return;
      }
      const filename = relPath;
      if (!existsSync(filePath)) {
        res.writeHead(404); res.end('Not found'); return;
      }
      const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
      const MIME: Record<string, string> = {
        '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
        '.flac': 'audio/flac', '.aif': 'audio/aiff', '.aiff': 'audio/aiff',
      };
      const size = statSync(filePath).size;
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': size,
        'Cache-Control': 'public, max-age=3600',
      });
      createReadStream(filePath).pipe(res);
      return;
    }

    // ── Document Workspace API ──────────────────────────────────────────────────

    const method = req.method || 'GET';
    const pathname = url.split('?')[0];
    const urlSearchParams = new URLSearchParams(url.split('?')[1] || '');

    if (pathname === '/docs/status' && method === 'GET') {
      const status = workspace.index.getStatus();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
      return;
    }

    if (pathname === '/docs/files' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(workspace.index.getAllDocuments()));
      return;
    }

    if (pathname === '/docs/search' && method === 'POST') {
      readJsonBody(req, res, (body: SearchQuery) => {
        if (!body.text) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'text required' }));
          return;
        }
        const results = workspace.search(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(results));
      });
      return;
    }

    if (pathname === '/docs/pack/build' && method === 'POST') {
      readJsonBody(req, res, (body: any) => {
        const pack = workspace.buildPack({
          selectedChunkIds: body.selectedChunkIds || [],
          pinnedChunkIds: body.pinnedChunkIds || [],
          lockedChunkIds: body.lockedChunkIds || [],
          budget: body.budget || 4000,
          sessionId: body.sessionId,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(pack));
      });
      return;
    }

    if (pathname === '/docs/pack/estimate' && method === 'POST') {
      readJsonBody(req, res, (body: any) => {
        const tokens = workspace.estimateTokens(body.chunkIds || []);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ tokens }));
      });
      return;
    }

    if (pathname === '/docs/highlight' && method === 'POST') {
      readJsonBody(req, res, (body: any) => {
        const { chunkId, highlight } = body as { chunkId: string; highlight: ChunkHighlight };
        if (!chunkId || !highlight) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'chunkId and highlight required' }));
          return;
        }
        const ok = workspace.index.addHighlight(chunkId, highlight);
        res.writeHead(ok ? 200 : 404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok }));
      });
      return;
    }

    if (pathname === '/docs/highlight' && method === 'DELETE') {
      readJsonBody(req, res, (body: any) => {
        const { chunkId, highlightId } = body as { chunkId: string; highlightId: string };
        const ok = workspace.index.removeHighlight(chunkId, highlightId);
        res.writeHead(ok ? 200 : 404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok }));
      });
      return;
    }

    if (pathname === '/docs/review' && method === 'POST') {
      readJsonBody(req, res, (body: any) => {
        const session = workspace.reviewStore.createSession(body.fileId || null);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(session));
      });
      return;
    }

    if (pathname === '/docs/workspace/refresh' && method === 'POST') {
      workspace.refresh().then(result => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      }).catch(err => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(err) }));
      });
      return;
    }

    // /docs/file/:docId/map  — docId is URL-encoded
    const docMapMatch = pathname.match(/^\/docs\/file\/(.+)\/map$/);
    if (docMapMatch && method === 'GET') {
      const docId = decodeURIComponent(docMapMatch[1]);
      const docMap = workspace.index.getMap(docId);
      if (!docMap) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Not found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(docMap));
      return;
    }

    // /docs/file/:docId/chunks
    const docChunksMatch = pathname.match(/^\/docs\/file\/(.+)\/chunks$/);
    if (docChunksMatch && method === 'GET') {
      const docId = decodeURIComponent(docChunksMatch[1]);
      const chunks = workspace.index.getChunksForDoc(docId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(chunks));
      return;
    }

    // /docs/chunk/:chunkId/neighbors?radius=N
    const chunkNeighborMatch = pathname.match(/^\/docs\/chunk\/(.+)\/neighbors$/);
    if (chunkNeighborMatch && method === 'GET') {
      const chunkId = decodeURIComponent(chunkNeighborMatch[1]);
      const radius = parseInt(urlSearchParams.get('radius') || '2', 10) || 2;
      const neighbors = workspace.index.getNeighbors(chunkId, radius);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(neighbors));
      return;
    }

    // /docs/chunk/:chunkId
    const chunkMatch = pathname.match(/^\/docs\/chunk\/(.+)$/);
    if (chunkMatch && method === 'GET') {
      const chunkId = decodeURIComponent(chunkMatch[1]);
      const chunk = workspace.index.getChunk(chunkId);
      if (!chunk) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Not found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(chunk));
      return;
    }

    // /docs/review/:sessionId — GET or PATCH
    const reviewMatch = pathname.match(/^\/docs\/review\/(.+)$/);
    if (reviewMatch) {
      const sessionId = decodeURIComponent(reviewMatch[1]);
      if (method === 'GET') {
        const session = workspace.reviewStore.getSession(sessionId);
        if (!session) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Not found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(session));
        return;
      }
      if (method === 'PATCH') {
        readJsonBody(req, res, (body: Partial<ReviewSession>) => {
          const updated = workspace.reviewStore.updateSession(sessionId, body);
          if (!updated) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Not found' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(updated));
        });
        return;
      }
    }

    // ── End Document Workspace API ──────────────────────────────────────────────

    // ── Council API ──────────────────────────────────────────────────────────────

    if (url.startsWith('/council')) {
      // CORS headers for council routes
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'application/json');

      // Wrap in async IIFE — the outer createServer callback is synchronous
      (async () => {
      const readBody = (): Promise<string> => new Promise((resolve) => {
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => resolve(body));
      });

      // POST /council/configure — wizard saves config
      if (url === '/council/configure' && req.method === 'POST') {
        const body = await readBody();
        try {
          const incoming = JSON.parse(body);
          councilOrchestrator.saveConfig(incoming);
          res.writeHead(200); res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.writeHead(400); res.end(JSON.stringify({ ok: false, error: String(err) }));
        }
        return;
      }

      // GET /council/config — current config (apiKey masked)
      if (url === '/council/config' && req.method === 'GET') {
        const cfg = councilOrchestrator.getConfig();
        if (!cfg) { res.writeHead(404); res.end(JSON.stringify({ error: 'Not configured' })); return; }
        const masked = { ...cfg, apiKey: cfg.apiKey ? '***' : '' };
        res.writeHead(200); res.end(JSON.stringify(masked));
        return;
      }

      // GET /council/config/defaults — default config for wizard pre-fill
      if (url === '/council/config/defaults' && req.method === 'GET') {
        try {
          const defaultCfgPath = join(__dirname, 'council', 'council.config.default.json');
          const defaults = existsSync(defaultCfgPath)
            ? JSON.parse(readFileSync(defaultCfgPath, 'utf-8'))
            : {};
          res.writeHead(200); res.end(JSON.stringify(defaults));
        } catch (err) {
          res.writeHead(500); res.end(JSON.stringify({ error: String(err) }));
        }
        return;
      }

      // GET /council/configured — quick boolean check
      if (url === '/council/configured' && req.method === 'GET') {
        res.writeHead(200); res.end(JSON.stringify({ configured: councilOrchestrator.isConfigured() }));
        return;
      }

      // POST /council/start — SIP → start session
      if (url === '/council/start' && req.method === 'POST') {
        const body = await readBody();
        try {
          const sip = JSON.parse(body);
          const result = await councilOrchestrator.startSession(sip);
          res.writeHead(result.ok ? 200 : 400); res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(400); res.end(JSON.stringify({ ok: false, error: String(err) }));
        }
        return;
      }

      // GET /council/status — session state + timerRemaining
      if (url === '/council/status' && req.method === 'GET') {
        res.writeHead(200); res.end(JSON.stringify(councilOrchestrator.getStatus()));
        return;
      }

      // POST /council/message — human turn
      if (url === '/council/message' && req.method === 'POST') {
        const body = await readBody();
        try {
          const { text } = JSON.parse(body);
          await councilOrchestrator.humanMessage(text || '');
          res.writeHead(200); res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.writeHead(400); res.end(JSON.stringify({ ok: false, error: String(err) }));
        }
        return;
      }

      // POST /council/pause
      if (url === '/council/pause' && req.method === 'POST') {
        const ok = councilOrchestrator.pauseSession('Manually paused by user');
        res.writeHead(200); res.end(JSON.stringify({ ok }));
        return;
      }

      // POST /council/resume
      if (url === '/council/resume' && req.method === 'POST') {
        const ok = councilOrchestrator.resumeSession();
        res.writeHead(200); res.end(JSON.stringify({ ok }));
        return;
      }

      // POST /council/stop
      if (url === '/council/stop' && req.method === 'POST') {
        const ok = await councilOrchestrator.stopSession();
        res.writeHead(200); res.end(JSON.stringify({ ok }));
        return;
      }

      // POST /council/witness/command — Protocol 0.4
      if (url === '/council/witness/command' && req.method === 'POST') {
        const body = await readBody();
        try {
          const { command } = JSON.parse(body);
          const result = await councilOrchestrator.commandWitness(command || '');
          res.writeHead(200); res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(400); res.end(JSON.stringify({ ok: false, error: String(err) }));
        }
        return;
      }

      // GET /council/report — last final report (markdown)
      if (url === '/council/report' && req.method === 'GET') {
        const md = councilOrchestrator.getLastReport();
        if (!md) { res.writeHead(404); res.end(JSON.stringify({ error: 'No reports yet' })); return; }
        res.setHeader('Content-Type', 'text/markdown');
        res.writeHead(200); res.end(md);
        return;
      }

      // GET /council/reports — list saved reports
      if (url === '/council/reports' && req.method === 'GET') {
        res.writeHead(200); res.end(JSON.stringify(councilOrchestrator.listReports()));
        return;
      }

      // GET /council/aether — list aether entries
      if (url === '/council/aether' && req.method === 'GET') {
        res.writeHead(200); res.end(JSON.stringify(councilOrchestrator.aether.getAll()));
        return;
      }

      // POST /council/aether/ingest — manually add entry
      if (url === '/council/aether/ingest' && req.method === 'POST') {
        const body = await readBody();
        try {
          const { content, author, category, weight, tags } = JSON.parse(body);
          const entry = await councilOrchestrator.aether.ingest(content, author, category, weight, tags);
          res.writeHead(200); res.end(JSON.stringify(entry));
        } catch (err) {
          res.writeHead(400); res.end(JSON.stringify({ error: String(err) }));
        }
        return;
      }

      res.writeHead(404); res.end(JSON.stringify({ error: 'Council route not found' }));
      })().catch(err => {
        if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: String(err) })); }
      });
      return;
    }

    // ── End Council API ──────────────────────────────────────────────────────────

    res.writeHead(404);
    res.end('Not found');
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Communion Space running at http://localhost:${PORT}\n`);
  });

  // Start
  communion.start();

  // Graceful shutdown
  let shutdownPromise: Promise<void> | null = null;
  const logShutdownStage = (stage: string, startedAt: number): void => {
    console.log(`[SHUTDOWN] ${stage} elapsed=${Date.now() - startedAt}ms`);
  };
  const logShutdownHandles = (): void => {
    const liveSockets = [...sockets].filter(socket => !socket.destroyed);
    const activeHandles = typeof (process as any)._getActiveHandles === 'function'
      ? (process as any)._getActiveHandles() as any[]
      : [];
    const timerHandles = activeHandles.filter(handle => {
      const name = handle?.constructor?.name || '';
      return name === 'Timeout' || name === 'Immediate';
    });
    console.error('[SHUTDOWN] diagnostics', {
      sseClients: clients.length,
      trackedSockets: sockets.size,
      liveSockets: liveSockets.length,
      liveSocketDetails: liveSockets.map(socket => ({
        localAddress: socket.localAddress,
        localPort: socket.localPort,
        remoteAddress: socket.remoteAddress,
        remotePort: socket.remotePort,
      })),
      timerHandles: timerHandles.length,
      activeHandleTypes: activeHandles.map(handle => handle?.constructor?.name || typeof handle),
    });
  };
  const awaitWithTimeout = async <T>(label: string, promise: Promise<T>, timeoutMs: number): Promise<T | null> => {
    let timer: NodeJS.Timeout | null = null;
    try {
      return await Promise.race<T | null>([
        promise,
        new Promise<null>(resolve => {
          timer = setTimeout(() => {
            console.error(`[SHUTDOWN] ${label} timed out after ${timeoutMs}ms`);
            resolve(null);
          }, timeoutMs);
          timer.unref();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  const shutdown = async (signal: string) => {
    if (shutdownPromise) return shutdownPromise;
    isShuttingDown = true;
    console.log(`[SHUTDOWN] begin ${signal}`);
    shutdownPromise = (async () => {
      const bailout = setTimeout(() => {
        console.error('[SHUTDOWN] timeout');
        logShutdownHandles();
        process.exit(1);
      }, 30000);
      bailout.unref();
      try {
        const shutdownStartedAt = Date.now();
        console.log(`[SHUTDOWN] shutdown:start signal=${signal} elapsed=0ms`);
        const saveBrainStartedAt = Date.now();
        console.log('[SHUTDOWN] shutdown:saveBrainState:start elapsed=0ms');
        // saveCriticalStateSync()/saveBrainSync() are synchronous; this stage is measured but not preemptible.
        // If this stalls, the next targeted fix is a real async/worker save path.
        if (typeof (communion as any).saveCriticalStateSync === 'function') {
          (communion as any).saveCriticalStateSync('shutdown');
        } else {
          communion.saveBrainSync();
        }
        logShutdownStage('shutdown:saveBrainState:end', saveBrainStartedAt);
        rl.close();
        for (const client of clients.splice(0)) {
          try { client.end(); } catch { /* ignore */ }
          try { client.destroy(); } catch { /* ignore */ }
        }
        for (const socket of sockets) {
          try { socket.end(); } catch { /* ignore */ }
          try { socket.destroy(); } catch { /* ignore */ }
        }
        const shutdownFn = (communion as any).shutdown;
        const stopStartedAt = Date.now();
        console.log('[SHUTDOWN] shutdown:communion.stop:start elapsed=0ms');
        if (typeof shutdownFn === 'function') {
          await awaitWithTimeout('communion.shutdown', shutdownFn.call(communion, signal), 12000);
        } else {
          await awaitWithTimeout('communion.stop', communion.stop(), 12000);
        }
        logShutdownStage('shutdown:communion.stop:end', stopStartedAt);
        try { (server as any).closeIdleConnections?.(); } catch { /* ignore */ }
        try { (server as any).closeAllConnections?.(); } catch { /* ignore */ }
        for (const socket of sockets) {
          try { socket.destroy(); } catch { /* ignore */ }
        }
        sockets.clear();
        const serverCloseStartedAt = Date.now();
        console.log('[SHUTDOWN] shutdown:server.close:start elapsed=0ms');
        await awaitWithTimeout('server.close', new Promise<void>(resolve => {
          const forceCloseTimer = setTimeout(() => {
            try { (server as any).closeIdleConnections?.(); } catch { /* ignore */ }
            try { (server as any).closeAllConnections?.(); } catch { /* ignore */ }
            for (const socket of sockets) {
              try { socket.destroy(); } catch { /* ignore */ }
            }
            sockets.clear();
          }, 200);
          forceCloseTimer.unref();
          server.close(() => resolve());
        }), 3000);
        logShutdownStage('shutdown:server.close:end', serverCloseStartedAt);
        clearTimeout(bailout);
        logShutdownStage('shutdown:done', shutdownStartedAt);
        process.exit(0);
      } catch (err) {
        clearTimeout(bailout);
        console.error('[SHUTDOWN] error:', err);
        logShutdownHandles();
        process.exit(1);
      }
    })();
    return shutdownPromise;
  };

  process.on('SIGINT',   () => shutdown('SIGINT'));
  process.on('SIGTERM',  () => shutdown('SIGTERM'));
  process.on('SIGBREAK', () => shutdown('SIGBREAK')); // Windows Ctrl+Break

  // readline SIGINT — more reliable than process signals on Windows PowerShell
  const rl = createInterface({ input: process.stdin });
  rl.on('SIGINT', () => shutdown('SIGINT-readline'));

  // Crash handlers — Node v15+ terminates on unhandled rejections by default.
  // These catch async errors in heartbeat/tick that would otherwise silently kill the process.
  process.on('unhandledRejection', (reason, promise) => {
    console.error('[CRASH] Unhandled rejection:', reason);
    console.error('[CRASH] Promise:', promise);
    try {
      if (typeof (communion as any).saveCriticalStateSync === 'function') {
        (communion as any).saveCriticalStateSync('crash');
      } else {
        communion.saveBrainSync();
      }
    } catch { /* best effort */ }
    shutdown('unhandledRejection');
  });

  process.on('uncaughtException', (err) => {
    console.error('[CRASH] Uncaught exception:', err);
    try {
      if (typeof (communion as any).saveCriticalStateSync === 'function') {
        (communion as any).saveCriticalStateSync('crash');
      } else {
        communion.saveBrainSync();
      }
    } catch { /* best effort */ }
    shutdown('uncaughtException');
  });

  // process.exit safety net — fires even on hard kills, snapshots critical state synchronously
  process.on('exit', () => {
    try {
      if (typeof (communion as any).saveCriticalStateSync === 'function') {
        (communion as any).saveCriticalStateSync('crash');
      } else {
        communion.saveBrainSync();
      }
    } catch { /* best effort */ }
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

