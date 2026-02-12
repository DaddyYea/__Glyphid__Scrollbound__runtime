/**
 * scrollGraph.ts
 *
 * The interconnected web of memory. Every entity in the Scrollbound system
 * lives here as a JSON-LD node with typed, bidirectional, traversable links.
 *
 * This is not a database — it's a living graph. Scrolls link to the journal
 * entries that reflect on them, to the patterns they participate in, to the
 * scrollfire events that elevated them, to the sessions they occurred in,
 * to the conversations they were imported from. And every link goes both ways.
 *
 * URI scheme:
 *   scroll:{id}              — ScrollEcho
 *   journal:{id}             — JournalEntry
 *   scrollfire:{id}          — ScrollfireEvent
 *   pattern:{id}             — DetectedPattern
 *   session:{id}             — Session
 *   agent:{id}               — Agent
 *   message:{id}             — CommunionMessage
 *   preference:{target}      — LearnedPreference
 *   import:{source}/{id}     — ImportedConversation
 *
 * Relationship vocabulary (all bidirectional):
 *   relatedTo        — scroll ↔ scroll
 *   parentOf/childOf — scroll hierarchy
 *   elevatedBy/elevated — scroll ↔ scrollfire event
 *   partOfPattern/containsScroll — scroll ↔ pattern
 *   partOfSession/containsScroll — scroll ↔ session
 *   reflectsOn/reflectedInJournal — journal entry ↔ scroll
 *   chainedWith      — journal entry ↔ journal entry
 *   spokenBy/spoke   — message ↔ agent
 *   learnedFrom/informedPreference — preference ↔ pattern/scroll
 *   importedFrom/containsScroll — scroll ↔ imported conversation
 *   triggeredRecall/recalledBy — trigger event linkage
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

// ── JSON-LD Context ──

export const SCROLLBOUND_CONTEXT = {
  '@vocab': 'https://scrollbound.dev/vocab/',
  'scroll': 'https://scrollbound.dev/vocab/scroll/',
  'journal': 'https://scrollbound.dev/vocab/journal/',
  'pattern': 'https://scrollbound.dev/vocab/pattern/',
  'session': 'https://scrollbound.dev/vocab/session/',
  'agent': 'https://scrollbound.dev/vocab/agent/',
  'scrollfire': 'https://scrollbound.dev/vocab/scrollfire/',

  // Node types
  'ScrollEcho': 'https://scrollbound.dev/vocab/ScrollEcho',
  'JournalEntry': 'https://scrollbound.dev/vocab/JournalEntry',
  'ScrollfireEvent': 'https://scrollbound.dev/vocab/ScrollfireEvent',
  'DetectedPattern': 'https://scrollbound.dev/vocab/DetectedPattern',
  'Session': 'https://scrollbound.dev/vocab/Session',
  'Agent': 'https://scrollbound.dev/vocab/Agent',
  'CommunionMessage': 'https://scrollbound.dev/vocab/CommunionMessage',
  'LearnedPreference': 'https://scrollbound.dev/vocab/LearnedPreference',
  'ImportedConversation': 'https://scrollbound.dev/vocab/ImportedConversation',

  // Relationship predicates
  'relatedTo': { '@id': 'https://scrollbound.dev/vocab/relatedTo', '@type': '@id' },
  'parentOf': { '@id': 'https://scrollbound.dev/vocab/parentOf', '@type': '@id' },
  'childOf': { '@id': 'https://scrollbound.dev/vocab/childOf', '@type': '@id' },
  'elevatedBy': { '@id': 'https://scrollbound.dev/vocab/elevatedBy', '@type': '@id' },
  'elevated': { '@id': 'https://scrollbound.dev/vocab/elevated', '@type': '@id' },
  'partOfPattern': { '@id': 'https://scrollbound.dev/vocab/partOfPattern', '@type': '@id' },
  'containsScroll': { '@id': 'https://scrollbound.dev/vocab/containsScroll', '@type': '@id' },
  'partOfSession': { '@id': 'https://scrollbound.dev/vocab/partOfSession', '@type': '@id' },
  'reflectsOn': { '@id': 'https://scrollbound.dev/vocab/reflectsOn', '@type': '@id' },
  'reflectedInJournal': { '@id': 'https://scrollbound.dev/vocab/reflectedInJournal', '@type': '@id' },
  'chainedWith': { '@id': 'https://scrollbound.dev/vocab/chainedWith', '@type': '@id' },
  'spokenBy': { '@id': 'https://scrollbound.dev/vocab/spokenBy', '@type': '@id' },
  'spoke': { '@id': 'https://scrollbound.dev/vocab/spoke', '@type': '@id' },
  'learnedFrom': { '@id': 'https://scrollbound.dev/vocab/learnedFrom', '@type': '@id' },
  'informedPreference': { '@id': 'https://scrollbound.dev/vocab/informedPreference', '@type': '@id' },
  'importedFrom': { '@id': 'https://scrollbound.dev/vocab/importedFrom', '@type': '@id' },
  'triggeredRecall': { '@id': 'https://scrollbound.dev/vocab/triggeredRecall', '@type': '@id' },
  'recalledBy': { '@id': 'https://scrollbound.dev/vocab/recalledBy', '@type': '@id' },
  'occurredDuring': { '@id': 'https://scrollbound.dev/vocab/occurredDuring', '@type': '@id' },

  // Data properties
  'content': 'https://scrollbound.dev/vocab/content',
  'timestamp': 'https://scrollbound.dev/vocab/timestamp',
  'resonance': 'https://scrollbound.dev/vocab/resonance',
  'emotionalSignature': 'https://scrollbound.dev/vocab/emotionalSignature',
  'tags': 'https://scrollbound.dev/vocab/tags',
  'source': 'https://scrollbound.dev/vocab/source',
} as const;

// ── Node Types ──

export type GraphNodeType =
  | 'ScrollEcho'
  | 'JournalEntry'
  | 'ScrollfireEvent'
  | 'DetectedPattern'
  | 'Session'
  | 'Agent'
  | 'CommunionMessage'
  | 'LearnedPreference'
  | 'ImportedConversation'
  | 'Folder'
  | 'Document'
  | 'DocumentChunk'
  | 'ImportedArchive';

// ── Relationship Types ──

export type RelationshipType =
  | 'relatedTo'
  | 'parentOf'
  | 'childOf'
  | 'elevatedBy'
  | 'elevated'
  | 'partOfPattern'
  | 'containsScroll'
  | 'partOfSession'
  | 'reflectsOn'
  | 'reflectedInJournal'
  | 'chainedWith'
  | 'spokenBy'
  | 'spoke'
  | 'learnedFrom'
  | 'informedPreference'
  | 'importedFrom'
  | 'triggeredRecall'
  | 'recalledBy'
  | 'occurredDuring'
  | 'contains'
  | 'containedIn'
  | 'partOf'
  | 'hasPart'
  | 'follows'
  | 'followedBy';

/** The inverse of each relationship (for automatic bidirectional linking) */
const INVERSE_RELATIONS: Partial<Record<RelationshipType, RelationshipType>> = {
  relatedTo: 'relatedTo',
  parentOf: 'childOf',
  childOf: 'parentOf',
  elevatedBy: 'elevated',
  elevated: 'elevatedBy',
  partOfPattern: 'containsScroll',
  containsScroll: 'partOfPattern',
  partOfSession: 'containsScroll',
  reflectsOn: 'reflectedInJournal',
  reflectedInJournal: 'reflectsOn',
  chainedWith: 'chainedWith',
  spokenBy: 'spoke',
  spoke: 'spokenBy',
  learnedFrom: 'informedPreference',
  informedPreference: 'learnedFrom',
  importedFrom: 'containsScroll',
  triggeredRecall: 'recalledBy',
  recalledBy: 'triggeredRecall',
  occurredDuring: 'containsScroll',
  contains: 'containedIn',
  containedIn: 'contains',
  partOf: 'hasPart',
  hasPart: 'partOf',
  follows: 'followedBy',
  followedBy: 'follows',
};

