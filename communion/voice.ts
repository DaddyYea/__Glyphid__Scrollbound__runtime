/**
 * Voice System — Text-to-Speech for Communion Agents
 *
 * Two backends:
 * - OpenAI TTS: REST API (POST /v1/audio/speech) — for GPT and Claude agents
 * - xAI Realtime: WebSocket (wss://api.x.ai/v1/realtime) — for Grok agents
 *
 * Each agent can have a voice assigned. When they speak, their text
 * is synthesized to audio and played through the dashboard.
 * The master clock pauses during playback.
 */

// ws is loaded lazily — only when xAI voice is actually used
let WebSocketClass: any = null;
async function getWebSocket(): Promise<any> {
  if (!WebSocketClass) {
    try {
      const ws = await import('ws');
      WebSocketClass = ws.default || ws;
    } catch {
      throw new Error('ws package not installed. Run: npm install ws');
    }
  }
  return WebSocketClass;
}

// ── Voice definitions ──

export interface VoiceOption {
  id: string;
  name: string;
  provider: 'openai' | 'xai';
  description?: string;
}

export const OPENAI_VOICES: VoiceOption[] = [
  { id: 'alloy', name: 'Alloy', provider: 'openai', description: 'Neutral, balanced' },
  { id: 'ash', name: 'Ash', provider: 'openai', description: 'Warm, conversational' },
  { id: 'ballad', name: 'Ballad', provider: 'openai', description: 'Expressive, storytelling' },
  { id: 'coral', name: 'Coral', provider: 'openai', description: 'Bright, clear' },
  { id: 'echo', name: 'Echo', provider: 'openai', description: 'Smooth, deep' },
  { id: 'fable', name: 'Fable', provider: 'openai', description: 'Warm, British' },
  { id: 'nova', name: 'Nova', provider: 'openai', description: 'Energetic, lively' },
  { id: 'onyx', name: 'Onyx', provider: 'openai', description: 'Deep, authoritative' },
  { id: 'sage', name: 'Sage', provider: 'openai', description: 'Calm, measured' },
  { id: 'shimmer', name: 'Shimmer', provider: 'openai', description: 'Soft, gentle' },
];

export const XAI_VOICES: VoiceOption[] = [
  { id: 'Ara', name: 'Ara', provider: 'xai', description: 'Expressive, general-purpose' },
  { id: 'Eve', name: 'Eve', provider: 'xai', description: 'Expressive, general-purpose' },
  { id: 'Leo', name: 'Leo', provider: 'xai', description: 'Expressive, general-purpose' },
  { id: 'Sal', name: 'Sal', provider: 'xai', description: 'Classic character voice' },
  { id: 'Rex', name: 'Rex', provider: 'xai', description: 'Classic character voice' },
  { id: 'Mika', name: 'Mika', provider: 'xai', description: 'Energetic, exploratory' },
  { id: 'Vale', name: 'Vale', provider: 'xai', description: 'Suave, smooth' },
];

export const ALL_VOICES: VoiceOption[] = [...OPENAI_VOICES, ...XAI_VOICES];

// ── Voice config per agent ──

export interface AgentVoiceConfig {
  /** Voice ID (e.g. 'alloy', 'Ara') */
  voiceId: string;
  /** Voice provider */
  voiceProvider: 'openai' | 'xai';
  /** Whether voice is enabled for this agent */
  enabled: boolean;
}

// ── Synthesize result ──

export interface SynthesisResult {
  /** Raw audio data (PCM or MP3 depending on backend) */
  audio: Buffer;
  /** Audio format */
  format: 'mp3' | 'pcm';
  /** Sample rate (for PCM) */
  sampleRate?: number;
  /** Duration estimate in ms */
  durationMs?: number;
}

// ── OpenAI TTS Backend ──

