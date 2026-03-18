// communion/docs/reviewStore.ts
// In-memory ReviewSession state management.
// A session tracks the user's active workspace: which file is open,
// which chunks are selected/pinned/locked, the active query, and notes.

import crypto from 'crypto';
import { ReviewSession } from './types';

export class ReviewStore {
  private sessions = new Map<string, ReviewSession>();

  createSession(fileId?: string | null): ReviewSession {
    const session: ReviewSession = {
      sessionId: crypto.randomUUID(),
      activeFileId: fileId ?? null,
      selectedChunkIds: [],
      pinnedChunkIds: [],
      lockedChunkIds: [],
      activeQuery: null,
      activeContextPackId: null,
      notes: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  getSession(sessionId: string): ReviewSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  updateSession(sessionId: string, patch: Partial<ReviewSession>): ReviewSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    // Protect read-only fields
    const { sessionId: _id, createdAt: _c, ...safe } = patch as any;
    Object.assign(session, safe, { updatedAt: new Date().toISOString() });
    return session;
  }

  addNote(sessionId: string, chunkId: string, text: string): ReviewSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    session.notes.push({ chunkId, text, createdAt: new Date().toISOString() });
    session.updatedAt = new Date().toISOString();
    return session;
  }

  listSessions(): ReviewSession[] {
    return Array.from(this.sessions.values()).sort(
      (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    );
  }

  deleteSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }
}
