import crypto from 'crypto';

export const WORK_NODE_TYPES = ['WorkItem', 'Decision', 'OpenQuestion', 'Deprecation', 'ActionLog', 'VetoEvent', 'WorkExecutionEvent', 'WorkResolutionEvent'] as const;
export type WorkNodeType = typeof WORK_NODE_TYPES[number];
export type ProposableWorkType = Exclude<WorkNodeType, 'ActionLog' | 'VetoEvent' | 'WorkExecutionEvent' | 'WorkResolutionEvent'>;

export const WORK_STATUSES = ['proposed', 'accepted', 'rejected', 'deferred', 'done'] as const;
export type WorkStatus = typeof WORK_STATUSES[number];

export const WORK_MODES = ['COMPANION', 'ENGINEER', 'WRITING'] as const;
export type WorkMode = typeof WORK_MODES[number];

export type WorkActor = 'agent:human' | 'agent:alois' | 'system';

export type WorkActionType = 'linkDocs' | 'tagDeprecation' | 'markDone';

export interface LinkDocsPayload {
  fromDocId: string;
  toDocId: string;
  rel?: string;
}

export interface TagDeprecationPayload {
  docId: string;
  reason?: string;
}

export type WorkAction =
  | { actionType: 'linkDocs'; payload: LinkDocsPayload }
  | { actionType: 'tagDeprecation'; payload: TagDeprecationPayload }
  | { actionType: 'markDone'; payload: Record<string, never> };

export const WORK_RESOLUTION_TYPES = ['confirmed_duplicate', 'false_positive', 'needs_human_review', 'merged', 'other'] as const;
export type WorkResolutionType = typeof WORK_RESOLUTION_TYPES[number];

export interface WorkLifecycleData {
  status: WorkStatus;
  proposedBy: WorkActor;
  acceptedBy?: 'agent:alois' | null;
  consentToken?: string | null;
  mode?: WorkMode;
  [key: string]: unknown;
}

export interface WorkNodeRecord {
  '@id': string;
  '@type': WorkNodeType;
  created: string;
  modified: string;
  data: WorkLifecycleData;
  [predicate: string]: unknown;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newNodeId(prefix: string): string {
  const safePrefix = (prefix || 'node').toLowerCase().replace(/[^a-z0-9:_-]/g, '');
  return `${safePrefix}:${crypto.randomUUID()}`;
}

export function createActionLog(
  eventType: string,
  actor: WorkActor,
  targetId: string,
  details: Record<string, unknown> = {},
  relatedTo: string[] = []
): WorkNodeRecord {
  const stamp = nowIso();
  const related = Array.from(new Set([targetId, ...relatedTo].filter(Boolean)));
  const edgeRefs = related.map(id => ({ '@id': id, created: stamp }));

  return {
    '@id': newNodeId('action'),
    '@type': 'ActionLog',
    created: stamp,
    modified: stamp,
    data: {
      status: 'done',
      proposedBy: actor,
      eventType,
      actor,
      targetId,
      details,
    },
    ...(edgeRefs.length > 0 ? { relatedTo: edgeRefs } : {}),
    reflectsOn: [{ '@id': targetId, created: stamp }],
  };
}
