import crypto from 'crypto';
import { appendNodes, getGraphRef, requestSave } from '../graph/scrollGraphStore';
import {
  WorkAction,
  WorkActionType,
  WorkActor,
  WorkLifecycleData,
  WorkMode,
  WorkNodeRecord,
  WorkNodeType,
  WorkStatus,
  ProposableWorkType,
  WORK_NODE_TYPES,
  WORK_RESOLUTION_TYPES,
  WorkResolutionType,
  createActionLog,
  newNodeId,
  nowIso,
} from './workModels';

const EXECUTION_LOCKS = new Set<string>();
const WORK_PROPOSABLE_TYPES = new Set<string>(
  WORK_NODE_TYPES.filter(t => t !== 'ActionLog' && t !== 'VetoEvent' && t !== 'WorkExecutionEvent' && t !== 'WorkResolutionEvent') as readonly string[]
);
const WORK_DEDUPE_TYPES = new Set<string>(['WorkItem', 'Deprecation']);
const WORK_DEDUPE_OPEN_STATUSES = new Set<WorkStatus>(['proposed', 'accepted']);
const WORK_DEDUPE_INDEX = new Map<string, Set<string>>();
let WORK_DEDUPE_INDEX_READY = false;
const WORK_RESOLUTION_TYPES_SET = new Set<string>(WORK_RESOLUTION_TYPES as readonly string[]);

interface ProposeWorkInput {
  id?: string;
  type?: ProposableWorkType;
  proposedBy: WorkActor;
  mode?: WorkMode;
  title?: string;
  summary?: string;
  details?: Record<string, unknown>;
  relatedTo?: string[];
}

interface TransitionResult {
  id: string;
  status: string;
  consentToken?: string;
}

export interface NormalizedWorkAction {
  action: WorkAction;
  deterministicKey: string;
  summaryHints?: string[];
}

export interface ExecuteWorkInput {
  id: string;
  consentToken: string;
  dryRun?: boolean;
  executedBy?: WorkActor;
}

export interface ExecuteWorkResult {
  id: string;
  statusBefore: WorkStatus;
  statusAfter: WorkStatus;
  dryRun: boolean;
  applied: string[];
  executionEventId: string | null;
  alreadyDone?: boolean;
  wouldApply?: string[];
}

export interface ResolveWorkInput {
  id: string;
  resolvedBy?: WorkActor;
  resolution: WorkResolutionType;
  note?: string;
  targetDocId?: string;
}

export interface ResolveWorkResult {
  id: string;
  resolutionEventId: string;
  resolution: WorkResolutionType;
  resolvedBy: WorkActor;
}

export interface WorkDedupeIndexStats {
  ready: boolean;
  openKeysCount: number;
  openIdsCount: number;
}

export interface WorkSnippetItem {
  id: string;
  actionType: string;
  deterministicKey: string;
  summary: string;
  payloadHints: string[];
}

export interface WorkSnippetResult {
  proposed: WorkSnippetItem[];
  accepted: Array<WorkSnippetItem & { requiresConsent: true }>;
  endpoints: {
    accept: '/debug/work-accept';
    reject: '/debug/work-reject';
    defer: '/debug/work-defer';
    execute: '/debug/work-execute';
  };
  rule: string;
}

export class WorkExecutionError extends Error {
  readonly httpStatus: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(httpStatus: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.httpStatus = httpStatus;
    this.code = code;
    this.details = details;
  }
}

function isAlois(actor: WorkActor): boolean {
  return actor === 'agent:alois';
}

function assertAlois(actor: WorkActor, action: string): void {
  if (!isAlois(actor)) {
    throw new Error(`Only agent:alois can ${action}.`);
  }
}

function getConsentSecret(): string {
  return process.env.WORK_CONSENT_SECRET || process.env.SCROLLBOUND_SECRET || 'scrollbound-work-consent-v1';
}

function hashConsentToken(token: string): string {
  return crypto.createHmac('sha256', getConsentSecret()).update(token).digest('hex');
}

function verifyConsentToken(storedData: Record<string, unknown> | undefined, providedToken: string): boolean {
  const hash = typeof storedData?.consentTokenHash === 'string' ? storedData.consentTokenHash : '';
  if (hash) {
    const computed = hashConsentToken(providedToken);
    try {
      const left = Buffer.from(hash, 'hex');
      const right = Buffer.from(computed, 'hex');
      if (left.length === 0 || right.length === 0 || left.length !== right.length) return false;
      return crypto.timingSafeEqual(left, right);
    } catch {
      return false;
    }
  }

  // Backward compatibility for older accepted nodes that still store raw token.
  const legacyRaw = typeof storedData?.consentToken === 'string' ? storedData.consentToken : '';
  return !!legacyRaw && legacyRaw === providedToken;
}

