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

import * as WebSocket from 'ws';

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
  return new Promise<SynthesisResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('xAI TTS timeout (30s)'));
    }, 30000);

    const ws = new WebSocket('wss://api.x.ai/v1/realtime', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    const audioChunks: Buffer[] = [];
    let sessionReady = false;

    ws.on('open', () => {
      // Configure session
      ws.send(JSON.stringify({
        type: 'session.update',
        session: {
          voice: voiceId,
          modalities: ['text', 'audio'],
          instructions: 'You are a text-to-speech engine. Repeat the user\'s message exactly as given. Do not add anything.',
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

        if (msg.type === 'session.created' || msg.type === 'session.updated') {
          sessionReady = true;
          // Send the text to speak
          ws.send(JSON.stringify({
            type: 'conversation.item.create',
            item: {
              type: 'message',
              role: 'user',
              content: [{ type: 'input_text', text }],
            },
          }));
          ws.send(JSON.stringify({ type: 'response.create' }));
        }

        if (msg.type === 'response.audio.delta' && msg.delta) {
          audioChunks.push(Buffer.from(msg.delta, 'base64'));
        }

        if (msg.type === 'response.audio.done' || msg.type === 'response.done') {
          clearTimeout(timeout);
          ws.close();
          const audio = Buffer.concat(audioChunks);
          // PCM 24kHz 16-bit mono: duration = bytes / (24000 * 2)
          const durationMs = (audio.length / (24000 * 2)) * 1000;
          resolve({ audio, format: 'pcm', sampleRate: 24000, durationMs });
        }

        if (msg.type === 'error') {
          clearTimeout(timeout);
          ws.close();
          reject(new Error(`xAI Realtime error: ${msg.error?.message || JSON.stringify(msg.error)}`));
        }
      } catch (err) {
        // Non-JSON message, ignore
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`xAI WebSocket error: ${err.message}`));
    });

    ws.on('close', () => {
      clearTimeout(timeout);
      // If we got audio chunks, resolve
      if (audioChunks.length > 0) {
        const audio = Buffer.concat(audioChunks);
        const durationMs = (audio.length / (24000 * 2)) * 1000;
        resolve({ audio, format: 'pcm', sampleRate: 24000, durationMs });
      }
    });
  });
}

// ── Unified synthesize function ──

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
    return synthesizeXAI(text, voiceConfig.voiceId, apiKeys.xai);
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