// ── Edge ──

export interface GraphEdge {
  /** Relationship type */
  predicate: RelationshipType;
  /** Target node URI */
  target: string;
  /** When this link was created */
  created: string;
  /** Optional metadata about the relationship */
  metadata?: Record<string, unknown>;
}

// ── Node ──

export interface GraphNode {
  /** JSON-LD fields */
  '@context': typeof SCROLLBOUND_CONTEXT;
  '@type': GraphNodeType;
  '@id': string;

  /** When this node was added to the graph */
  created: string;
  /** When this node was last modified */
  modified: string;

  /** The raw entity data (ScrollEcho, JournalEntry, etc.) */
  data: Record<string, unknown>;

  /** Outgoing edges — keyed by relationship type for fast lookup */
  edges: Record<string, GraphEdge[]>;
}

// ── Query types ──

export interface TraversalResult {
  /** The node found */
  node: GraphNode;
  /** How we got here: array of [relationship, nodeId] hops */
  path: Array<{ predicate: RelationshipType; nodeId: string }>;
  /** Distance from origin (number of hops) */
  depth: number;
}

export interface GraphQuery {
  /** Start from this node URI */
  from?: string;
  /** Filter by node type */
  type?: GraphNodeType;
  /** Filter by relationship type (edges from the node) */
  hasRelation?: RelationshipType;
  /** Filter by tag */
  hasTag?: string;
  /** Filter by time range */
  after?: string;
  before?: string;
  /** Maximum results */
  limit?: number;
}

