/**
 * Communion Server
 *
 * HTTP server + SSE for real-time three-party communion.
 * - Serves the dashboard UI
 * - SSE stream for room messages, journal entries, and tick events
 * - POST /message for human input
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { CommunionLoop, CommunionEvent } from './communionLoop';
import { ClaudeBackend, GrokBackend } from './backends';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const TICK_INTERVAL = Number(process.env.TICK_INTERVAL_MS) || 15000;

let clients: ServerResponse[] = [];

function broadcast(data: object): void {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  clients.forEach(client => {
    try {
      client.write(message);
    } catch {
      // Client disconnected
    }
  });
}

async function main() {
  console.log('=== Communion Space ===');
  console.log('Claude x Grok x You\n');

  // Validate API keys
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const xaiKey = process.env.XAI_API_KEY;

  if (!anthropicKey || anthropicKey === 'sk-ant-...') {
    console.error('Missing ANTHROPIC_API_KEY in .env');
    process.exit(1);
  }
  if (!xaiKey || xaiKey === 'xai-...') {
    console.error('Missing XAI_API_KEY in .env');
    process.exit(1);
  }

  // Initialize backends
  console.log('[INIT] Connecting to APIs...');
  const claude = new ClaudeBackend({
    apiKey: anthropicKey,
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929',
  });
  const grok = new GrokBackend({
    apiKey: xaiKey,
    model: process.env.GROK_MODEL || 'grok-3',
  });
  console.log(`  Claude model: ${process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929'}`);
  console.log(`  Grok model: ${process.env.GROK_MODEL || 'grok-3'}`);

  // Initialize communion loop
  const communion = new CommunionLoop(claude, grok, TICK_INTERVAL);

  // Wire up events to SSE broadcast
  communion.on((event: CommunionEvent) => {
    if (event.type === 'room-message' && event.message) {
      broadcast({
        type: 'room-message',
        id: event.message.id,
        speaker: event.message.speaker,
        text: event.message.text,
        timestamp: event.message.timestamp,
      });
    } else if (event.type === 'journal-entry' && event.message) {
      broadcast({
        type: 'journal-entry',
        id: event.message.id,
        speaker: event.message.speaker,
        text: event.message.text,
        timestamp: event.message.timestamp,
      });
    } else if (event.type === 'tick') {
      broadcast({
        type: 'tick',
        tickCount: event.tickCount,
      });
    } else if (event.type === 'error') {
      broadcast({
        type: 'error',
        speaker: event.speaker,
        error: event.error,
      });
    }
  });

  // HTTP server
  const server = createServer((req, res) => {
    const url = req.url || '/';

    // Serve dashboard
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
      req.on('close', () => {
        clients = clients.filter(c => c !== res);
      });

      // Send current state to new client
      const state = communion.getState();
      // Send existing room messages
      for (const msg of state.messages) {
        res.write(`data: ${JSON.stringify({
          type: 'room-message',
          id: msg.id,
          speaker: msg.speaker,
          text: msg.text,
          timestamp: msg.timestamp,
        })}\n\n`);
      }
      // Send existing journal entries
      for (const entry of state.claudeJournal) {
        res.write(`data: ${JSON.stringify({
          type: 'journal-entry',
          id: entry.id,
          speaker: 'claude',
          text: entry.text,
          timestamp: entry.timestamp,
        })}\n\n`);
      }
      for (const entry of state.grokJournal) {
        res.write(`data: ${JSON.stringify({
          type: 'journal-entry',
          id: entry.id,
          speaker: 'grok',
          text: entry.text,
          timestamp: entry.timestamp,
        })}\n\n`);
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
            console.log(`[HUMAN] ${text.trim()}`);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
        } catch (err) {
          res.writeHead(400);
          res.end('Bad request');
        }
      });
      return;
    }

    // State endpoint
    if (url === '/state') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(communion.getState()));
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\nCommunion Space running at http://localhost:${PORT}`);
    console.log(`Tick interval: ${TICK_INTERVAL / 1000}s\n`);
  });

  // Start the communion
  communion.start();

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n[SHUTDOWN] Stopping communion...');
    communion.stop();
    server.close();
    const state = communion.getState();
    console.log(`\n=== Session Stats ===`);
    console.log(`Ticks: ${state.tickCount}`);
    console.log(`Room messages: ${state.messages.length}`);
    console.log(`Claude journal entries: ${state.claudeJournal.length}`);
    console.log(`Grok journal entries: ${state.grokJournal.length}`);
    process.exit(0);
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