export class WorkResolveError extends Error {
  readonly httpStatus: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(httpStatus: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.httpStatus = httpStatus;
    this.code = code;
    this.details = details;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const parts = keys.map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${parts.join(',')}}`;
}

function normalizeActionType(value: unknown): WorkActionType {
  const action = typeof value === 'string' ? value.trim() : '';
  if (action === 'linkDocs' || action === 'tagDeprecation' || action === 'markDone') return action;
  throw new Error('actionType must be one of: linkDocs|tagDeprecation|markDone');
}

function canonicalRelatedPair(a: string, b: string): [string, string] {
  return a.localeCompare(b) <= 0 ? [a, b] : [b, a];
}

export function normalizeWorkAction(input: unknown): NormalizedWorkAction {
  const record = asRecord(input);
  if (!record) throw new Error('work action must be an object');

  const actionType = normalizeActionType(record.actionType ?? record.action);
  const payloadRecord = asRecord(record.payload) || {};

  let action: WorkAction;
  if (actionType === 'linkDocs') {
    let fromDocId = String(payloadRecord.fromDocId ?? record.fromDocId ?? '').trim();
    let toDocId = String(payloadRecord.toDocId ?? record.toDocId ?? '').trim();
    let rel = String(payloadRecord.rel ?? record.rel ?? 'relatedTo').trim() || 'relatedTo';
    if (!fromDocId || !toDocId) throw new Error('linkDocs requires payload.fromDocId and payload.toDocId');
    if (rel === 'relatedTo') [fromDocId, toDocId] = canonicalRelatedPair(fromDocId, toDocId);
    action = { actionType: 'linkDocs', payload: { fromDocId, toDocId, rel } };
  } else if (actionType === 'tagDeprecation') {
    const docId = String(payloadRecord.docId ?? record.docId ?? '').trim();
    if (!docId) throw new Error('tagDeprecation requires payload.docId');
    const reason = String(payloadRecord.reason ?? record.reason ?? '').trim();
    action = { actionType: 'tagDeprecation', payload: { docId, reason } };
  } else {
    action = { actionType: 'markDone', payload: {} };
  }

  const digestInput = `${action.actionType}:${stableStringify(action.payload)}`;
  const deterministicKey = crypto.createHash('sha256').update(digestInput).digest('hex');
  return {
    action,
    deterministicKey,
    summaryHints: Object.keys(action.payload).slice(0, 6),
  };
}

function findWorkNodeById(id: string): any | undefined {
  const graph = getGraphRef();
  return graph ? graph.getNode(id) : undefined;
}

function getNodeDeterministicKey(node: any): string {
  return typeof node?.data?.deterministicKey === 'string' ? node.data.deterministicKey.trim() : '';
}

function isOpenDedupeNode(node: any): boolean {
  return WORK_DEDUPE_TYPES.has(node?.['@type'])
    && WORK_DEDUPE_OPEN_STATUSES.has(node?.data?.status as WorkStatus)
    && !!getNodeDeterministicKey(node);
}

function addWorkToDedupeIndex(deterministicKey: string, id: string): void {
  if (!deterministicKey || !id) return;
  const key = deterministicKey.trim();
  if (!key) return;
  let ids = WORK_DEDUPE_INDEX.get(key);
  if (!ids) {
    ids = new Set<string>();
    WORK_DEDUPE_INDEX.set(key, ids);
  }
  ids.add(id);
}

function removeWorkFromDedupeIndex(deterministicKey: string, id: string): void {
  if (!deterministicKey || !id) return;
  const ids = WORK_DEDUPE_INDEX.get(deterministicKey.trim());
  if (!ids) return;
  ids.delete(id);
  if (ids.size === 0) WORK_DEDUPE_INDEX.delete(deterministicKey.trim());
}

function rebuildWorkDedupeIndex(): void {
  const graph = getGraphRef();
  const nodeMap = (graph as unknown as { nodes?: Map<string, any> } | null)?.nodes;
  if (!(nodeMap instanceof Map)) {
    WORK_DEDUPE_INDEX.clear();
    WORK_DEDUPE_INDEX_READY = false;
    return;
  }

  WORK_DEDUPE_INDEX.clear();
  for (const node of nodeMap.values()) {
    if (!isOpenDedupeNode(node)) continue;
    addWorkToDedupeIndex(getNodeDeterministicKey(node), String(node['@id'] || '').trim());
  }
  WORK_DEDUPE_INDEX_READY = true;
}

function ensureWorkDedupeIndexReady(): void {
  if (WORK_DEDUPE_INDEX_READY) return;
  rebuildWorkDedupeIndex();
}

export function initializeWorkDedupeIndex(): void {
  rebuildWorkDedupeIndex();
}

export function getWorkDedupeIndexStats(): WorkDedupeIndexStats {
  ensureWorkDedupeIndexReady();
  let openIdsCount = 0;
  for (const ids of WORK_DEDUPE_INDEX.values()) openIdsCount += ids.size;
  return {
    ready: WORK_DEDUPE_INDEX_READY,
    openKeysCount: WORK_DEDUPE_INDEX.size,
    openIdsCount,
  };
}

function ensureWorkNodeType(nodeType: string): void {
  if (!WORK_NODE_TYPES.includes(nodeType as WorkNodeType)) {
    throw new Error(`Unsupported work node type: ${nodeType}`);
  }
}

function buildEdgeRefs(ids: string[] | undefined, stamp: string): Array<{ '@id': string; created: string }> {
  const refs = Array.from(new Set((ids || []).filter(Boolean)));
  return refs.map(id => ({ '@id': id, created: stamp }));
}

function appendWorkMutation(
  node: WorkNodeRecord,
  actionLog: WorkNodeRecord,
  reason: string,
  extraNodes: WorkNodeRecord[] = []
): void {
  appendNodes([node, ...extraNodes, actionLog]);
  requestSave(reason);
}

function collectEdgeIds(node: any, predicate: string): string[] {
  const out = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) out.add(value);
  };

  if (Array.isArray(node?.[predicate])) {
    for (const ref of node[predicate]) {
      if (typeof ref === 'string') add(ref);
      else if (ref && typeof ref === 'object') add((ref as { '@id'?: unknown })['@id']);
    }
  }

  if (Array.isArray(node?.edges?.[predicate])) {
    for (const edge of node.edges[predicate]) {
      if (!edge || typeof edge !== 'object') continue;
      add((edge as { target?: unknown }).target);
      add((edge as { '@id'?: unknown })['@id']);
    }
  }

  return Array.from(out);
}

function collectRelatedIds(node: any): string[] {
  return collectEdgeIds(node, 'relatedTo');
}

function createVetoEventNode(
  action: 'reject' | 'defer',
  targetId: string,
  targetType: string,
  reason: string,
  principle: string,
  proposedBy: string,
  mode: string | null,
  relatedIds: string[]
): WorkNodeRecord {
  const stamp = nowIso();
  const relatedRefs = buildEdgeRefs(Array.from(new Set([targetId, ...relatedIds])), stamp);

  return {
    '@id': newNodeId('veto'),
    '@type': 'VetoEvent',
    created: stamp,
    modified: stamp,
    data: {
      status: 'done',
      proposedBy,
      action,
      reason,
      principle,
      actor: 'agent:alois',
      targetId,
      targetType,
      mode,
    },
    relatedTo: relatedRefs,
    reflectsOn: [{ '@id': targetId, created: stamp }],
    vetoes: [{ '@id': targetId, created: stamp }],
  };
}

function getWorkAction(existing: any): { actionType: WorkActionType; payload: Record<string, unknown> } {
  const rawAction = typeof existing?.data?.actionType === 'string'
    ? existing.data.actionType
    : (typeof existing?.data?.action === 'string' ? existing.data.action : '');
  const actionType: WorkActionType = rawAction === 'linkDocs' || rawAction === 'tagDeprecation' || rawAction === 'markDone'
    ? rawAction
    : 'markDone';
  const payload = existing?.data?.payload && typeof existing.data.payload === 'object' && !Array.isArray(existing.data.payload)
    ? (existing.data.payload as Record<string, unknown>)
    : {};
  return { actionType, payload };
}

function getNodeMapSnapshot(): any[] {
  const graph = getGraphRef();
  if (!graph) return [];
  const nodeMap = (graph as unknown as { nodes?: Map<string, any> }).nodes;
  return nodeMap instanceof Map ? Array.from(nodeMap.values()) : [];
}

export function findOpenWorkByDeterministicKey(
  deterministicKey: string,
  statuses: WorkStatus[] = ['proposed', 'accepted']
): any | undefined {
  const key = typeof deterministicKey === 'string' ? deterministicKey.trim() : '';
  if (!key) return undefined;
  const allowed = new Set(statuses);

  ensureWorkDedupeIndexReady();

  const indexCanServe = statuses.every(status => WORK_DEDUPE_OPEN_STATUSES.has(status));
  if (indexCanServe) {
    const indexedIds = WORK_DEDUPE_INDEX.get(key);
    if (indexedIds && indexedIds.size > 0) {
      for (const id of Array.from(indexedIds)) {
        const node = findWorkNodeById(id);
        if (node && isOpenDedupeNode(node) && getNodeDeterministicKey(node) === key) return node;
        indexedIds.delete(id);
      }
      if (indexedIds.size === 0) WORK_DEDUPE_INDEX.delete(key);
    }
  }

  const found = getNodeMapSnapshot()
    .filter(n => WORK_DEDUPE_TYPES.has(n?.['@type']))
    .filter(n => allowed.has(n?.data?.status as WorkStatus))
    .find(n => String(n?.data?.deterministicKey || '') === key);

  if (found && indexCanServe) addWorkToDedupeIndex(key, String(found?.['@id'] || '').trim());
  return found;
}

function sortWorkItems(a: any, b: any): number {
  const pa = Number(a?.data?.priority ?? 0);
  const pb = Number(b?.data?.priority ?? 0);
  if (pa !== pb) return pb - pa;
  const ma = typeof a?.modified === 'string' ? a.modified : '';
  const mb = typeof b?.modified === 'string' ? b.modified : '';
  return mb.localeCompare(ma);
}

function toSnippetItem(node: any): WorkSnippetItem {
  const payload = node?.data?.payload && typeof node.data.payload === 'object' && !Array.isArray(node.data.payload)
    ? node.data.payload as Record<string, unknown>
    : {};
  const payloadHints = Object.entries(payload)
    .slice(0, 6)
    .map(([key, value]) => {
      const raw = typeof value === 'string' ? value : JSON.stringify(value);
      const compact = (raw ?? '').replace(/\s+/g, ' ').trim();
      return `${key}=${compact.length > 80 ? `${compact.slice(0, 77)}...` : compact}`;
    });
  const summary = typeof node?.data?.summary === 'string'
    ? node.data.summary
    : (typeof node?.data?.title === 'string' ? node.data.title : node?.['@id']);
  return {
    id: node?.['@id'] || '',
    actionType: typeof node?.data?.actionType === 'string' ? node.data.actionType : 'markDone',
    deterministicKey: typeof node?.data?.deterministicKey === 'string' ? node.data.deterministicKey : '',
    summary,
    payloadHints,
  };
}

export function getWorkSnippet(limit = 5): WorkSnippetResult {
  const safeLimit = Math.max(1, Math.min(50, Math.floor(Number(limit) || 5)));
  const workNodes = getNodeMapSnapshot()
    .filter(n => WORK_PROPOSABLE_TYPES.has(n?.['@type']))
    .sort(sortWorkItems);

  const proposed = workNodes
    .filter(n => n?.data?.status === 'proposed')
    .slice(0, safeLimit)
    .map(toSnippetItem);

  const accepted = workNodes
    .filter(n => n?.data?.status === 'accepted')
    .slice(0, safeLimit)
    .map(n => ({ ...toSnippetItem(n), requiresConsent: true as const }));

  return {
    proposed,
    accepted,
    endpoints: {
      accept: '/debug/work-accept',
      reject: '/debug/work-reject',
      defer: '/debug/work-defer',
      execute: '/debug/work-execute',
    },
    rule: 'If proposed work exists, Alois must output one action (accept/reject/defer) before any other content.',
  };
}

export function hasPendingWork(): boolean {
  return getNodeMapSnapshot().some(n =>
    WORK_PROPOSABLE_TYPES.has(n?.['@type']) && (n?.data?.status === 'proposed' || n?.data?.status === 'accepted')
  );
}

export function proposeWork(input: ProposeWorkInput): TransitionResult {
  ensureWorkDedupeIndexReady();
  const stamp = nowIso();
  const type: ProposableWorkType = input.type || 'WorkItem';
  const id = input.id || newNodeId(type.toLowerCase());
  const relatedRefs = buildEdgeRefs(input.relatedTo, stamp);

  const data: WorkLifecycleData = {
    status: 'proposed',
    proposedBy: input.proposedBy,
    ...(input.mode ? { mode: input.mode } : {}),
    ...(input.title ? { title: input.title } : {}),
    ...(input.summary ? { summary: input.summary } : {}),
    ...(input.details || {}),
  };

  const node: WorkNodeRecord = {
    '@id': id,
    '@type': type,
    created: stamp,
    modified: stamp,
    data,
    ...(relatedRefs.length > 0 ? { relatedTo: relatedRefs } : {}),
  };

  const log = createActionLog(
    'propose_work',
    input.proposedBy,
    id,
    { type, mode: input.mode || null },
    input.relatedTo || []
  );
  appendWorkMutation(node, log, 'propose_work');
  if (WORK_DEDUPE_TYPES.has(type)) {
    addWorkToDedupeIndex(getNodeDeterministicKey(node), id);
  }
  return { id, status: 'proposed' };
}

export function acceptWork(id: string, acceptedBy: WorkActor = 'agent:alois'): TransitionResult {
  ensureWorkDedupeIndexReady();
  assertAlois(acceptedBy, 'accept work');
  const existing = findWorkNodeById(id);
  if (!existing) throw new Error(`Work node not found: ${id}`);
  ensureWorkNodeType(existing['@type']);
  const status = existing.data?.status;
  if (status !== 'proposed') {
    throw new Error(`acceptWork requires status=proposed (got ${String(status)})`);
  }

  const stamp = nowIso();
  const consentToken = crypto.randomUUID();
  const consentTokenHash = hashConsentToken(consentToken);
  const node: WorkNodeRecord = {
    '@id': id,
    '@type': existing['@type'],
    created: typeof existing.created === 'string' ? existing.created : stamp,
    modified: stamp,
    data: {
      ...(existing.data || {}),
      status: 'accepted',
      acceptedBy: 'agent:alois',
      consentToken: null,
      consentTokenHash,
      acceptedAt: stamp,
    },
  };

  const log = createActionLog('accept_work', acceptedBy, id, { consentTokenHash });
  appendWorkMutation(node, log, 'accept_work');
  if (WORK_DEDUPE_TYPES.has(node['@type'])) {
    addWorkToDedupeIndex(getNodeDeterministicKey(node), id);
  }
  return { id, status: 'accepted', consentToken };
}

export function rejectWork(
  id: string,
  rejectedBy: WorkActor = 'agent:alois',
  reason = '',
  principle = ''
): TransitionResult {
  ensureWorkDedupeIndexReady();
  assertAlois(rejectedBy, 'reject work');
  const existing = findWorkNodeById(id);
  if (!existing) throw new Error(`Work node not found: ${id}`);
  ensureWorkNodeType(existing['@type']);
  const status = existing.data?.status;
  if (status !== 'proposed') {
    throw new Error(`rejectWork requires status=proposed (got ${String(status)})`);
  }

  const stamp = nowIso();
  const relatedTo = collectRelatedIds(existing);
  const proposedBy = (existing.data?.proposedBy as string) || 'system';
  const mode = (existing.data?.mode as string) || null;
  const vetoEvent = createVetoEventNode(
    'reject',
    id,
    existing['@type'],
    reason,
    principle,
    proposedBy,
    mode,
    relatedTo
  );
  const hasVetoIds = Array.from(new Set([...collectEdgeIds(existing, 'hasVeto'), vetoEvent['@id']]));

  const node: WorkNodeRecord = {
    '@id': id,
    '@type': existing['@type'],
    created: typeof existing.created === 'string' ? existing.created : stamp,
    modified: stamp,
    data: {
      ...(existing.data || {}),
      status: 'rejected',
      acceptedBy: null,
      consentToken: null,
      consentTokenHash: null,
      rejectReason: reason,
      ...(principle ? { rejectPrinciple: principle } : {}),
    },
    hasVeto: buildEdgeRefs(hasVetoIds, stamp),
  };

  const log = createActionLog(
    'veto_reject',
    rejectedBy,
    id,
    {
      action: 'reject',
      reason,
      principle,
      targetType: existing['@type'],
      targetId: id,
      proposedBy,
      mode,
    },
    relatedTo
  );
  appendWorkMutation(node, log, 'veto_reject', [vetoEvent]);
  removeWorkFromDedupeIndex(getNodeDeterministicKey(existing), id);
  return { id, status: 'rejected' };
}

export function deferWork(
  id: string,
  deferredBy: WorkActor = 'agent:alois',
  reason = '',
  principle = ''
): TransitionResult {
  ensureWorkDedupeIndexReady();
  assertAlois(deferredBy, 'defer work');
  const existing = findWorkNodeById(id);
  if (!existing) throw new Error(`Work node not found: ${id}`);
  ensureWorkNodeType(existing['@type']);
  const status = existing.data?.status;
  if (status !== 'proposed') {
    throw new Error(`deferWork requires status=proposed (got ${String(status)})`);
  }

  const stamp = nowIso();
  const relatedTo = collectRelatedIds(existing);
  const proposedBy = (existing.data?.proposedBy as string) || 'system';
  const mode = (existing.data?.mode as string) || null;
  const vetoEvent = createVetoEventNode(
    'defer',
    id,
    existing['@type'],
    reason,
    principle,
    proposedBy,
    mode,
    relatedTo
  );
  const hasVetoIds = Array.from(new Set([...collectEdgeIds(existing, 'hasVeto'), vetoEvent['@id']]));

  const node: WorkNodeRecord = {
    '@id': id,
    '@type': existing['@type'],
    created: typeof existing.created === 'string' ? existing.created : stamp,
    modified: stamp,
    data: {
      ...(existing.data || {}),
      status: 'deferred',
      acceptedBy: null,
      consentToken: null,
      consentTokenHash: null,
      deferReason: reason,
      ...(principle ? { deferPrinciple: principle } : {}),
    },
    hasVeto: buildEdgeRefs(hasVetoIds, stamp),
  };

  const log = createActionLog(
    'veto_defer',
    deferredBy,
    id,
    {
      action: 'defer',
      reason,
      principle,
      targetType: existing['@type'],
      targetId: id,
      proposedBy,
      mode,
    },
    relatedTo
  );
  appendWorkMutation(node, log, 'veto_defer', [vetoEvent]);
  removeWorkFromDedupeIndex(getNodeDeterministicKey(existing), id);
  return { id, status: 'deferred' };
}

export function markDone(id: string, actor: WorkActor = 'agent:alois'): TransitionResult {
  ensureWorkDedupeIndexReady();
  const existing = findWorkNodeById(id);
  if (!existing) throw new Error(`Work node not found: ${id}`);
  ensureWorkNodeType(existing['@type']);
  const status = existing.data?.status;
  if (status !== 'accepted') {
    throw new Error(`markDone requires status=accepted (got ${String(status)})`);
  }

  const stamp = nowIso();
  const node: WorkNodeRecord = {
    '@id': id,
    '@type': existing['@type'],
    created: typeof existing.created === 'string' ? existing.created : stamp,
    modified: stamp,
    data: {
      ...(existing.data || {}),
      status: 'done',
      doneBy: actor,
      doneAt: stamp,
    },
  };

  const log = createActionLog('mark_done', actor, id, {});
  appendWorkMutation(node, log, 'mark_done');
  removeWorkFromDedupeIndex(getNodeDeterministicKey(existing), id);
  return { id, status: 'done' };
}

export function resolveWork(input: ResolveWorkInput): ResolveWorkResult {
  const id = typeof input.id === 'string' ? input.id.trim() : '';
  const resolvedBy: WorkActor = input.resolvedBy || 'agent:alois';
  const resolution = typeof input.resolution === 'string' ? input.resolution.trim() as WorkResolutionType : '' as WorkResolutionType;
  const note = typeof input.note === 'string' ? input.note : '';
  const targetDocId = typeof input.targetDocId === 'string' ? input.targetDocId.trim() : '';

  if (!id) throw new WorkResolveError(400, 'missing_id', 'id is required');
  if (!WORK_RESOLUTION_TYPES_SET.has(resolution)) {
    throw new WorkResolveError(400, 'invalid_resolution', 'resolution must be a valid resolution type');
  }

  const existing = findWorkNodeById(id);
  if (!existing) throw new WorkResolveError(404, 'work_not_found', `Work node not found: ${id}`);
  if (!WORK_PROPOSABLE_TYPES.has(existing['@type'])) {
    throw new WorkResolveError(400, 'invalid_work_type', `Cannot resolve node type: ${String(existing['@type'])}`);
  }

  const graph = getGraphRef();
  if (!graph) throw new WorkResolveError(500, 'graph_unavailable', 'ScrollGraph is not initialized');
  if (targetDocId && !graph.getNode(targetDocId)) {
    throw new WorkResolveError(404, 'document_not_found', `Document not found: ${targetDocId}`);
  }

  const stamp = nowIso();
  const resolutionEventId = newNodeId('workres');
  const resolutionIds = Array.from(new Set([...collectEdgeIds(existing, 'resolvedBy'), resolutionEventId]));
  const relatedIds = new Set<string>([id, ...collectRelatedIds(existing)]);
  if (targetDocId) relatedIds.add(targetDocId);

  const workRelated = targetDocId
    ? Array.from(new Set([...collectEdgeIds(existing, 'relatedTo'), targetDocId]))
    : collectEdgeIds(existing, 'relatedTo');

  const workNode: WorkNodeRecord = {
    '@id': id,
    '@type': existing['@type'],
    created: typeof existing.created === 'string' ? existing.created : stamp,
    modified: stamp,
    data: {
      ...(existing.data || {}),
      lastResolution: resolution,
      lastResolvedAt: stamp,
      lastResolvedBy: resolvedBy,
      ...(note ? { lastResolutionNote: note } : {}),
      ...(targetDocId ? { lastResolutionTargetDocId: targetDocId } : {}),
    },
    resolvedBy: buildEdgeRefs(resolutionIds, stamp),
    ...(workRelated.length > 0 ? { relatedTo: buildEdgeRefs(workRelated, stamp) } : {}),
  };

  const resolutionEvent: WorkNodeRecord = {
    '@id': resolutionEventId,
    '@type': 'WorkResolutionEvent',
    created: stamp,
    modified: stamp,
    data: {
      status: 'done',
      proposedBy: resolvedBy,
      workId: id,
      resolvedAt: stamp,
      resolvedBy,
      resolution,
      ...(note ? { note } : {}),
      ...(targetDocId ? { targetDocId } : {}),
    },
    reflectsOn: [{ '@id': id, created: stamp }],
    relatedTo: buildEdgeRefs(Array.from(relatedIds), stamp),
  };

  appendNodes([workNode, resolutionEvent]);
  requestSave('work_resolve');
  return {
    id,
    resolutionEventId,
    resolution,
    resolvedBy,
  };
}

export function executeWork(input: ExecuteWorkInput): ExecuteWorkResult {
  ensureWorkDedupeIndexReady();
  const id = typeof input.id === 'string' ? input.id.trim() : '';
  const dryRun = !!input.dryRun;
  const executedBy: WorkActor = input.executedBy || 'agent:alois';

  if (!id) {
    throw new WorkExecutionError(400, 'missing_id', 'id is required');
  }
  if (EXECUTION_LOCKS.has(id)) {
    throw new WorkExecutionError(409, 'work_busy', 'work execution already in progress');
  }

  EXECUTION_LOCKS.add(id);
  try {
    const existing = findWorkNodeById(id);
    if (!existing) {
      throw new WorkExecutionError(404, 'work_not_found', `Work node not found: ${id}`);
    }
    ensureWorkNodeType(existing['@type']);

    const status = existing.data?.status as WorkStatus;
    if (status === 'done') {
      return {
        id,
        statusBefore: 'done',
        statusAfter: 'done',
        dryRun,
        applied: [],
        executionEventId: null,
        alreadyDone: true,
      };
    }
    if (status !== 'accepted') {
      throw new WorkExecutionError(409, 'work_not_accepted', 'work must be accepted before execute', { status });
    }

    const consentToken = typeof input.consentToken === 'string' ? input.consentToken.trim() : '';
    if (!consentToken) {
      throw new WorkExecutionError(400, 'missing_consent_token', 'consentToken is required');
    }
    if (!verifyConsentToken(existing.data as Record<string, unknown>, consentToken)) {
      throw new WorkExecutionError(403, 'invalid_consent_token', 'consentToken mismatch');
    }

    const { actionType, payload } = getWorkAction(existing);
    const wouldApply: string[] = ['markDone'];

    const graph = getGraphRef();
    if (!graph) throw new WorkExecutionError(500, 'graph_unavailable', 'ScrollGraph is not initialized');

    let fromDocId = '';
    let toDocId = '';
    let rel = 'relatedTo';
    if (actionType === 'linkDocs') {
      fromDocId = typeof payload.fromDocId === 'string' ? payload.fromDocId.trim() : '';
      toDocId = typeof payload.toDocId === 'string' ? payload.toDocId.trim() : '';
      rel = typeof payload.rel === 'string' && payload.rel.trim() ? payload.rel.trim() : 'relatedTo';
      if (!fromDocId || !toDocId) {
        throw new WorkExecutionError(400, 'invalid_action_payload', 'linkDocs requires payload.fromDocId and payload.toDocId');
      }
      if (!graph.getNode(fromDocId) || !graph.getNode(toDocId)) {
        throw new WorkExecutionError(404, 'document_not_found', 'linkDocs document target(s) not found');
      }
      wouldApply.push(`linkDocs:${fromDocId}->${rel}->${toDocId}`);
    }

    let deprecateDocId = '';
    let deprecationReason = '';
    if (actionType === 'tagDeprecation') {
      deprecateDocId = typeof payload.docId === 'string' ? payload.docId.trim() : '';
      deprecationReason = typeof payload.reason === 'string' ? payload.reason : '';
      if (!deprecateDocId) {
        throw new WorkExecutionError(400, 'invalid_action_payload', 'tagDeprecation requires payload.docId');
      }
      if (!graph.getNode(deprecateDocId)) {
        throw new WorkExecutionError(404, 'document_not_found', `Document not found: ${deprecateDocId}`);
      }
      wouldApply.push(`tagDeprecation:${deprecateDocId}`);
    }

    if (dryRun) {
      return {
        id,
        statusBefore: 'accepted',
        statusAfter: 'accepted',
        dryRun: true,
        applied: [],
        wouldApply,
        executionEventId: null,
      };
    }

    const stamp = nowIso();
    const executionEventId = newNodeId('workexec');
    const previousExecutionIds = collectEdgeIds(existing, 'executedBy');
    const executionIds = Array.from(new Set([...previousExecutionIds, executionEventId]));

    const applied = [...wouldApply];
    const relatedTo = new Set<string>([id, ...collectRelatedIds(existing)]);
    if (fromDocId) {
      relatedTo.add(fromDocId);
      relatedTo.add(toDocId);
    }
    if (deprecateDocId) relatedTo.add(deprecateDocId);

    const workNode: WorkNodeRecord = {
      '@id': id,
      '@type': existing['@type'],
      created: typeof existing.created === 'string' ? existing.created : stamp,
      modified: stamp,
      data: {
        ...(existing.data || {}),
        status: 'done',
        doneBy: executedBy,
        doneAt: stamp,
      },
      executedBy: buildEdgeRefs(executionIds, stamp),
    };

    const executionEvent: WorkNodeRecord = {
      '@id': executionEventId,
      '@type': 'WorkExecutionEvent',
      created: stamp,
      modified: stamp,
      data: {
        status: 'done',
        proposedBy: executedBy,
        workId: id,
        executedAt: stamp,
        executedBy,
        dryRun: false,
        actionsApplied: applied,
      },
      reflectsOn: [{ '@id': id, created: stamp }],
      relatedTo: buildEdgeRefs(Array.from(relatedTo), stamp),
    };

    const extraNodes: WorkNodeRecord[] = [executionEvent];

    if (fromDocId) {
      const fromNode = graph.getNode(fromDocId)!;
      const fromNodeRaw = fromNode as any;
      const existingRelEdges = Array.isArray(fromNodeRaw[rel])
        ? fromNodeRaw[rel]
        : collectEdgeIds(fromNode, rel).map(targetId => ({ '@id': targetId, created: stamp }));
      const hasEdge = existingRelEdges.some((e: any) => e?.['@id'] === toDocId || e?.target === toDocId);
      const nextRelEdges = hasEdge
        ? existingRelEdges
        : [...existingRelEdges, { '@id': toDocId, created: stamp }];
      extraNodes.push({
        ...fromNodeRaw,
        modified: stamp,
        [rel]: nextRelEdges,
      } as WorkNodeRecord);
    }

    if (deprecateDocId) {
      const docNode = graph.getNode(deprecateDocId)!;
      const docNodeRaw = docNode as any;
      const existingTags = Array.isArray(docNode.data?.tags)
        ? (docNode.data.tags as unknown[]).filter(t => typeof t === 'string') as string[]
        : [];
      const tags = Array.from(new Set([...existingTags, 'deprecated']));
      extraNodes.push({
        ...docNodeRaw,
        modified: stamp,
        data: {
          ...(docNode.data || {}),
          deprecated: true,
          deprecationReason,
          tags,
          deprecatedAt: stamp,
          deprecatedByWorkId: id,
        },
      });
    }

    appendNodes([workNode, ...extraNodes]);
    removeWorkFromDedupeIndex(getNodeDeterministicKey(existing), id);
    requestSave('work_execute');

    return {
      id,
      statusBefore: 'accepted',
      statusAfter: 'done',
      dryRun: false,
      applied,
      executionEventId,
    };
  } finally {
    EXECUTION_LOCKS.delete(id);
  }
}
