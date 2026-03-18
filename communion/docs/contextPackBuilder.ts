// communion/docs/contextPackBuilder.ts
// Assembles a ContextPack from selected/pinned/locked chunks within a token budget.
//
// Priority order:
//   1. Locked chunks — never evicted
//   2. Pinned chunks — evicted last
//   3. Selected / search-hit chunks by score / order
//   4. Neighbor expansion (if budget remains)
//
// Budget enforcement: remove lowest-rank unpinned/unlocked chunks until under budget.

import crypto from 'crypto';
import { DocumentChunk, ContextPack, ContextPackItem, InclusionReason } from './types';
import { DocumentIndex } from './indexStore';

export interface BuildPackOptions {
  selectedChunkIds: string[];
  pinnedChunkIds?: string[];
  lockedChunkIds?: string[];
  budget?: number;           // max tokens; default 12000
  expandNeighbors?: boolean; // try to include adjacent chunks if budget allows
  sessionId?: string;
}

function tokenEstimate(text: string): number {
  return Math.ceil(text.length / 4);
}

function makePackedRepresentation(items: ContextPackItem[]): string {
  const lines: string[] = [];
  for (const item of items) {
    const path = item.structuralPath.length > 0 ? item.structuralPath.join(' > ') : item.docId;
    const shortId = item.chunkId.split(':').slice(-2).join(':');
    lines.push(`── [${path}] (${shortId}) ──`);
    lines.push(item.text);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

export function buildContextPack(index: DocumentIndex, options: BuildPackOptions): ContextPack {
  const budget = options.budget ?? 12000;
  const lockedSet = new Set(options.lockedChunkIds ?? []);
  const pinnedSet = new Set(options.pinnedChunkIds ?? []);
  const selectedIds = options.selectedChunkIds ?? [];

  type Candidate = {
    chunk: DocumentChunk;
    reason: InclusionReason;
    priority: number; // lower = higher priority
    pinned: boolean;
    locked: boolean;
  };

  const seen = new Set<string>();
  const candidates: Candidate[] = [];

  function addCandidate(chunkId: string, reason: InclusionReason, priority: number): void {
    if (seen.has(chunkId)) return;
    const chunk = index.getChunk(chunkId);
    if (!chunk) return;
    seen.add(chunkId);
    candidates.push({
      chunk,
      reason,
      priority,
      pinned: pinnedSet.has(chunkId),
      locked: lockedSet.has(chunkId),
    });
  }

  // 1. Locked chunks (priority 0)
  for (const id of lockedSet) addCandidate(id, 'locked', 0);

  // 2. Pinned chunks (priority 1)
  for (const id of pinnedSet) addCandidate(id, 'pinned', 1);

  // 3. Selected chunks (priority 2 + position)
  for (let i = 0; i < selectedIds.length; i++) {
    addCandidate(selectedIds[i], 'manual', 2 + i);
  }

  // Sort by priority (locked first, then pinned, then selected)
  candidates.sort((a, b) => {
    if (a.locked !== b.locked) return a.locked ? -1 : 1;
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return a.priority - b.priority;
  });

  // Budget enforcement: greedily add until budget exceeded
  const selected: Candidate[] = [];
  let totalTokens = 0;

  for (const cand of candidates) {
    const t = cand.chunk.tokenEstimate || tokenEstimate(cand.chunk.text);
    if (!cand.locked && !cand.pinned && totalTokens + t > budget) continue;
    selected.push(cand);
    totalTokens += t;
  }

  // 4. Neighbor expansion if budget allows
  if (options.expandNeighbors !== false) {
    const neighborIds: Array<{ id: string; priority: number }> = [];
    for (const cand of selected) {
      const { before, after } = index.getNeighbors(cand.chunk.id, 1);
      for (const n of [...before, ...after]) {
        neighborIds.push({ id: n.id, priority: cand.priority + 0.5 });
      }
    }
    neighborIds.sort((a, b) => a.priority - b.priority);
    for (const { id } of neighborIds) {
      if (seen.has(id)) continue;
      const chunk = index.getChunk(id);
      if (!chunk) continue;
      const t = chunk.tokenEstimate || tokenEstimate(chunk.text);
      if (totalTokens + t > budget) continue;
      seen.add(id);
      selected.push({ chunk, reason: 'neighbor', priority: 999, pinned: false, locked: false });
      totalTokens += t;
    }
  }

  // Sort final selection by document order (docId, then chunk index)
  selected.sort((a, b) => {
    const docCmp = a.chunk.docId.localeCompare(b.chunk.docId);
    if (docCmp !== 0) return docCmp;
    return a.chunk.index - b.chunk.index;
  });

  const items: ContextPackItem[] = selected.map(cand => ({
    chunkId: cand.chunk.id,
    docId: cand.chunk.docId,
    text: cand.chunk.text,
    structuralPath: cand.chunk.structuralPath,
    tokenEstimate: cand.chunk.tokenEstimate || tokenEstimate(cand.chunk.text),
    inclusionReason: cand.reason,
    pinned: cand.pinned,
    locked: cand.locked,
  }));

  const sourceFileIds = [...new Set(items.map(i => i.docId))];
  const inclusionReasons = [...new Set(items.map(i => i.inclusionReason))] as InclusionReason[];

  return {
    id: `pack:${crypto.randomUUID().slice(0, 8)}`,
    items,
    totalTokens,
    budgetTokens: budget,
    sourceFileIds,
    inclusionReasons,
    packedRepresentation: makePackedRepresentation(items),
    createdAt: new Date().toISOString(),
    sessionId: options.sessionId,
  };
}

export function estimatePackTokens(chunkIds: string[], index: DocumentIndex): number {
  let total = 0;
  for (const id of chunkIds) {
    const chunk = index.getChunk(id);
    if (chunk) total += chunk.tokenEstimate || tokenEstimate(chunk.text);
  }
  return total;
}
