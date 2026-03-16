import { ScrollGraph, SCROLLBOUND_CONTEXT } from '../../src/memory/scrollGraph';

export interface ScrollGraphJsonLd {
  '@context': typeof SCROLLBOUND_CONTEXT;
  '@type': 'ScrollGraph';
  '@id': string;
  generated?: string;
  stats?: unknown;
  '@graph': any[];
}

interface ScrollGraphStoreHooks {
  requestSave?: (reason?: string) => void;
  flushSaveNow?: (reason?: string) => Promise<void>;
}

let liveGraph: ScrollGraph | null = null;
let hooks: ScrollGraphStoreHooks = {};
let isFlushing = false;

function getNodeMap(graph: ScrollGraph): Map<string, any> {
  const nodes = (graph as unknown as { nodes?: Map<string, any> }).nodes;
  return nodes instanceof Map ? nodes : new Map<string, any>();
}

function serializeNode(node: any): any {
  const out: Record<string, unknown> = {
    '@type': node?.['@type'],
    '@id': node?.['@id'],
    created: node?.created,
    modified: node?.modified,
    data: node?.data || {},
  };
  const edges = node?.edges && typeof node.edges === 'object' ? node.edges : {};
  for (const [predicate, rels] of Object.entries(edges)) {
    if (!Array.isArray(rels) || rels.length === 0) continue;
    out[predicate] = rels.map((edge: any) => ({
      '@id': edge?.target,
      created: edge?.created,
      ...(edge?.metadata ? { metadata: edge.metadata } : {}),
    }));
  }
  return out;
}

export function getGraphRef(): ScrollGraph | null {
  return liveGraph;
}

export function serializeGraphView(opts: {
  limit?: number;
  typeFilter?: string[];
  idPrefix?: string;
  includeStats?: boolean;
} = {}): ScrollGraphJsonLd {
  if (!liveGraph) {
    return {
      '@context': SCROLLBOUND_CONTEXT,
      '@type': 'ScrollGraph',
      '@id': 'https://scrollbound.dev/graph/communion',
      '@graph': [],
    };
  }

  const graph = liveGraph;
  const typeFilter = Array.isArray(opts.typeFilter) && opts.typeFilter.length > 0
    ? new Set(opts.typeFilter)
    : null;
  const idPrefix = typeof opts.idPrefix === 'string' && opts.idPrefix.length > 0
    ? opts.idPrefix
    : '';
  const defaultLimit = 200;
  const limit = Number.isFinite(opts.limit as number)
    ? Math.max(0, Number(opts.limit))
    : defaultLimit;

  let nodes = Array.from(getNodeMap(graph).values());
  if (typeFilter) nodes = nodes.filter(node => typeFilter.has(node?.['@type']));
  if (idPrefix) nodes = nodes.filter(node => typeof node?.['@id'] === 'string' && node['@id'].startsWith(idPrefix));
  nodes = nodes.slice(0, limit);

  const view: ScrollGraphJsonLd = {
    '@context': SCROLLBOUND_CONTEXT,
    '@type': 'ScrollGraph',
    '@id': 'https://scrollbound.dev/graph/communion',
    generated: new Date().toISOString(),
    '@graph': nodes.map(serializeNode),
  };
  if (opts.includeStats !== false) view.stats = graph.getStats();
  return view;
}

export function registerScrollGraphStore(graph: ScrollGraph, storeHooks: ScrollGraphStoreHooks = {}): void {
  liveGraph = graph;
  hooks = storeHooks;
}

// Deprecated convenience alias: returns a materialized serialized view.
export function getGraph(opts?: { limit?: number; typeFilter?: string[]; idPrefix?: string; includeStats?: boolean }): ScrollGraphJsonLd {
  return serializeGraphView(opts);
}

export function appendNodes(nodes: any[]): void {
  if (!liveGraph || !Array.isArray(nodes) || nodes.length === 0) return;
  const reserved = new Set(['@context', '@type', '@id', 'created', 'modified', 'data', 'generated', 'stats', '@graph']);

  for (const raw of nodes) {
    if (!raw || typeof raw !== 'object') continue;
    const id = typeof raw['@id'] === 'string' ? raw['@id'].trim() : '';
    if (!id) continue;
    const type = (typeof raw['@type'] === 'string' && raw['@type']) ? raw['@type'] : 'Document';
    const data = (raw.data && typeof raw.data === 'object') ? raw.data : {};
    liveGraph.addNode(id, type as any, data as Record<string, unknown>);

    for (const [predicate, relValue] of Object.entries(raw)) {
      if (reserved.has(predicate)) continue;
      const rels = Array.isArray(relValue) ? relValue : [relValue];
      for (const rel of rels) {
        let targetId = '';
        let metadata: Record<string, unknown> | undefined;
        if (typeof rel === 'string') {
          targetId = rel;
        } else if (rel && typeof rel === 'object') {
          targetId = typeof rel['@id'] === 'string' ? rel['@id'] : '';
          metadata = rel.metadata && typeof rel.metadata === 'object'
            ? (rel.metadata as Record<string, unknown>)
            : undefined;
        }
        if (!targetId) continue;
        liveGraph.link(id, predicate as any, targetId, metadata);
      }
    }
  }
}

export function requestSave(reason?: string): void {
  if (!liveGraph) return;
  (liveGraph as unknown as { dirty?: boolean }).dirty = true;
  hooks.requestSave?.(reason);
}

export async function flushSaveNow(reason?: string): Promise<void> {
  if (!liveGraph || isFlushing) return;
  isFlushing = true;
  try {
    if (hooks.flushSaveNow) {
      await hooks.flushSaveNow(reason);
    } else {
      await liveGraph.save();
    }
  } finally {
    isFlushing = false;
  }
}
