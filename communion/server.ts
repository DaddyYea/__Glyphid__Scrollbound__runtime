/**
 * Communion Server (N-Agent)
 *
 * Config-driven server. Agents are defined in communion.config.json
 * or built from environment variables.
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFileSync, existsSync, mkdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { CommunionLoop, CommunionEvent } from './communionLoop';
import { CommunionConfig, AgentConfig } from './types';
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
        model: process.env.GROK_MODEL || 'grok-3',
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

  if (agents.length === 0) {
    console.error('No agents configured. Either create communion.config.json or set API key env vars.');
    console.error('See .env.example or communion.config.example.json for details.');
    process.exit(1);
  }

  return {
    humanName: process.env.HUMAN_NAME || 'Jason',
    agents,
    tickIntervalMs: Number(process.env.TICK_INTERVAL_MS) || 15000,
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
        { stdio: ['ignore', 'pipe', 'pipe'] }
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
    } else if (event.type === 'tick') {
      broadcast({ type: 'tick', tickCount: event.tickCount });
    } else if (event.type === 'error') {
      broadcast({ type: 'error', agentId: event.agentId, error: event.error });
    }
  });

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

      // Send config (agent list, colors, names)
      const state = communion.getState();
      res.write(`data: ${JSON.stringify({
        type: 'config',
        agentIds: state.agentIds,
        agentNames: state.agentNames,
        agentColors: state.agentColors,
        humanName: state.humanName,
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

    // Human message
    if (url === '/message' && req.method === 'POST') {
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
      if (!ms || ms < 3000 || ms > 120000) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Provide ?ms=N (3000-120000)' }));
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
      }));
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

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Communion Space running at http://localhost:${PORT}\n`);
  });

  // Start
  communion.start();

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n[SHUTDOWN] Stopping communion...');
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
    process.exit(0);
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
