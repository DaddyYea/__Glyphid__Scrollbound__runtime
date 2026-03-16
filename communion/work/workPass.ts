import { getGraphRef } from '../graph/scrollGraphStore';
import { findOpenWorkByDeterministicKey, normalizeWorkAction, proposeWork } from './workLifecycle';
import type { WorkMode } from './workModels';

interface WorkPassInput {
  count: number;
  mode: WorkMode;
}

export interface WorkPassResult {
  created: string[];
  skippedDuplicatesCount: number;
}

interface GraphNode {
  '@id'?: string;
  '@type'?: string;
  modified?: string;
  data?: Record<string, unknown>;
}

function normName(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getFilename(node: GraphNode): string {
  const data = node.data || {};
  const byName = data.fileName || data.filename || data.name;
  if (typeof byName === 'string' && byName.trim()) return byName;
  const byPath = data.path;
  if (typeof byPath === 'string' && byPath.trim()) {
    const parts = byPath.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || byPath;
  }
  return node['@id'] || 'unknown';
}

function getFolderId(node: GraphNode): string {
  const data = node.data || {};
  const folderId = data.folderId || data.parentFolderId || data.folder;
  return typeof folderId === 'string' ? folderId : '';
}

function isSimilarName(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return a.includes(b) || b.includes(a);
}

function getResultId(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const id = (result as { id?: unknown }).id;
  return typeof id === 'string' && id ? id : null;
}

function proposeWorkPassItem(input: {
  type: 'WorkItem' | 'Deprecation';
  mode: WorkMode;
  title: string;
  summary: string;
  relatedTo: string[];
  actionInput: unknown;
  details?: Record<string, unknown>;
}): { id: string | null; skippedDuplicate: boolean } {
  const normalized = normalizeWorkAction(input.actionInput);
  const duplicate = findOpenWorkByDeterministicKey(normalized.deterministicKey, ['proposed', 'accepted']);
  if (duplicate) return { id: null, skippedDuplicate: true };

  const details = {
    ...(input.details || {}),
    actionType: normalized.action.actionType,
    payload: normalized.action.payload,
    deterministicKey: normalized.deterministicKey,
  };

  const result = proposeWork({
    type: input.type,
    proposedBy: 'system',
    mode: input.mode,
    title: input.title,
    summary: input.summary,
    details,
    relatedTo: input.relatedTo,
  });

  return { id: getResultId(result), skippedDuplicate: false };
}

export function runWorkPass(input: WorkPassInput): WorkPassResult {
  const graph = getGraphRef();
  const nodeMap = (graph as unknown as { nodes?: Map<string, GraphNode> } | null)?.nodes;
  const allNodes = nodeMap instanceof Map ? Array.from(nodeMap.values()) : [];
  const docs = allNodes
    .filter(n => n?.['@type'] === 'Document' && typeof n?.['@id'] === 'string')
    .sort((a, b) => (b.modified || '').localeCompare(a.modified || ''));

  const topDocs = docs.slice(0, 3);
  const relatedToBase = Array.from(new Set([
    ...topDocs.map(d => d['@id']).filter((v): v is string => typeof v === 'string' && !!v),
    ...topDocs.map(getFolderId).filter(Boolean),
  ]));

  const created: string[] = [];
  let skippedDuplicatesCount = 0;
  const count = Math.max(1, Math.min(25, Math.floor(input.count || 1)));

  const seed = proposeWorkPassItem({
    type: 'WorkItem',
    mode: input.mode,
    title: topDocs.length > 0 ? 'Review recent documents' : 'Seed work queue',
    summary: topDocs.length > 0
      ? `Review ${topDocs.length} recently modified documents.`
      : 'No Document nodes found; keep queue seeded.',
    actionInput: { actionType: 'markDone', payload: {} },
    details: {
      source: 'work-pass-v0',
      documentIds: topDocs.map(d => d['@id']),
    },
    relatedTo: relatedToBase,
  });
  if (seed.skippedDuplicate) skippedDuplicatesCount++;
  if (seed.id) created.push(seed.id);

  let duplicate: { keepId: string; dropId: string; folderId: string; sizeBytes: number } | null = null;
  for (let i = 0; i < docs.length && !duplicate; i++) {
    for (let j = i + 1; j < docs.length; j++) {
      const a = docs[i];
      const b = docs[j];
      const folderA = getFolderId(a);
      const folderB = getFolderId(b);
      if (!folderA || folderA !== folderB) continue;
      const sizeA = Number(a.data?.sizeBytes || 0);
      const sizeB = Number(b.data?.sizeBytes || 0);
      if (!Number.isFinite(sizeA) || sizeA <= 0 || sizeA !== sizeB) continue;
      const nameA = normName(getFilename(a));
      const nameB = normName(getFilename(b));
      if (!isSimilarName(nameA, nameB)) continue;
      duplicate = {
        keepId: String(a['@id']),
        dropId: String(b['@id']),
        folderId: folderA,
        sizeBytes: sizeA,
      };
      break;
    }
  }

  if (duplicate && created.length < count) {
    const dep = proposeWorkPassItem({
      type: 'Deprecation',
      mode: input.mode,
      title: 'Possible duplicate document',
      summary: 'Same folder, same size, similar filename.',
      actionInput: {
        actionType: 'tagDeprecation',
        payload: {
          docId: duplicate.dropId,
          reason: 'Same folder, same size, and similar filename.',
        },
      },
      details: { source: 'work-pass-v0', ...duplicate },
      relatedTo: [duplicate.keepId, duplicate.dropId, duplicate.folderId],
    });
    if (dep.skippedDuplicate) skippedDuplicatesCount++;
    if (dep.id) created.push(dep.id);
  }

  let idx = 0;
  while (created.length < count && idx < topDocs.length) {
    const doc = topDocs[idx++];
    const docId = String(doc['@id']);
    const folderId = getFolderId(doc);
    const folderExists = !!(folderId && graph?.getNode(folderId));
    const toDocId = folderExists ? folderId : docId;
    const rel = folderExists ? 'containedIn' : 'relatedTo';

    const item = proposeWorkPassItem({
      type: 'WorkItem',
      mode: input.mode,
      title: 'Document triage',
      summary: `Triage ${getFilename(doc)}.`,
      actionInput: { actionType: 'linkDocs', payload: { fromDocId: docId, toDocId, rel } },
      details: { source: 'work-pass-v0', documentId: docId },
      relatedTo: [docId, folderId].filter(Boolean),
    });
    if (item.skippedDuplicate) skippedDuplicatesCount++;
    if (item.id) created.push(item.id);
  }

  return { created, skippedDuplicatesCount };
}
