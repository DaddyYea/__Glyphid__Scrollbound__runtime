// embed.ts
// Real embedding via LM Studio /v1/embeddings endpoint.
// Set EMBEDDING_BASE_URL env var to override (default: http://localhost:1234/v1).
// Set EMBEDDING_MODEL env var to specify model name (default: uses whatever is loaded).
//
// NO FALLBACK. If the embedding server is unreachable, this throws.
// Stubs that silently return fake data corrupt every downstream system — never again.

const BASE_URL = (process.env.EMBEDDING_BASE_URL || 'http://127.0.0.1:1234/api/v1').replace(/\/$/, '');
const MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-nomic-embed-text-v1.5';

export async function embed(text: string): Promise<number[]> {
  const body: Record<string, unknown> = { input: text };
  if (MODEL) body.model = MODEL;

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`[embed] Cannot reach embedding server at ${BASE_URL}/embeddings: ${err}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[embed] Embedding server returned ${res.status}: ${text}`);
  }

  const json = await res.json() as { data?: Array<{ embedding: number[] }> };

  if (!json.data || !Array.isArray(json.data) || json.data.length === 0) {
    throw new Error(`[embed] Unexpected response shape: ${JSON.stringify(json).substring(0, 200)}`);
  }

  const embedding = json.data[0].embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error(`[embed] Empty or missing embedding in response`);
  }

  return embedding;
}