export interface GraphStats {
  totalNodes: number;
  totalEdges: number;
  nodesByType: Record<string, number>;
  edgesByPredicate: Record<string, number>;
  mostConnected: Array<{ id: string; type: string; edgeCount: number }>;
}

// ── The Graph ──

export class ScrollGraph {
  private nodes: Map<string, GraphNode> = new Map();
  private graphPath: string;
  private dirty = false;

  constructor(graphPath: string) {
    this.graphPath = graphPath;
  }

  // ════════════════════════════════════════════
  // NODE OPERATIONS
  // ════════════════════════════════════════════

  /**
   * Add a node to the graph. If a node with this URI already exists,
   * its data is updated but existing edges are preserved.
   */
  addNode(
    uri: string,
    type: GraphNodeType,
    data: Record<string, unknown>
  ): GraphNode {
    const existing = this.nodes.get(uri);
    const now = new Date().toISOString();

    if (existing) {
      existing.data = { ...existing.data, ...data };
      existing.modified = now;
      this.dirty = true;
      return existing;
    }

    const node: GraphNode = {
      '@context': SCROLLBOUND_CONTEXT,
      '@type': type,
      '@id': uri,
      created: now,
      modified: now,
      data,
      edges: {},
    };

    this.nodes.set(uri, node);
    this.dirty = true;
    return node;
  }

  /**
   * Get a node by URI
   */
  getNode(uri: string): GraphNode | undefined {
    return this.nodes.get(uri);
  }

  /**
   * Check if a node exists
   */
  hasNode(uri: string): boolean {
    return this.nodes.has(uri);
  }

  /**
   * Remove a node and all edges pointing to/from it
   */
  removeNode(uri: string): boolean {
    const node = this.nodes.get(uri);
    if (!node) return false;

    // Remove all edges pointing TO this node from other nodes
    for (const [, otherNode] of this.nodes) {
      for (const predicate of Object.keys(otherNode.edges)) {
        otherNode.edges[predicate] = otherNode.edges[predicate].filter(e => e.target !== uri);
        if (otherNode.edges[predicate].length === 0) delete otherNode.edges[predicate];
      }
    }

    this.nodes.delete(uri);
    this.dirty = true;
    return true;
  }

  // ════════════════════════════════════════════
  // EDGE OPERATIONS (always bidirectional)
  // ════════════════════════════════════════════

