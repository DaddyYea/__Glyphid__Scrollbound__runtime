// communion/docs/types.ts
// Shared Document Workspace — Core Types
// All interfaces for the document workspace subsystem.

// ── Document Registration ──

export interface RegisteredDocument {
  id: string;                    // e.g., "doc:path/to/file.md"
  path: string;                  // relative path within documentsDir
  fullPath: string;              // absolute path on disk
  filename: string;
  ext: string;
  sizeBytes: number;
  registeredAt: string;          // ISO timestamp
  lastModified: string;          // file mtime
  contentHash: string;           // for change detection
  parserId: string;              // which parser handled it
  chunkCount: number;
  status: 'pending' | 'parsed' | 'indexed' | 'error';
  errorMessage?: string;
}

// ── Structural Parsing ──

export type NodeType =
  | 'root'
  | 'heading'
  | 'section'
  | 'subsection'
  | 'paragraph'
  | 'code_block'
  | 'list'
  | 'table'
  | 'frontmatter'
  | 'blockquote'
  | 'function'
  | 'class'
  | 'method'
  | 'interface'
  | 'import_block'
  | 'export_block'
  | 'comment_block'
  | 'turn'
  | 'turn_group'
  | 'scene'
  | 'dialogue_block';

export interface StructuralNode {
  id: string;                    // unique within document
  type: NodeType;
  label: string;                 // human-readable label (e.g., "## Methods")
  depth: number;                 // nesting depth
  startLine: number;
  endLine: number;
  children: StructuralNode[];
  metadata?: Record<string, string>;
}

export interface DocumentMap {
  docId: string;
  root: StructuralNode;
  lineCount: number;
  parsedAt: string;
}

// ── Parser Registry ──

export interface DocumentParser {
  id: string;
  extensions: string[];          // e.g., ['.md', '.markdown']
  parse(content: string, filename: string): DocumentMap;
}

// ── Chunking ──

export interface ChunkHighlight {
  id: string;
  text: string;
  startOffset: number;           // char offset within chunk text
  endOffset: number;
  createdBy: string;             // human name or agent id
  timestamp: string;
  note?: string;
  pinnedToPack: boolean;
}

export interface DocumentChunk {
  id: string;                    // e.g., "chunk:path/file.md:0"
  docId: string;
  index: number;                 // chunk sequence number within document
  nodeId: string;                // structural node this chunk belongs to
  text: string;
  startLine: number;
  endLine: number;
  structuralPath: string[];      // breadcrumb of structural node labels
  tokenEstimate: number;
  overlapPrev: number;           // chars of overlap with previous chunk
  overlapNext: number;           // chars of overlap with next chunk
  previousChunkId: string | null;
  nextChunkId: string | null;
  embedding?: number[];          // 384-dim BGE-small vector, populated async
  highlights: ChunkHighlight[];
  keywords: string[];
}

export interface ChunkingConfig {
  targetTokens: number;          // default 256
  maxTokens: number;             // default 512
  overlapTokens: number;         // default 32
  respectStructure: boolean;     // default true — never split mid-section if possible
}

export const DEFAULT_CHUNKING_CONFIG: ChunkingConfig = {
  targetTokens: 1500,  // ~6000 chars / ~1200 words — chapter-sized sections
  maxTokens: 3000,     // ~12000 chars max before splitting
  overlapTokens: 64,   // slightly more overlap for large chunks
  respectStructure: true,
};

// ── Context Pack ──

export type InclusionReason =
  | 'pinned'
  | 'locked'
  | 'highlight'
  | 'search_hit'
  | 'neighbor'
  | 'manual'
  | 'summary_fallback';

export interface ContextPackItem {
  chunkId: string;
  docId: string;
  text: string;
  structuralPath: string[];
  tokenEstimate: number;
  inclusionReason: InclusionReason;
  score?: number;
  pinned: boolean;
  locked: boolean;
}

export interface ContextPack {
  id: string;
  items: ContextPackItem[];
  totalTokens: number;
  budgetTokens: number;
  sourceFileIds: string[];
  inclusionReasons: InclusionReason[];
  createdAt: string;
  sessionId?: string;
}

// ── Search ──

export type SearchMode = 'lexical' | 'semantic' | 'hybrid';

export interface SearchQuery {
  text: string;
  maxResults?: number;
  docFilter?: string[];          // filter to specific doc IDs
  mode?: SearchMode;
}

export interface ChunkSearchHit {
  chunk: DocumentChunk;
  score: number;
  matchType: SearchMode;
  whyMatched: string;
  highlights: Array<{ line: number; text: string }>;
}

export interface GroupedSearchResults {
  query: string;
  totalHits: number;
  groups: Array<{
    docId: string;
    filename: string;
    hits: ChunkSearchHit[];
  }>;
}

// ── Review Session ──

export interface ReviewSession {
  sessionId: string;
  activeFileId: string | null;
  selectedChunkIds: string[];
  pinnedChunkIds: string[];
  lockedChunkIds: string[];
  activeQuery: string | null;
  activeContextPackId: string | null;
  notes: Array<{ chunkId: string; text: string; createdAt: string }>;
  createdAt: string;
  updatedAt: string;
}

// ── Summaries ──

export interface ChunkSummary {
  summaryId: string;
  targetType: 'chunk' | 'node' | 'document';
  targetId: string;
  summaryText: string;
  sourceChunkIds: string[];
  createdAt: string;
}

// ── Workspace Status ──

export interface WorkspaceStatus {
  documentCount: number;
  chunkCount: number;
  embeddedChunkCount: number;
  highlightCount: number;
  activePackId: string | null;
  activePackTokens: number;
  indexHealthy: boolean;
}
