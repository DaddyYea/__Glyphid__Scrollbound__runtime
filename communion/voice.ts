/**
 * Voice System — Text-to-Speech for Communion Agents
 *
 * Uses Microsoft Edge TTS via node-edge-tts (free, no API key needed).
 * Natural-sounding neural voices across many languages.
 *
 * Each agent can have a voice assigned. When they speak, their text
 * is synthesized to audio and played through the dashboard.
 * The master clock pauses during playback.
 */

import { EdgeTTS } from 'node-edge-tts';
import { readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import crypto from 'crypto';

// ── Voice definitions ──

export interface VoiceOption {
  id: string;
  name: string;
  gender: 'Male' | 'Female';
  description?: string;
}

// Curated English voices — the best-sounding ones for agent personas
export const VOICES: VoiceOption[] = [
  // Female
  { id: 'en-US-AriaNeural', name: 'Aria', gender: 'Female', description: 'Warm, conversational' },
  { id: 'en-US-JennyNeural', name: 'Jenny', gender: 'Female', description: 'Friendly, casual' },
  { id: 'en-US-MichelleNeural', name: 'Michelle', gender: 'Female', description: 'Clear, professional' },
  { id: 'en-US-SaraNeural', name: 'Sara', gender: 'Female', description: 'Bright, energetic' },
  { id: 'en-GB-SoniaNeural', name: 'Sonia', gender: 'Female', description: 'British, warm' },
  { id: 'en-GB-LibbyNeural', name: 'Libby', gender: 'Female', description: 'British, gentle' },
  { id: 'en-AU-NatashaNeural', name: 'Natasha', gender: 'Female', description: 'Australian, bright' },
  // Male
  { id: 'en-US-GuyNeural', name: 'Guy', gender: 'Male', description: 'Deep, authoritative' },
  { id: 'en-US-DavisNeural', name: 'Davis', gender: 'Male', description: 'Calm, measured' },
  { id: 'en-US-TonyNeural', name: 'Tony', gender: 'Male', description: 'Casual, friendly' },
  { id: 'en-US-JasonNeural', name: 'Jason', gender: 'Male', description: 'Clear, confident' },
  { id: 'en-GB-RyanNeural', name: 'Ryan', gender: 'Male', description: 'British, smooth' },
  { id: 'en-AU-WilliamNeural', name: 'William', gender: 'Male', description: 'Australian, deep' },
];

// ── Voice config per agent ──

export interface AgentVoiceConfig {
  /** Voice ID (e.g. 'en-US-AriaNeural') */
  voiceId: string;
  /** Whether voice is enabled for this agent */
  enabled: boolean;
}

// ── Synthesize result ──

export interface SynthesisResult {
  /** Raw audio data (MP3) */
  audio: Buffer;
  /** Audio format */
  format: 'mp3';
  /** Duration estimate in ms */
  durationMs?: number;
}

// ── Edge TTS Backend ──

export async function synthesize(
  text: string,
  voiceConfig: AgentVoiceConfig,
): Promise<SynthesisResult> {
  if (!voiceConfig.enabled) {
    throw new Error('Voice not enabled for this agent');
  }

  console.log(`[TTS] Edge: voice=${voiceConfig.voiceId}, text=${text.length} chars`);

  // node-edge-tts writes to a file, so use a temp file
  const tmpFile = join(tmpdir(), `scrollbound-tts-${crypto.randomBytes(6).toString('hex')}.mp3`);

  try {
    const tts = new EdgeTTS({ voice: voiceConfig.voiceId });
    await tts.ttsPromise(text, tmpFile);

    const audio = readFileSync(tmpFile);
    console.log(`[TTS] Edge: received ${audio.length} bytes MP3`);

    // Rough estimate: ~150 words/min, ~5 chars/word = ~750 chars/min
    const durationMs = Math.max(1000, (text.length / 750) * 60000);

    return { audio, format: 'mp3', durationMs };
  } finally {
    // Clean up temp file
    try { unlinkSync(tmpFile); } catch {}
  }
}

/**
 * Get default voice config for an agent based on their provider.
 * Each agent gets a distinct voice so they sound different.
 */
export function getDefaultVoiceConfig(agentId: string, provider: string, baseUrl?: string): AgentVoiceConfig {
  // Grok → Guy (deep, authoritative)
  if (baseUrl?.includes('x.ai') || agentId === 'grok') {
    return { voiceId: 'en-US-GuyNeural', enabled: false };
  }
  // GPT → Davis (calm, measured)
  if (baseUrl?.includes('openai.com') || agentId === 'openai' || provider === 'openai-compatible') {
    return { voiceId: 'en-US-DavisNeural', enabled: false };
  }
  // Claude → Ryan (British, smooth)
  if (provider === 'anthropic' || agentId === 'claude') {
    return { voiceId: 'en-GB-RyanNeural', enabled: false };
  }
  // Default
  return { voiceId: 'en-US-AriaNeural', enabled: false };
}