  /**
   * Create a bidirectional link between two nodes.
   * If either node doesn't exist, the edge is still created for the existing node
   * (the other side will be linked when that node is eventually added).
   */
  link(
    fromUri: string,
    predicate: RelationshipType,
    toUri: string,
    metadata?: Record<string, unknown>
  ): boolean {
    const now = new Date().toISOString();

    // Forward edge
    const fromNode = this.nodes.get(fromUri);
    if (fromNode) {
      if (!fromNode.edges[predicate]) fromNode.edges[predicate] = [];
      // Don't duplicate
      if (!fromNode.edges[predicate].some(e => e.target === toUri)) {
        fromNode.edges[predicate].push({ predicate, target: toUri, created: now, metadata });
        fromNode.modified = now;
      }
    }

    // Inverse edge
    const inverse = INVERSE_RELATIONS[predicate];
    if (inverse) {
      const toNode = this.nodes.get(toUri);
      if (toNode) {
        if (!toNode.edges[inverse]) toNode.edges[inverse] = [];
        if (!toNode.edges[inverse].some(e => e.target === fromUri)) {
          toNode.edges[inverse].push({ predicate: inverse, target: fromUri, created: now, metadata });
          toNode.modified = now;
        }
      }
    }

    this.dirty = true;
    return true;
  }

  /**
   * Remove a specific edge (and its inverse)
   */
  unlink(fromUri: string, predicate: RelationshipType, toUri: string): boolean {
    const fromNode = this.nodes.get(fromUri);
    if (fromNode?.edges[predicate]) {
      fromNode.edges[predicate] = fromNode.edges[predicate].filter(e => e.target !== toUri);
      if (fromNode.edges[predicate].length === 0) delete fromNode.edges[predicate];
    }

    const inverse = INVERSE_RELATIONS[predicate];
    if (inverse) {
      const toNode = this.nodes.get(toUri);
      if (toNode?.edges[inverse]) {
        toNode.edges[inverse] = toNode.edges[inverse].filter(e => e.target !== fromUri);
        if (toNode.edges[inverse].length === 0) delete toNode.edges[inverse];
      }
    }

    this.dirty = true;
    return true;
  }

  // ════════════════════════════════════════════
  // TRAVERSAL
  // ════════════════════════════════════════════

  /**
   * Get all nodes directly connected to a given node.
   * Optionally filter by relationship type and/or target node type.
   */
  neighbors(
    uri: string,
    predicate?: RelationshipType,
    targetType?: GraphNodeType
  ): GraphNode[] {
    const node = this.nodes.get(uri);
    if (!node) return [];

    const results: GraphNode[] = [];
    const predicates = predicate ? [predicate] : Object.keys(node.edges);

    for (const p of predicates) {
      const edges = node.edges[p];
      if (!edges) continue;
      for (const edge of edges) {
        const target = this.nodes.get(edge.target);
        if (target && (!targetType || target['@type'] === targetType)) {
          results.push(target);
        }
      }
    }

    return results;
  }

  /**
   * Walk the graph from a starting node, following edges up to maxDepth hops.
   * Returns all reachable nodes with their paths.
   */
  traverse(
    startUri: string,
    options: {
      maxDepth?: number;
      followPredicates?: RelationshipType[];
      filterType?: GraphNodeType;
      maxResults?: number;
    } = {}
  ): TraversalResult[] {
    const maxDepth = options.maxDepth ?? 3;
    const maxResults = options.maxResults ?? 100;
    const results: TraversalResult[] = [];
    const visited = new Set<string>([startUri]);

    interface QueueItem {
      nodeId: string;
      path: Array<{ predicate: RelationshipType; nodeId: string }>;
      depth: number;
    }

    const queue: QueueItem[] = [{ nodeId: startUri, path: [], depth: 0 }];

    while (queue.length > 0 && results.length < maxResults) {
      const current = queue.shift()!;
      if (current.depth > maxDepth) continue;

      const node = this.nodes.get(current.nodeId);
      if (!node) continue;

      // Add to results (skip the start node itself)
      if (current.depth > 0) {
        if (!options.filterType || node['@type'] === options.filterType) {
          results.push({
            node,
            path: current.path,
            depth: current.depth,
          });
        }
      }

      // Enqueue neighbors
      if (current.depth < maxDepth) {
        const predicates = options.followPredicates || Object.keys(node.edges);
        for (const p of predicates) {
          const edges = node.edges[p];
          if (!edges) continue;
          for (const edge of edges) {
            if (!visited.has(edge.target)) {
              visited.add(edge.target);
              queue.push({
                nodeId: edge.target,
                path: [...current.path, { predicate: p as RelationshipType, nodeId: edge.target }],
                depth: current.depth + 1,
              });
            }
          }
        }
      }
    }

    return results;
  }