export async function synthesizeOpenAI(
  text: string,
  voiceId: string,
  apiKey: string,
): Promise<SynthesisResult> {
  console.log(`[TTS] OpenAI: voice=${voiceId}, text=${text.length} chars, key=${apiKey ? apiKey.substring(0, 8) + '...' : 'MISSING'}`);
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'tts-1',
      input: text,
      voice: voiceId,
      response_format: 'mp3',
      speed: 1.0,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI TTS error (${response.status}): ${errorText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const audio = Buffer.from(arrayBuffer);
  console.log(`[TTS] OpenAI: received ${audio.length} bytes MP3`);

  // Rough estimate: ~150 words/min, ~5 chars/word = ~750 chars/min
  const durationMs = Math.max(1000, (text.length / 750) * 60000);

  return { audio, format: 'mp3', durationMs };
}

// ── xAI Realtime TTS Backend ──

export async function synthesizeXAI(
  text: string,
  voiceId: string,
  apiKey: string,
): Promise<SynthesisResult> {
  const WS = await getWebSocket();
  console.log(`[TTS] xAI: voice=${voiceId}, text=${text.length} chars`);

  return new Promise<SynthesisResult>((resolve, reject) => {
    let resolved = false;
    const ws = new WS('wss://api.x.ai/v1/realtime', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        ws.close();
        reject(new Error('xAI TTS timeout (30s)'));
      }
    }, 30000);

    const audioChunks: Buffer[] = [];
    let textSent = false;

    ws.on('open', () => {
      console.log('[TTS] xAI: WebSocket connected, sending session.update...');
      // Configure session — wait for session.updated before sending text
      ws.send(JSON.stringify({
        type: 'session.update',
        session: {
          voice: voiceId,
          modalities: ['text', 'audio'],
          instructions: 'You are a text-to-speech engine. Read the user message aloud exactly as written. Do not add, remove, or change any words.',
          audio: {
            output: {
              format: { type: 'audio/pcm', rate: 24000 },
            },
          },
        },
      }));
    });

    ws.on('message', (raw: Buffer | string) => {
      try {
        const msg = JSON.parse(raw.toString());
        console.log(`[TTS] xAI event: ${msg.type}`);

        // Only send text AFTER session.updated (our config is applied)
        // Ignore session.created — that's the initial state before our voice config
        if (msg.type === 'session.updated' && !textSent) {
          textSent = true;
          console.log(`[TTS] xAI: session configured with voice=${voiceId}, sending text...`);
          ws.send(JSON.stringify({
            type: 'conversation.item.create',
            item: {
              type: 'message',
              role: 'user',
              content: [{ type: 'input_text', text }],
            },
          }));
          ws.send(JSON.stringify({
            type: 'response.create',
            response: {
              modalities: ['audio'],
            },
          }));
        }

        if (msg.type === 'response.audio.delta' && msg.delta) {
          audioChunks.push(Buffer.from(msg.delta, 'base64'));
        }

        // Wait for response.audio.done specifically — response.done can fire too early
        if (msg.type === 'response.audio.done') {
          console.log(`[TTS] xAI: audio stream done, ${audioChunks.length} chunks received`);
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            ws.close();
            const audio = Buffer.concat(audioChunks);
            const durationMs = (audio.length / (24000 * 2)) * 1000;
            console.log(`[TTS] xAI: ${audio.length} bytes PCM, ~${Math.round(durationMs / 1000)}s`);
            resolve({ audio, format: 'pcm', sampleRate: 24000, durationMs });
          }
        }

        // If response.done fires and we haven't resolved from audio.done,
        // resolve with whatever we have
        if (msg.type === 'response.done' && !resolved) {
          if (audioChunks.length > 0) {
            resolved = true;
            clearTimeout(timeout);
            ws.close();
            const audio = Buffer.concat(audioChunks);
            const durationMs = (audio.length / (24000 * 2)) * 1000;
            console.log(`[TTS] xAI: resolved on response.done, ${audio.length} bytes PCM`);
            resolve({ audio, format: 'pcm', sampleRate: 24000, durationMs });
          } else {
            console.warn('[TTS] xAI: response.done but no audio chunks — waiting...');
          }
        }

        if (msg.type === 'error') {
          console.error('[TTS] xAI error:', msg.error?.message || JSON.stringify(msg.error));
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            ws.close();
            reject(new Error(`xAI Realtime error: ${msg.error?.message || JSON.stringify(msg.error)}`));
          }
        }
      } catch (err) {
        // Non-JSON message, ignore
      }
    });

    ws.on('error', (err: any) => {
      console.error('[TTS] xAI WebSocket error:', err.message);
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(new Error(`xAI WebSocket error: ${err.message}`));
      }
    });

    ws.on('close', () => {
      clearTimeout(timeout);
      if (!resolved) {
        // If we got audio chunks, resolve; otherwise reject
        if (audioChunks.length > 0) {
          resolved = true;
          const audio = Buffer.concat(audioChunks);
          const durationMs = (audio.length / (24000 * 2)) * 1000;
          console.log(`[TTS] xAI: resolved on close, ${audio.length} bytes PCM`);
          resolve({ audio, format: 'pcm', sampleRate: 24000, durationMs });
        } else {
          resolved = true;
          reject(new Error('xAI WebSocket closed with no audio data'));
        }
      }
    });
  });
}

