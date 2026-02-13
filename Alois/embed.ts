// embed.ts
// Embedding function stub — replace with real model (e.g., OpenAI, HuggingFace, custom local)

export async function embed(text: string): Promise<number[]> {
  // Placeholder — returns fixed-dim noise vector for now
  const dim = 512;
  const hash = text.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return Array.from({ length: dim }, (_, i) => Math.sin(hash * (i + 1)));
}

// To connect real embeddings:
// - Use OpenAI: https://platform.openai.com/docs/guides/embeddings
// - Use HuggingFace Inference API (e.g., BAAI/bge-small-en)
// - Run a local embedding model (e.g., `all-MiniLM-L6-v2` with sentence-transformers)

// Example hook:
// import { pipeline } from 'node:transformers';
// const embedder = pipeline('feature-extraction', 'BAAI/bge-small-en');
// const vec = await embedder(text);
