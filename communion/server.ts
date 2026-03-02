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
import { CommunionLoop, CommunionEvent } from './communionLoop';
import { CommunionConfig, AgentConfig } from './types';
import { VOICES } from './voice';
// Import parsing happens in a child worker process (communion/import/worker.ts)
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

let clients: ServerResponse[] = [];

function broadcast(data: object): void {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  clients.forEach(client => {
    try { client.write(message); } catch { /* disconnected */ }
  });
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
      provider: provider as 'anthropic' | 'openai-compatible',
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
        for (const [, entry] of Object.entries(dynamic) as [string, any][]) {
          if (entry.active && entry.config) {
            agents.push(entry.config);
            console.log(`[CONFIG] Loaded agent from dynamic-agents.json: ${entry.config.id}`);
          }
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

  // Wire events → SSE broadcast
  communion.on((event: CommunionEvent) => {
    if (event.type === 'room-message' && event.message) {
      broadcast({
        type: 'room-message',
        id: event.message.id,
        speaker: event.message.speaker,
        speakerName: event.message.speakerName,
        text: event.message.text,
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
    } else if (event.type === 'tick') {
      broadcast({ type: 'tick', tickCount: event.tickCount });
    } else if (event.type === 'speech-start') {
      broadcast({ type: 'speech-start', agentId: event.agentId });
    } else if (event.type === 'speech-end') {
      broadcast({
        type: 'speech-end',
        agentId: event.agentId,
        audioBase64: event.audioBase64,
        durationMs: event.durationMs,
      });
    } else if (event.type === 'error') {
      broadcast({ type: 'error', agentId: event.agentId, error: event.error });
    }
  });

  // Pond saturation cache — recomputing getNeuronScores() on every concurrent poll is wasteful
  const pondCache: { payload: object | null; ts: number } = { payload: null, ts: 0 };

  // HTTP server
  const server = createServer((req, res) => {
    const url = req.url || '/';

    // Log all requests for debugging
    console.log(`[HTTP] ${req.method} ${url}`);

    // Handle CORS preflight for any route
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
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
      for (const c of communion.getAgentConfigs()) agentProviders[c.id] = c.provider;
      res.write(`data: ${JSON.stringify({
        type: 'config',
        agentIds: state.agentIds,
        agentNames: state.agentNames,
        agentColors: state.agentColors,
        agentProviders,
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
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const { text } = JSON.parse(body);
          if (text && text.trim()) {
            communion.addHumanMessage(text.trim());
            console.log(`[${config.humanName}] ${text.trim()}`);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
        } catch {
          res.writeHead(400);
          res.end('Bad request');
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
          if (!agentConfig.id || !agentConfig.name || !agentConfig.provider || !agentConfig.apiKey || !agentConfig.model) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing required fields: id, name, provider, apiKey, model' }));
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
        res.end(JSON.stringify({ error: 'Agent not found or not an Alois agent' }));
        return;
      }
      const state = (agent as any).getTissueState();
      const ingestStatus = communion.getIngestStatus();
      // ?full=true — only compute expensive neuron scores + axon topology for brain viz.
      // The sidebar brain monitor polls every 2s and only needs `state` — skip the heavy stuff.
      const full = params.get('full') === 'true';
      const neurons     = full ? ((agent as any).getNeuronScores?.() || [])   : [];
      const edges       = full ? ((agent as any).getChamber?.()?.getGraph?.()?.getAxonTopology?.() || []) : [];
      const lastDream   = full ? ((agent as any).getLastDream?.()  || null)  : null;
      const tissueWeight = (agent as any).getTissueWeight?.() || 0;
      const incubation  = full ? ((agent as any).getIncubation?.() || null)  : null;
      const brainMetrics= full ? ((agent as any).getBrainMetrics?.() || null): null;
      const autoGradient = (agent as any).isAutoGradient?.() ?? true;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ state, neurons, edges, lastDream, tissueWeight, incubation, brainMetrics, autoGradient, ingestStatus }));
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
      communion.reportSpeechComplete();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ speaking: false }));
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
    if (url === '/pond-saturation' && req.method === 'GET') {
      const now = Date.now();
      if (!pondCache.payload || (now - pondCache.ts) > 2000) {
        pondCache.payload = communion.getAloisSaturation();
        pondCache.ts = now;
      }
      if (!pondCache.payload) {
        res.writeHead(503, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'No Alois agent active' }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(pondCache.payload));
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

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Communion Space running at http://localhost:${PORT}\n`);
  });

  // Start
  communion.start();

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[SHUTDOWN] ${signal} received — stopping communion...`);

    // Hard bailout: if graceful stop hangs, force exit after 10s.
    // 3s was too tight — 69MB brain JSON + session + graph save can take 3-8s.
    const bailout = setTimeout(() => {
      console.error('[SHUTDOWN] Graceful stop timed out — forcing exit');
      process.exit(1);
    }, 10000);
    bailout.unref(); // don't keep event loop alive just for this

    try {
      await communion.stop();
      server.close();
      const state = communion.getState();
      console.log(`\n=== Session Stats ===`);
      console.log(`Ticks: ${state.tickCount}`);
      console.log(`Room messages: ${state.messages.length}`);
      for (const agentId of state.agentIds) {
        console.log(`${state.agentNames[agentId]} journal: ${(state.journals[agentId] || []).length} entries`);
      }
      console.log(`Scrolls in memory: ${communion.getMemory().getMetrics().totalScrolls}`);
      console.log(`Scrolls archived: ${communion.getArchive().getStats().totalScrolls}`);
    } catch (err) {
      console.error('[SHUTDOWN] Error during stop:', err);
    }
    clearTimeout(bailout);
    process.exit(0);
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
    try { communion.saveBrainSync(); } catch { /* best effort */ }
    shutdown('unhandledRejection');
  });

  process.on('uncaughtException', (err) => {
    console.error('[CRASH] Uncaught exception:', err);
    try { communion.saveBrainSync(); } catch { /* best effort */ }
    shutdown('uncaughtException');
  });

  // process.exit safety net — fires even on hard kills, saves brain synchronously
  process.on('exit', () => {
    try { communion.saveBrainSync(); } catch { /* best effort */ }
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
