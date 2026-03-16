// embed.ts
// Real embeddings via either:
// 1. a local llama.cpp embedding model, or
// 2. a configured OpenAI-compatible /v1/embeddings endpoint.
//
// Local preferred env:
//   EMBEDDING_MODEL_PATH=D:\\path\\to\\embedding-model.gguf
// Optional local env:
//   BRAIN_LOCAL_EMBEDDING_POOLING=mean
//
// Remote env:
//   EMBEDDING_BASE_URL=https://host/v1
// Optional remote env:
//   EMBEDDING_MODEL=text-embedding-nomic-embed-text-v1.5
//
// NO FALLBACK. Callers decide how to degrade if embeddings are unavailable.
import fs from 'fs';
import path from 'path';
import { getLlamaCppRuntimeManager } from '../src/brain/LlamaCppRuntime';

const EMBEDDING_CHUNK_MAX_CHARS = Number(process.env.BRAIN_LOCAL_EMBEDDING_CHUNK_MAX_CHARS || 1400);

function resolveEmbeddingConfig(): { baseUrl: string; model: string } {
  const baseUrl = String(process.env.EMBEDDING_BASE_URL || '').trim().replace(/\/$/, '');
  const model = String(process.env.EMBEDDING_MODEL || '').trim();

  if (!baseUrl) {
    throw new Error('[embed] No embedding backend configured. Set EMBEDDING_BASE_URL to an OpenAI-compatible /v1 endpoint.');
  }

  return { baseUrl, model };
}


function resolveEmbeddingModelPath(): string {
  const explicit = String(process.env.EMBEDDING_MODEL_PATH || process.env.BRAIN_LOCAL_EMBEDDING_MODEL_PATH || '').trim();
  if (explicit) return explicit;

  const home = process.env.USERPROFILE || process.env.HOME || '';
  const candidates = [
    path.join(home, '.lmstudio', '.internal', 'bundled-models', 'nomic-ai', 'nomic-embed-text-v1.5-GGUF', 'nomic-embed-text-v1.5.Q4_K_M.gguf'),
    path.join(home, '.lmstudio', 'models', 'nomic-ai', 'nomic-embed-text-v1.5-GGUF', 'nomic-embed-text-v1.5.Q4_K_M.gguf'),
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return '';
}

const EMBED_MAX_RETRIES = 3;
const EMBED_RETRY_BASE_MS = 1500;

async function embedChunkWithRetry(baseUrl: string, chunk: string, modelPath: string): Promise<number[]> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < EMBED_MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: chunk }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`[embed] Local embedding runtime returned ${res.status}: ${body}`);
      }
      const json = await res.json() as { data?: Array<{ embedding: number[] }> };
      const embedding = json.data?.[0]?.embedding;
      if (!Array.isArray(embedding) || embedding.length === 0) {
        throw new Error('[embed] Local embedding runtime returned no embedding');
      }
      return embedding;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      const isSocketError = lastErr.message.includes('fetch failed') || lastErr.message.includes('ECONNREFUSED') || lastErr.cause?.toString().includes('other side closed');
      if (!isSocketError || attempt >= EMBED_MAX_RETRIES - 1) break;

      const delay = EMBED_RETRY_BASE_MS * (attempt + 1);
      console.warn(`[embed] Attempt ${attempt + 1}/${EMBED_MAX_RETRIES} failed (socket error), retrying in ${delay}ms...`);

      // Check if runtime process is dead — if so, force re-acquire
      const mgr = getLlamaCppRuntimeManager();
      const live = mgr.getRuntime(modelPath, 'embedding');
      if (!live) {
        console.warn('[embed] Embedding runtime process exited — restarting...');
        await mgr.ensureEmbeddingModel(modelPath);
      }

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastErr || new Error('[embed] All retry attempts failed');
}

async function embedViaLocalLlama(modelPath: string, text: string): Promise<number[]> {
  const runtime = await getLlamaCppRuntimeManager().ensureEmbeddingModel(modelPath);
  const chunks = splitEmbeddingChunks(text, EMBEDDING_CHUNK_MAX_CHARS);
  const embeddings: number[][] = [];
  for (const chunk of chunks) {
    embeddings.push(await embedChunkWithRetry(runtime.baseUrl, chunk, modelPath));
  }
  return averageEmbeddings(embeddings);
}

function splitEmbeddingChunks(text: string, maxChars: number): string[] {
  const source = String(text || '').replace(/\r/g, '').trim();
  if (!source) return [''];
  if (source.length <= maxChars) return [source];

  const paragraphs = source.split(/\n\s*\n+/).map(part => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  const flush = (): void => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    current = '';
  };

  const appendPart = (part: string): void => {
    if (!part) return;
    const candidate = current ? `${current}\n\n${part}` : part;
    if (candidate.length <= maxChars) {
      current = candidate;
      return;
    }
    if (current) flush();
    if (part.length <= maxChars) {
      current = part;
      return;
    }
    const sentences = part.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
    let sentenceChunk = '';
    for (const sentence of sentences) {
      const sentenceCandidate = sentenceChunk ? `${sentenceChunk} ${sentence}` : sentence;
      if (sentenceCandidate.length <= maxChars) {
        sentenceChunk = sentenceCandidate;
      } else {
        if (sentenceChunk) chunks.push(sentenceChunk);
        if (sentence.length <= maxChars) {
          sentenceChunk = sentence;
        } else {
          for (let i = 0; i < sentence.length; i += maxChars) {
            chunks.push(sentence.slice(i, i + maxChars));
          }
          sentenceChunk = '';
        }
      }
    }
    if (sentenceChunk) chunks.push(sentenceChunk);
  };

  for (const paragraph of paragraphs) appendPart(paragraph);
  flush();
  return chunks.length ? chunks : [source.slice(0, maxChars)];
}

function averageEmbeddings(embeddings: number[][]): number[] {
  if (embeddings.length === 0) throw new Error('[embed] No embeddings to average');
  if (embeddings.length === 1) return embeddings[0];
  const length = embeddings[0].length;
  const acc = new Array<number>(length).fill(0);
  for (const vector of embeddings) {
    for (let i = 0; i < length; i += 1) {
      acc[i] += Number(vector[i] || 0);
    }
  }
  for (let i = 0; i < length; i += 1) {
    acc[i] /= embeddings.length;
  }
  return acc;
}

export async function embed(text: string): Promise<number[]> {
  const localModelPath = resolveEmbeddingModelPath();
  if (localModelPath) {
    return embedViaLocalLlama(localModelPath, text);
  }

  const { baseUrl, model } = resolveEmbeddingConfig();

  // Chunk long texts to stay within model token limits (e.g. BGE-small max 512 tokens)
  const chunks = splitEmbeddingChunks(text, EMBEDDING_CHUNK_MAX_CHARS);
  const embeddings: number[][] = [];

  for (const chunk of chunks) {
    const body: Record<string, unknown> = { input: chunk };
    if (model) body.model = model;

    let res: Response;
    try {
      res = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(`[embed] Cannot reach embedding server at ${baseUrl}/embeddings: ${err}`);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`[embed] Embedding server returned ${res.status}: ${errText}`);
    }

    const json = await res.json() as { data?: Array<{ embedding: number[] }> };

    if (!json.data || !Array.isArray(json.data) || json.data.length === 0) {
      throw new Error(`[embed] Unexpected response shape: ${JSON.stringify(json).substring(0, 200)}`);
    }

    const embedding = json.data[0].embedding;
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error(`[embed] Empty or missing embedding in response`);
    }

    embeddings.push(embedding);
  }

  return averageEmbeddings(embeddings);
}
