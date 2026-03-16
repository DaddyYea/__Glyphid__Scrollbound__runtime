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
  /** Number of TTS chunks used to build this audio */
  chunkCount?: number;
  /** Max chunk size used for synthesis */
  chunkCharLimit?: number;
  /** Per-chunk character lengths */
  chunkLengths?: number[];
  /** Whether the transport text was normalized before TTS */
  textNormalizedForTts?: boolean;
  /** Raw newline count before normalization */
  rawNewlineCount?: number;
  /** Newline count after normalization */
  normalizedNewlineCount?: number;
  /** Whether markdown-ish markers were present in the transport text */
  markdownDetected?: boolean;
  /** Count of punctuation/symbol chars in the transport text */
  specialCharCount?: number;
  /** Whether any max-length threshold caused truncation */
  truncatedForTts?: boolean;
}

// ── Edge TTS Backend ──

export const TTS_CHUNK_CHAR_LIMIT = 400;
export const TTS_CHUNK_TIMEOUT_MS = 12000;

export function splitTextForTts(text: string, maxChars = TTS_CHUNK_CHAR_LIMIT): string[] {
  const normalized = String(text || '').replace(/\r/g, '').trim();
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const chunks: string[] = [];
  const paragraphs = normalized.split(/\n{2,}/).map(part => part.trim()).filter(Boolean);

  const flushPiece = (piece: string): void => {
    const source = piece.trim();
    if (!source) return;
    if (source.length <= maxChars) {
      chunks.push(source);
      return;
    }
    const sentences = source.match(/[^.!?\n]+[.!?]?|\S+/g) || [source];
    let current = '';
    for (const sentence of sentences) {
      const next = current ? `${current} ${sentence.trim()}` : sentence.trim();
      if (next.length <= maxChars) {
        current = next;
        continue;
      }
      if (current) chunks.push(current.trim());
      if (sentence.length <= maxChars) {
        current = sentence.trim();
        continue;
      }
      const words = sentence.trim().split(/\s+/);
      let wordChunk = '';
      for (const word of words) {
        const nextWordChunk = wordChunk ? `${wordChunk} ${word}` : word;
        if (nextWordChunk.length <= maxChars) {
          wordChunk = nextWordChunk;
        } else {
          if (wordChunk) chunks.push(wordChunk.trim());
          wordChunk = word;
        }
      }
      current = wordChunk.trim();
    }
    if (current) chunks.push(current.trim());
  };

  let currentParagraphBlock = '';
  for (const paragraph of paragraphs) {
    const next = currentParagraphBlock ? `${currentParagraphBlock}\n\n${paragraph}` : paragraph;
    if (next.length <= maxChars) {
      currentParagraphBlock = next;
      continue;
    }
    if (currentParagraphBlock) flushPiece(currentParagraphBlock);
    currentParagraphBlock = paragraph;
  }
  if (currentParagraphBlock) flushPiece(currentParagraphBlock);

  return chunks.filter(Boolean);
}

/**
 * Synthesize a single pre-split chunk to MP3 bytes.
 * Caller is responsible for splitting at appropriate boundaries first.
 * Throws on network/TTS failure — caller handles per-chunk error.
 */
export async function synthesizeChunk(
  chunk: string,
  voiceConfig: AgentVoiceConfig,
): Promise<Buffer> {
  const tmpFile = join(tmpdir(), `scrollbound-tts-${crypto.randomBytes(6).toString('hex')}.mp3`);
  try {
    const tts = new EdgeTTS({ voice: voiceConfig.voiceId });
    await Promise.race([
      tts.ttsPromise(chunk, tmpFile),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`tts_chunk_timeout:${TTS_CHUNK_TIMEOUT_MS}`)), TTS_CHUNK_TIMEOUT_MS)
      ),
    ]);
    return readFileSync(tmpFile);
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

export async function synthesize(
  text: string,
  voiceConfig: AgentVoiceConfig,
): Promise<SynthesisResult> {
  if (!voiceConfig.enabled) {
    throw new Error('Voice not enabled for this agent');
  }

  const rawText = String(text || '');
  const normalizedText = rawText.replace(/\r/g, '').trim();
  const chunks = splitTextForTts(rawText, TTS_CHUNK_CHAR_LIMIT);
  const chunkLengths = chunks.map(chunk => chunk.length);
  const rawNewlineCount = (rawText.match(/\n/g) || []).length;
  const normalizedNewlineCount = (normalizedText.match(/\n/g) || []).length;
  const markdownDetected = /(^|\n)\s{0,3}(?:[-*+] |\d+\. |>|#{1,6}\s)|[*_`~]/m.test(rawText);
  const specialCharCount = (rawText.match(/[^a-z0-9\s]/gi) || []).length;
  console.log(`[TTS] Edge: voice=${voiceConfig.voiceId}, text=${text.length} chars, chunks=${chunks.length}, chunkLimit=${TTS_CHUNK_CHAR_LIMIT}`);

  try {
    const audioParts: Buffer[] = [];
    let durationMs = 0;
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i];
      const tmpFile = join(tmpdir(), `scrollbound-tts-${crypto.randomBytes(6).toString('hex')}.mp3`);
      try {
        const tts = new EdgeTTS({ voice: voiceConfig.voiceId });
        console.log(`[TTS] Edge: sending chunk ${i + 1}/${chunks.length} (${chunk.length} chars)`);
        await tts.ttsPromise(chunk, tmpFile);
        const audio = readFileSync(tmpFile);
        audioParts.push(audio);
        durationMs += Math.max(1000, (chunk.length / 750) * 60000);
      } finally {
        try { unlinkSync(tmpFile); } catch {}
      }
    }

    const mergedAudio = Buffer.concat(audioParts);
    console.log(`[TTS] Edge: received ${mergedAudio.length} bytes MP3 across ${chunks.length} chunk(s)`);
    return {
      audio: mergedAudio,
      format: 'mp3',
      durationMs,
      chunkCount: chunks.length,
      chunkCharLimit: TTS_CHUNK_CHAR_LIMIT,
      chunkLengths,
      textNormalizedForTts: rawText !== normalizedText,
      rawNewlineCount,
      normalizedNewlineCount,
      markdownDetected,
      specialCharCount,
      truncatedForTts: false,
    };
  } finally {
    // per-chunk temp cleanup happens inside the synthesis loop
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
