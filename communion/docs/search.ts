// communion/docs/search.ts
// Lexical search over indexed document chunks.
//
// Scoring:
//  - For each query term: TF component = occurrences in chunk / chunk word count
//  - Keyword bonus: if term appears in chunk.keywords[], add 0.5 per hit
//  - Terms are lowercased, normalized; short terms (<3 chars) are skipped
//  - Results grouped by docId, sorted by score desc

import { DocumentChunk, SearchQuery, SearchMode, ChunkSearchHit, GroupedSearchResults } from './types';
import { DocumentIndex } from './indexStore';

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3);
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let pos = 0;
  const h = haystack.toLowerCase();
  while ((pos = h.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}

function extractSnippet(text: string, terms: string[]): string {
  const lower = text.toLowerCase();
  let bestPos = -1;
  for (const term of terms) {
    const pos = lower.indexOf(term);
    if (pos !== -1 && (bestPos === -1 || pos < bestPos)) bestPos = pos;
  }
  if (bestPos === -1) return text.slice(0, 120);
  const start = Math.max(0, bestPos - 30);
  const snippet = text.slice(start, start + 160).trim();
  return (start > 0 ? '…' : '') + snippet + (start + 160 < text.length ? '…' : '');
}

function scoreChunk(chunk: DocumentChunk, terms: string[]): number {
  if (!terms.length) return 0;
  const chunkLower = chunk.text.toLowerCase();
  const wordCount = Math.max(1, chunkLower.split(/\s+/).length);
  let score = 0;

  for (const term of terms) {
    const freq = countOccurrences(chunk.text, term);
    if (freq > 0) {
      score += freq / wordCount;
      // Keyword match bonus
      if (chunk.keywords.includes(term)) score += 0.5;
    }
  }

  return score;
}

function matchedTerms(chunk: DocumentChunk, terms: string[]): string[] {
  const lower = chunk.text.toLowerCase();
  return terms.filter(t => lower.includes(t));
}

export function lexicalSearch(index: DocumentIndex, query: SearchQuery): GroupedSearchResults {
  const terms = tokenize(query.text);
  const maxResults = query.maxResults ?? 20;
  const docFilter = query.docFilter && query.docFilter.length > 0
    ? new Set(query.docFilter)
    : null;

  // Gather all docs to search
  const docs = docFilter
    ? index.getAllDocuments().filter(d => docFilter.has(d.id))
    : index.getAllDocuments();

  const hits: ChunkSearchHit[] = [];

  for (const doc of docs) {
    const chunks = index.getChunksForDoc(doc.id);
    for (const chunk of chunks) {
      if (!terms.length) continue;
      const score = scoreChunk(chunk, terms);
      if (score <= 0) continue;
      const matched = matchedTerms(chunk, terms);
      hits.push({
        chunk,
        score,
        matchType: 'lexical' as SearchMode,
        whyMatched: matched.join(', '),
        highlights: matched.map(term => {
          const lower = chunk.text.toLowerCase();
          const pos = lower.indexOf(term);
          const line = pos !== -1
            ? chunk.text.slice(0, pos).split('\n').length
            : 0;
          return { line, text: term };
        }),
      });
    }
  }

  hits.sort((a, b) => b.score - a.score);
  const topHits = hits.slice(0, maxResults);

  // Group by docId
  const grouped = new Map<string, ChunkSearchHit[]>();
  for (const hit of topHits) {
    const key = hit.chunk.docId;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(hit);
  }

  const groups = Array.from(grouped.entries()).map(([docId, docHits]) => {
    const doc = index.getDocument(docId);
    return {
      docId,
      filename: doc?.filename ?? docId,
      hits: docHits,
    };
  });

  // Annotate each hit with a snippet
  for (const group of groups) {
    for (const hit of group.hits) {
      const snippet = extractSnippet(hit.chunk.text, terms);
      // Attach snippet into highlights[0] line text if not already
      if (hit.highlights.length === 0) {
        hit.highlights.push({ line: 0, text: snippet });
      }
    }
  }

  return {
    query: query.text,
    totalHits: topHits.length,
    groups,
  };
}
