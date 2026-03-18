// communion/docs/chunker.ts
// Converts a DocumentMap into a flat array of DocumentChunks.
//
// Strategy:
//  1. Walk the structural node tree depth-first.
//  2. Leaf nodes (no children) whose line range fits maxTokens → one chunk.
//  3. Oversized leaf nodes → split into sentence-boundary windows.
//  4. Section/subsection nodes with children → chunk children together
//     while staying under targetTokens, then group the rest.
//  5. Root node is not itself a chunk — its children are processed.

import { DocumentMap, DocumentChunk, ChunkingConfig, DEFAULT_CHUNKING_CONFIG, StructuralNode } from './types';

const STOP_WORDS = new Set([
  'this', 'that', 'with', 'from', 'have', 'will', 'been', 'were', 'they',
  'their', 'there', 'when', 'where', 'what', 'which', 'into', 'your',
  'more', 'some', 'than', 'then', 'also', 'each', 'would', 'could', 'should',
  'about', 'after', 'before', 'other', 'these', 'those', 'being', 'using',
  'through', 'during', 'between', 'while',
]);

function extractKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4 && !STOP_WORDS.has(w));

  const freq = new Map<string, number>();
  for (const w of words) {
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([w]) => w);
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function buildStructuralPath(node: StructuralNode, ancestorPath: string[]): string[] {
  if (node.type === 'root') return [];
  return [...ancestorPath, node.label];
}

function splitIntoWindows(text: string, maxChars: number, overlapChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const windows: string[] = [];
  // Try to split on sentence boundaries (. ! ?)
  const sentences = text.match(/[^.!?]+[.!?]+|\s*[^.!?]+$/g) || [text];

  let current = '';
  let overlapBuffer = '';

  for (const sentence of sentences) {
    if (current.length + sentence.length > maxChars && current.length > 0) {
      windows.push(current.trim());
      // Carry overlap: last N chars of current
      overlapBuffer = current.length > overlapChars
        ? current.slice(current.length - overlapChars)
        : current;
      current = overlapBuffer + sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) windows.push(current.trim());
  return windows;
}

export function chunkDocument(
  docMap: DocumentMap,
  lines: string[],
  config: ChunkingConfig = DEFAULT_CHUNKING_CONFIG,
): DocumentChunk[] {
  const maxChars = config.maxTokens * 4;
  const targetChars = config.targetTokens * 4;
  const overlapChars = config.overlapTokens * 4;

  const chunks: DocumentChunk[] = [];
  let chunkCounter = 0;

  function makeChunkId(): string {
    return `${docMap.docId}:chunk:${chunkCounter++}`;
  }

  function getNodeText(node: StructuralNode): string {
    if (node.startLine > node.endLine) return '';
    return lines.slice(node.startLine, node.endLine + 1).join('\n');
  }

  function makeChunk(
    id: string,
    text: string,
    nodeId: string,
    startLine: number,
    endLine: number,
    structuralPath: string[],
  ): DocumentChunk {
    return {
      id,
      docId: docMap.docId,
      index: 0, // set after all chunks collected
      nodeId,
      text,
      startLine,
      endLine,
      structuralPath,
      tokenEstimate: estimateTokens(text),
      overlapPrev: 0,
      overlapNext: 0,
      previousChunkId: null,
      nextChunkId: null,
      highlights: [],
      keywords: extractKeywords(text),
    };
  }

  function processNode(node: StructuralNode, ancestorPath: string[]): void {
    const path = buildStructuralPath(node, ancestorPath);

    // Skip root — just recurse into children
    if (node.type === 'root') {
      for (const child of node.children) processNode(child, path);
      return;
    }

    // Leaf node (no children)
    if (node.children.length === 0) {
      const text = getNodeText(node);
      if (!text.trim()) return;

      const chars = text.length;
      if (chars <= maxChars) {
        chunks.push(makeChunk(makeChunkId(), text, node.id, node.startLine, node.endLine, path));
      } else {
        // Split oversized leaf into windows
        const windows = splitIntoWindows(text, targetChars, overlapChars);
        for (let i = 0; i < windows.length; i++) {
          const winId = makeChunkId();
          const chunk = makeChunk(winId, windows[i], node.id, node.startLine, node.endLine, path);
          if (i > 0) chunk.overlapPrev = overlapChars;
          if (i < windows.length - 1) chunk.overlapNext = overlapChars;
          chunks.push(chunk);
        }
      }
      return;
    }

    // Node with children — check if children can be grouped into budget chunks
    if (config.respectStructure) {
      // First, try to collect leaf children inline
      const leafChildren = node.children.filter(c => c.children.length === 0);
      const sectionChildren = node.children.filter(c => c.children.length > 0);

      // Process section children recursively
      for (const child of sectionChildren) {
        processNode(child, path);
      }

      if (leafChildren.length === 0) return;

      // Group leaf children into budget-fitting chunks
      let groupText = '';
      let groupStart = leafChildren[0].startLine;
      let groupEnd = leafChildren[0].endLine;

      for (const child of leafChildren) {
        const childText = getNodeText(child);
        if (!childText.trim()) continue;

        const combinedLen = groupText.length + childText.length + 1;
        if (groupText.length > 0 && combinedLen > targetChars) {
          // Flush current group
          if (groupText.trim()) {
            chunks.push(makeChunk(makeChunkId(), groupText.trim(), node.id, groupStart, groupEnd, path));
          }
          groupText = childText;
          groupStart = child.startLine;
          groupEnd = child.endLine;
        } else {
          if (groupText.length > 0) groupText += '\n';
          groupText += childText;
          groupEnd = child.endLine;
        }
      }
      if (groupText.trim()) {
        if (groupText.length > maxChars) {
          const windows = splitIntoWindows(groupText.trim(), targetChars, overlapChars);
          for (let i = 0; i < windows.length; i++) {
            const chunk = makeChunk(makeChunkId(), windows[i], node.id, groupStart, groupEnd, path);
            if (i > 0) chunk.overlapPrev = overlapChars;
            if (i < windows.length - 1) chunk.overlapNext = overlapChars;
            chunks.push(chunk);
          }
        } else {
          chunks.push(makeChunk(makeChunkId(), groupText.trim(), node.id, groupStart, groupEnd, path));
        }
      }
    } else {
      // Flat mode: just recurse
      for (const child of node.children) processNode(child, path);
    }
  }

  processNode(docMap.root, []);

  // Assign sequential index and link prev/next
  for (let i = 0; i < chunks.length; i++) {
    chunks[i].index = i;
    if (i > 0) chunks[i].previousChunkId = chunks[i - 1].id;
    if (i < chunks.length - 1) chunks[i].nextChunkId = chunks[i + 1].id;
  }

  return chunks;
}
