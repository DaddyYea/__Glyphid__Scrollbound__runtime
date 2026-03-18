// communion/docs/indexStore.ts
// In-memory store for registered documents, their structural maps, and chunks.
// Central registry for the workspace — all lookups go through here.

import crypto from 'crypto';
import { readFileSync } from 'fs';
import { extname, basename } from 'path';
import {
  RegisteredDocument,
  DocumentMap,
  DocumentChunk,
  ChunkHighlight,
  ChunkingConfig,
  WorkspaceStatus,
} from './types';
import { getParser } from './registry';
import { chunkDocument } from './chunker';

function contentHash(fullPath: string): string {
  try {
    const buf = readFileSync(fullPath);
    return crypto.createHash('sha256').update(buf.subarray(0, 4096)).digest('hex').slice(0, 16);
  } catch {
    return '0';
  }
}

function docIdFromPath(relativePath: string): string {
  return `doc:${relativePath}`;
}

export class DocumentIndex {
  private docs = new Map<string, RegisteredDocument>();
  private maps = new Map<string, DocumentMap>();
  // chunkId → chunk
  private chunks = new Map<string, DocumentChunk>();
  // docId → ordered list of chunkIds
  private chunksByDoc = new Map<string, string[]>();
  // chunkId → highlights (mutable, separate from chunk)
  private highlights = new Map<string, ChunkHighlight[]>();

  registerDocument(
    fullPath: string,
    relativePath: string,
    chunkingConfig?: ChunkingConfig,
  ): RegisteredDocument | null {
    const ext = extname(fullPath).toLowerCase();
    const parser = getParser(ext);
    if (!parser) return null;

    let content: string;
    try {
      content = readFileSync(fullPath, 'utf-8');
    } catch {
      return null;
    }

    const docId = docIdFromPath(relativePath);
    const filename = basename(fullPath);
    const lines = content.split('\n');

    let docMap: DocumentMap;
    try {
      docMap = parser.parse(content, relativePath);
    } catch {
      return null;
    }

    let chunkList: DocumentChunk[];
    try {
      chunkList = chunkDocument(docMap, lines, chunkingConfig);
    } catch {
      chunkList = [];
    }

    const hash = contentHash(fullPath);
    const stat = (() => {
      try {
        return readFileSync(fullPath);
      } catch {
        return null;
      }
    })();

    // Remove old chunks if re-registering
    const oldChunkIds = this.chunksByDoc.get(docId) || [];
    for (const cid of oldChunkIds) {
      this.chunks.delete(cid);
      this.highlights.delete(cid);
    }

    // Index new chunks
    const chunkIds: string[] = [];
    for (const chunk of chunkList) {
      this.chunks.set(chunk.id, chunk);
      this.highlights.set(chunk.id, []);
      chunkIds.push(chunk.id);
    }
    this.chunksByDoc.set(docId, chunkIds);
    this.maps.set(docId, docMap);

    const doc: RegisteredDocument = {
      id: docId,
      path: relativePath,
      fullPath,
      filename,
      ext,
      sizeBytes: stat ? stat.length : 0,
      registeredAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      contentHash: hash,
      parserId: parser.id,
      chunkCount: chunkList.length,
      status: 'indexed',
    };
    this.docs.set(docId, doc);
    return doc;
  }

  getDocument(docId: string): RegisteredDocument | null {
    return this.docs.get(docId) || null;
  }

  getAllDocuments(): RegisteredDocument[] {
    return Array.from(this.docs.values()).sort((a, b) => a.path.localeCompare(b.path));
  }

  getMap(docId: string): DocumentMap | null {
    return this.maps.get(docId) || null;
  }

  getChunk(chunkId: string): DocumentChunk | null {
    const chunk = this.chunks.get(chunkId);
    if (!chunk) return null;
    const hl = this.highlights.get(chunkId) || [];
    return { ...chunk, highlights: hl };
  }

  getChunksForDoc(docId: string): DocumentChunk[] {
    const ids = this.chunksByDoc.get(docId) || [];
    return ids.map(id => this.getChunk(id)).filter((c): c is DocumentChunk => c !== null);
  }

  getNeighbors(
    chunkId: string,
    radius: number,
  ): { before: DocumentChunk[]; after: DocumentChunk[] } {
    const chunk = this.chunks.get(chunkId);
    if (!chunk) return { before: [], after: [] };

    const ids = this.chunksByDoc.get(chunk.docId) || [];
    const pos = ids.indexOf(chunkId);
    if (pos === -1) return { before: [], after: [] };

    const r = Math.max(1, Math.min(radius, 10));
    const beforeIds = ids.slice(Math.max(0, pos - r), pos);
    const afterIds = ids.slice(pos + 1, pos + 1 + r);

    return {
      before: beforeIds.map(id => this.getChunk(id)).filter((c): c is DocumentChunk => c !== null),
      after: afterIds.map(id => this.getChunk(id)).filter((c): c is DocumentChunk => c !== null),
    };
  }

  addHighlight(chunkId: string, highlight: ChunkHighlight): boolean {
    if (!this.chunks.has(chunkId)) return false;
    const existing = this.highlights.get(chunkId) || [];
    existing.push(highlight);
    this.highlights.set(chunkId, existing);
    return true;
  }

  removeHighlight(chunkId: string, highlightId: string): boolean {
    const existing = this.highlights.get(chunkId);
    if (!existing) return false;
    const next = existing.filter(h => h.id !== highlightId);
    if (next.length === existing.length) return false;
    this.highlights.set(chunkId, next);
    return true;
  }

  getHighlights(chunkId: string): ChunkHighlight[] {
    return this.highlights.get(chunkId) || [];
  }

  getAllHighlightCount(): number {
    let count = 0;
    for (const hl of this.highlights.values()) count += hl.length;
    return count;
  }

  removeDocument(docId: string): boolean {
    if (!this.docs.has(docId)) return false;
    const ids = this.chunksByDoc.get(docId) || [];
    for (const cid of ids) {
      this.chunks.delete(cid);
      this.highlights.delete(cid);
    }
    this.chunksByDoc.delete(docId);
    this.maps.delete(docId);
    this.docs.delete(docId);
    return true;
  }

  getStatus(): WorkspaceStatus {
    let embeddedCount = 0;
    for (const chunk of this.chunks.values()) {
      if (chunk.embedding && chunk.embedding.length > 0) embeddedCount++;
    }
    return {
      documentCount: this.docs.size,
      chunkCount: this.chunks.size,
      embeddedChunkCount: embeddedCount,
      highlightCount: this.getAllHighlightCount(),
      activePackId: null,
      activePackTokens: 0,
      indexHealthy: true,
    };
  }
}