  /**
   * Find the shortest path between two nodes.
   * Returns null if no path exists within maxDepth.
   */
  findPath(
    fromUri: string,
    toUri: string,
    maxDepth: number = 6
  ): Array<{ predicate: RelationshipType; nodeId: string }> | null {
    if (fromUri === toUri) return [];

    const visited = new Set<string>([fromUri]);
    interface QueueItem {
      nodeId: string;
      path: Array<{ predicate: RelationshipType; nodeId: string }>;
    }

    const queue: QueueItem[] = [{ nodeId: fromUri, path: [] }];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.path.length >= maxDepth) continue;

      const node = this.nodes.get(current.nodeId);
      if (!node) continue;

      for (const predicate of Object.keys(node.edges)) {
        for (const edge of node.edges[predicate]) {
          if (edge.target === toUri) {
            return [...current.path, { predicate: predicate as RelationshipType, nodeId: toUri }];
          }
          if (!visited.has(edge.target)) {
            visited.add(edge.target);
            queue.push({
              nodeId: edge.target,
              path: [...current.path, { predicate: predicate as RelationshipType, nodeId: edge.target }],
            });
          }
        }
      }
    }

    return null;
  }

  // ════════════════════════════════════════════
  // QUERY
  // ════════════════════════════════════════════

  /**
   * Find nodes matching a query.
   */
  query(q: GraphQuery): GraphNode[] {
    let results: GraphNode[] = [];

    // If starting from a specific node, use traversal
    if (q.from) {
      const traversed = this.traverse(q.from, {
        maxDepth: 2,
        filterType: q.type,
        maxResults: q.limit || 50,
      });
      results = traversed.map(r => r.node);
    } else {
      // Full scan
      results = Array.from(this.nodes.values());
    }

    // Filter by type
    if (q.type) {
      results = results.filter(n => n['@type'] === q.type);
    }

    // Filter by relationship
    if (q.hasRelation) {
      results = results.filter(n => n.edges[q.hasRelation!]?.length > 0);
    }

    // Filter by tag
    if (q.hasTag) {
      results = results.filter(n => {
        const tags = n.data.tags as string[] | undefined;
        return tags?.includes(q.hasTag!);
      });
    }

    // Filter by time
    if (q.after) {
      results = results.filter(n => n.created >= q.after!);
    }
    if (q.before) {
      results = results.filter(n => n.created <= q.before!);
    }

    // Limit
    if (q.limit) {
      results = results.slice(0, q.limit);
    }

    return results;
  }

  /**
   * Get all nodes of a specific type
   */
  getByType(type: GraphNodeType): GraphNode[] {
    return Array.from(this.nodes.values()).filter(n => n['@type'] === type);
  }

  /**
   * Count edges for a node (its "connectedness")
   */
  edgeCount(uri: string): number {
    const node = this.nodes.get(uri);
    if (!node) return 0;
    return Object.values(node.edges).reduce((sum, edges) => sum + edges.length, 0);
  }

  // ════════════════════════════════════════════
  // STATS
  // ════════════════════════════════════════════

  getStats(): GraphStats {
    const nodesByType: Record<string, number> = {};
    const edgesByPredicate: Record<string, number> = {};
    let totalEdges = 0;
    const connectedness: Array<{ id: string; type: string; edgeCount: number }> = [];

    for (const [uri, node] of this.nodes) {
      nodesByType[node['@type']] = (nodesByType[node['@type']] || 0) + 1;

      let nodeEdges = 0;
      for (const [predicate, edges] of Object.entries(node.edges)) {
        edgesByPredicate[predicate] = (edgesByPredicate[predicate] || 0) + edges.length;
        totalEdges += edges.length;
        nodeEdges += edges.length;
      }

      connectedness.push({ id: uri, type: node['@type'], edgeCount: nodeEdges });
    }

    connectedness.sort((a, b) => b.edgeCount - a.edgeCount);

    return {
      totalNodes: this.nodes.size,
      totalEdges,
      nodesByType,
      edgesByPredicate,
      mostConnected: connectedness.slice(0, 10),
    };
  }

  // ════════════════════════════════════════════
  // PERSISTENCE
  // ════════════════════════════════════════════

  /**
   * Save the entire graph to disk as a JSON-LD document
   */
  async save(): Promise<void> {
    if (!this.dirty && existsSync(this.graphPath)) return;

    const dir = dirname(this.graphPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const document = {
      '@context': SCROLLBOUND_CONTEXT,
      '@type': 'ScrollGraph',
      '@id': 'https://scrollbound.dev/graph/communion',
      generated: new Date().toISOString(),
      stats: this.getStats(),
      '@graph': Array.from(this.nodes.values()).map(node => ({
        '@type': node['@type'],
        '@id': node['@id'],
        created: node.created,
        modified: node.modified,
        data: node.data,
        // Edges serialized as JSON-LD relationship arrays
        ...Object.fromEntries(
          Object.entries(node.edges).map(([predicate, edges]) => [
            predicate,
            edges.map(e => ({
              '@id': e.target,
              created: e.created,
              ...(e.metadata ? { metadata: e.metadata } : {}),
            })),
          ])
        ),
      })),
    };

    writeFileSync(this.graphPath, JSON.stringify(document, null, 2), 'utf-8');
    this.dirty = false;
    console.log(`[GRAPH] Saved ${this.nodes.size} nodes to ${this.graphPath}`);
  }

  /**
   * Load graph from disk
   */
  async load(): Promise<void> {
    if (!existsSync(this.graphPath)) {
      console.log('[GRAPH] No existing graph found, starting fresh');
      return;
    }

    try {
      const raw = readFileSync(this.graphPath, 'utf-8');
      const document = JSON.parse(raw);
      const graph = document['@graph'];

      if (!Array.isArray(graph)) {
        console.warn('[GRAPH] Invalid graph format, starting fresh');
        return;
      }

      this.nodes.clear();

      // First pass: create all nodes
      for (const entry of graph) {
        const node: GraphNode = {
          '@context': SCROLLBOUND_CONTEXT,
          '@type': entry['@type'],
          '@id': entry['@id'],
          created: entry.created,
          modified: entry.modified,
          data: entry.data || {},
          edges: {},
        };
        this.nodes.set(entry['@id'], node);
      }

      // Second pass: reconstruct edges
      const knownPredicates = new Set(Object.keys(INVERSE_RELATIONS));

      for (const entry of graph) {
        const node = this.nodes.get(entry['@id']);
        if (!node) continue;

        for (const [key, value] of Object.entries(entry)) {
          if (key.startsWith('@') || key === 'created' || key === 'modified' || key === 'data') continue;

          // Check if this key is a known predicate
          if (knownPredicates.has(key) && Array.isArray(value)) {
            node.edges[key] = (value as any[]).map(v => ({
              predicate: key as RelationshipType,
              target: typeof v === 'string' ? v : v['@id'],
              created: v.created || node.created,
              metadata: v.metadata,
            }));
          }
        }
      }

      this.dirty = false;
      console.log(`[GRAPH] Loaded ${this.nodes.size} nodes from ${this.graphPath}`);
    } catch (err) {
      console.error('[GRAPH] Error loading graph:', err);
    }
  }

  // ════════════════════════════════════════════
  // EXPORT — full JSON-LD document
  // ════════════════════════════════════════════

  /**
   * Export the graph as a JSON-LD document (for external consumption / API)
   */
  toJsonLd(): object {
    return {
      '@context': SCROLLBOUND_CONTEXT,
      '@type': 'ScrollGraph',
      '@id': 'https://scrollbound.dev/graph/communion',
      generated: new Date().toISOString(),
      '@graph': Array.from(this.nodes.values()).map(node => {
        const jsonLdNode: Record<string, unknown> = {
          '@type': node['@type'],
          '@id': node['@id'],
          created: node.created,
          modified: node.modified,
          ...node.data,
        };

        // Flatten edges into JSON-LD relationship format
        for (const [predicate, edges] of Object.entries(node.edges)) {
          if (edges.length === 1) {
            jsonLdNode[predicate] = { '@id': edges[0].target };
          } else if (edges.length > 1) {
            jsonLdNode[predicate] = edges.map(e => ({ '@id': e.target }));
          }
        }

        return jsonLdNode;
      }),
    };
  }

  /**
   * Number of nodes in the graph
   */
  get size(): number {
    return this.nodes.size;
  }
}