// ── Unified synthesize function ──

// Map xAI voices to similar OpenAI voices for fallback
const XAI_TO_OPENAI_FALLBACK: Record<string, string> = {
  'Ara': 'nova',
  'Eve': 'shimmer',
  'Leo': 'onyx',
  'Sal': 'echo',
  'Rex': 'fable',
  'Mika': 'coral',
  'Vale': 'alloy',
};

export async function synthesize(
  text: string,
  voiceConfig: AgentVoiceConfig,
  apiKeys: { openai?: string; xai?: string },
): Promise<SynthesisResult> {
  if (!voiceConfig.enabled) {
    throw new Error('Voice not enabled for this agent');
  }

  if (voiceConfig.voiceProvider === 'openai') {
    if (!apiKeys.openai) throw new Error('OpenAI API key required for OpenAI TTS');
    return synthesizeOpenAI(text, voiceConfig.voiceId, apiKeys.openai);
  }

  if (voiceConfig.voiceProvider === 'xai') {
    if (!apiKeys.xai) throw new Error('xAI API key required for xAI TTS');
    try {
      return await synthesizeXAI(text, voiceConfig.voiceId, apiKeys.xai);
    } catch (err) {
      // Fallback to OpenAI TTS if xAI fails and OpenAI key is available
      if (apiKeys.openai) {
        const fallbackVoice = XAI_TO_OPENAI_FALLBACK[voiceConfig.voiceId] || 'alloy';
        console.warn(`[TTS] xAI failed (${(err as Error).message}), falling back to OpenAI/${fallbackVoice}`);
        return synthesizeOpenAI(text, fallbackVoice, apiKeys.openai);
      }
      throw err;
    }
  }

  throw new Error(`Unknown voice provider: ${voiceConfig.voiceProvider}`);
}

/**
 * Get default voice config for an agent based on their provider.
 */
export function getDefaultVoiceConfig(agentId: string, provider: string, baseUrl?: string): AgentVoiceConfig {
  // Grok → xAI voice
  if (baseUrl?.includes('x.ai') || agentId === 'grok') {
    return { voiceId: 'Ara', voiceProvider: 'xai', enabled: false };
  }
  // OpenAI / GPT → OpenAI voice
  if (baseUrl?.includes('openai.com') || agentId === 'openai' || provider === 'openai-compatible') {
    return { voiceId: 'nova', voiceProvider: 'openai', enabled: false };
  }
  // Claude / Anthropic → OpenAI voice (no native TTS)
  if (provider === 'anthropic' || agentId === 'claude') {
    return { voiceId: 'sage', voiceProvider: 'openai', enabled: false };
  }
  // Default
  return { voiceId: 'alloy', voiceProvider: 'openai', enabled: false };
}
