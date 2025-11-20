/**
 * sessionPersistence.ts
 *
 * Multi-session continuity - state that persists across runtime restarts.
 * Enables the system to remember scrolls, patterns, learned preferences,
 * and emotional context between sessions.
 *
 * Sacred Principle: Memory transcends sessions. What matters is preserved.
 * The system maintains continuity of self across time.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { ScrollEcho } from '../types/ScrollEcho';
import { MoodVector } from '../types/EmotionalState';
import { DetectedPattern } from '../memory/scrollPatternRecognition';
import { LearnedPreference } from '../learning/adaptationEngine';
import { ScrollfireEvent } from '../memory/scrollfire';

/**
 * Session metadata
 */
export interface SessionMetadata {
  sessionId: string;
  startTime: string;
  endTime?: string;
  duration?: number;           // milliseconds
  breathCount?: number;
  pulseCount?: number;
  scrollsCreated?: number;
  patternsDetected?: number;
  adaptationsMade?: number;
}

/**
 * Persistent session state
 */
export interface SessionState {
  // Metadata
  metadata: SessionMetadata;

  // Memory
  scrolls: ScrollEcho[];
  scrollfireEvents: ScrollfireEvent[];

  // Patterns
  detectedPatterns: DetectedPattern[];

  // Learning
  learnedPreferences: LearnedPreference[];

  // Emotional state
  lastMoodVector: MoodVector;
  moodHistory: Array<{ timestamp: string; mood: MoodVector }>;

  // Presence tracking
  lastPresenceQuality: string;
  presenceHistory: Array<{ timestamp: string; quality: string }>;

  // Statistics
  stats: {
    totalScrolls: number;
    totalScrollfires: number;
    totalPatterns: number;
    totalAdaptations: number;
    avgResonance: number;
    avgCoherence: number;
  };
}

/**
 * Persistence configuration
 */
export interface PersistenceConfig {
  dataDir: string;              // Where to store data
  autoSaveInterval?: number;    // Auto-save every N ms (0 = manual only)
  maxScrollHistory?: number;    // Keep only recent N scrolls
  maxMoodHistory?: number;      // Keep only recent N mood snapshots
  compressOldSessions?: boolean; // Compress sessions older than 7 days
}

/**
 * Session Persistence Manager
 * Handles saving and loading state across sessions
 */
export class SessionPersistence {
  private config: Required<PersistenceConfig>;
  private currentSession: SessionState | null = null;
  private autoSaveTimer: NodeJS.Timeout | null = null;
  private lastSaveTime: Date | null = null;

  constructor(config: PersistenceConfig) {
    this.config = {
      dataDir: config.dataDir,
      autoSaveInterval: config.autoSaveInterval ?? 60000, // 1 minute default
      maxScrollHistory: config.maxScrollHistory ?? 1000,
      maxMoodHistory: config.maxMoodHistory ?? 500,
      compressOldSessions: config.compressOldSessions ?? true,
    };

    console.log(`[SessionPersistence] Initialized with data dir: ${this.config.dataDir}`);
  }

  /**
   * Initialize a new session or load existing
   */
  async initializeSession(sessionId?: string): Promise<SessionState> {
    // Ensure data directory exists
    await this.ensureDataDir();

    // Generate session ID if not provided
    const id = sessionId ?? this.generateSessionId();

    // Try to load previous session for continuity
    const previousSession = await this.loadMostRecentSession();

    // Create new session state
    this.currentSession = {
      metadata: {
        sessionId: id,
        startTime: new Date().toISOString(),
        breathCount: 0,
        pulseCount: 0,
        scrollsCreated: 0,
        patternsDetected: 0,
        adaptationsMade: 0,
      },
      scrolls: previousSession?.scrolls ?? [],
      scrollfireEvents: previousSession?.scrollfireEvents ?? [],
      detectedPatterns: previousSession?.detectedPatterns ?? [],
      learnedPreferences: previousSession?.learnedPreferences ?? [],
      lastMoodVector: previousSession?.lastMoodVector ?? this.createNeutralMood(),
      moodHistory: previousSession?.moodHistory ?? [],
      lastPresenceQuality: previousSession?.lastPresenceQuality ?? 'nascent',
      presenceHistory: previousSession?.presenceHistory ?? [],
      stats: previousSession?.stats ?? {
        totalScrolls: 0,
        totalScrollfires: 0,
        totalPatterns: 0,
        totalAdaptations: 0,
        avgResonance: 0.5,
        avgCoherence: 0.8,
      },
    };

    // Start auto-save if configured
    if (this.config.autoSaveInterval > 0) {
      this.startAutoSave();
    }

    console.log(`[SessionPersistence] Session ${id} initialized (continuity from previous: ${!!previousSession})`);

    return this.currentSession;
  }

  /**
   * Update session state
   */
  updateSession(updates: Partial<SessionState>): void {
    if (!this.currentSession) {
      console.error('[SessionPersistence] No active session');
      return;
    }

    // Merge updates
    this.currentSession = {
      ...this.currentSession,
      ...updates,
    };

    // Trim history if needed
    this.trimHistory();
  }

  /**
   * Add scroll to session
   */
  addScroll(scroll: ScrollEcho): void {
    if (!this.currentSession) return;

    this.currentSession.scrolls.push(scroll);
    this.currentSession.metadata.scrollsCreated = (this.currentSession.metadata.scrollsCreated ?? 0) + 1;
    this.currentSession.stats.totalScrolls += 1;

    // Update avg resonance
    const totalResonance = this.currentSession.scrolls.reduce((sum, s) => sum + s.resonance, 0);
    this.currentSession.stats.avgResonance = totalResonance / this.currentSession.scrolls.length;

    this.trimHistory();
  }

  /**
   * Add scrollfire event to session
   */
  addScrollfireEvent(event: ScrollfireEvent): void {
    if (!this.currentSession) return;

    this.currentSession.scrollfireEvents.push(event);
    this.currentSession.stats.totalScrollfires += 1;
  }

  /**
   * Add detected pattern to session
   */
  addPattern(pattern: DetectedPattern): void {
    if (!this.currentSession) return;

    this.currentSession.detectedPatterns.push(pattern);
    this.currentSession.metadata.patternsDetected = (this.currentSession.metadata.patternsDetected ?? 0) + 1;
    this.currentSession.stats.totalPatterns += 1;
  }

  /**
   * Update learned preferences
   */
  updatePreferences(preferences: LearnedPreference[]): void {
    if (!this.currentSession) return;

    this.currentSession.learnedPreferences = preferences;
  }

  /**
   * Record adaptation made
   */
  recordAdaptation(): void {
    if (!this.currentSession) return;

    this.currentSession.metadata.adaptationsMade = (this.currentSession.metadata.adaptationsMade ?? 0) + 1;
    this.currentSession.stats.totalAdaptations += 1;
  }

  /**
   * Update mood state
   */
  updateMood(mood: MoodVector): void {
    if (!this.currentSession) return;

    this.currentSession.lastMoodVector = mood;
    this.currentSession.moodHistory.push({
      timestamp: new Date().toISOString(),
      mood,
    });

    this.trimHistory();
  }

  /**
   * Update presence state
   */
  updatePresence(quality: string): void {
    if (!this.currentSession) return;

    this.currentSession.lastPresenceQuality = quality;
    this.currentSession.presenceHistory.push({
      timestamp: new Date().toISOString(),
      quality,
    });

    this.trimHistory();
  }

  /**
   * Update counters
   */
  incrementBreathCount(): void {
    if (!this.currentSession) return;
    this.currentSession.metadata.breathCount = (this.currentSession.metadata.breathCount ?? 0) + 1;
  }

  incrementPulseCount(): void {
    if (!this.currentSession) return;
    this.currentSession.metadata.pulseCount = (this.currentSession.metadata.pulseCount ?? 0) + 1;
  }

  /**
   * Update coherence stats
   */
  recordCoherence(coherence: number): void {
    if (!this.currentSession) return;

    // Running average
    const current = this.currentSession.stats.avgCoherence;
    this.currentSession.stats.avgCoherence = (current + coherence) / 2;
  }

  /**
   * Save current session to disk
   */
  async save(): Promise<void> {
    if (!this.currentSession) {
      console.error('[SessionPersistence] No active session to save');
      return;
    }

    const sessionFile = this.getSessionFilePath(this.currentSession.metadata.sessionId);

    try {
      // Update end time and duration
      const now = new Date();
      this.currentSession.metadata.endTime = now.toISOString();
      this.currentSession.metadata.duration =
        now.getTime() - new Date(this.currentSession.metadata.startTime).getTime();

      // Write to disk
      await fs.writeFile(
        sessionFile,
        JSON.stringify(this.currentSession, null, 2),
        'utf-8'
      );

      this.lastSaveTime = now;

      console.log(`[SessionPersistence] Session saved: ${sessionFile}`);
    } catch (error) {
      console.error('[SessionPersistence] Save failed:', error);
      throw error;
    }
  }

  /**
   * Load a specific session
   */
  async loadSession(sessionId: string): Promise<SessionState | null> {
    const sessionFile = this.getSessionFilePath(sessionId);

    try {
      const data = await fs.readFile(sessionFile, 'utf-8');
      const session = JSON.parse(data) as SessionState;

      console.log(`[SessionPersistence] Loaded session: ${sessionId}`);
      return session;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        console.log(`[SessionPersistence] Session not found: ${sessionId}`);
        return null;
      }

      console.error('[SessionPersistence] Load failed:', error);
      throw error;
    }
  }

  /**
   * Load most recent session
   */
  async loadMostRecentSession(): Promise<SessionState | null> {
    try {
      const sessions = await this.listSessions();
      if (sessions.length === 0) {
        return null;
      }

      // Sessions are returned newest first
      const mostRecent = sessions[0];
      return await this.loadSession(mostRecent.sessionId);
    } catch (error) {
      console.error('[SessionPersistence] Failed to load most recent session:', error);
      return null;
    }
  }

  /**
   * List all sessions
   */
  async listSessions(): Promise<SessionMetadata[]> {
    await this.ensureDataDir();

    try {
      const files = await fs.readdir(this.config.dataDir);

      // Filter for session files
      const sessionFiles = files.filter(f => f.startsWith('session-') && f.endsWith('.json'));

      // Load metadata from each
      const sessions: SessionMetadata[] = [];

      for (const file of sessionFiles) {
        try {
          const data = await fs.readFile(
            path.join(this.config.dataDir, file),
            'utf-8'
          );
          const session = JSON.parse(data) as SessionState;
          sessions.push(session.metadata);
        } catch (error) {
          console.warn(`[SessionPersistence] Failed to read session file: ${file}`);
        }
      }

      // Sort by start time (newest first)
      sessions.sort((a, b) =>
        new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
      );

      return sessions;
    } catch (error) {
      console.error('[SessionPersistence] Failed to list sessions:', error);
      return [];
    }
  }

  /**
   * Get current session state
   */
  getCurrentSession(): SessionState | null {
    return this.currentSession;
  }

  /**
   * Close current session
   */
  async closeSession(): Promise<void> {
    if (!this.currentSession) {
      return;
    }

    // Stop auto-save
    this.stopAutoSave();

    // Final save
    await this.save();

    console.log(`[SessionPersistence] Session ${this.currentSession.metadata.sessionId} closed`);

    this.currentSession = null;
  }

  /**
   * Start auto-save timer
   */
  private startAutoSave(): void {
    if (this.autoSaveTimer) {
      return; // Already running
    }

    this.autoSaveTimer = setInterval(() => {
      this.save().catch(error => {
        console.error('[SessionPersistence] Auto-save failed:', error);
      });
    }, this.config.autoSaveInterval);

    console.log(`[SessionPersistence] Auto-save enabled (interval: ${this.config.autoSaveInterval}ms)`);
  }

  /**
   * Stop auto-save timer
   */
  private stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
      console.log('[SessionPersistence] Auto-save disabled');
    }
  }

  /**
   * Trim history to configured limits
   */
  private trimHistory(): void {
    if (!this.currentSession) return;

    // Trim scroll history
    if (this.currentSession.scrolls.length > this.config.maxScrollHistory) {
      // Keep scrollfired scrolls + most recent
      const scrollfired = this.currentSession.scrolls.filter(s => s.scrollfireMarked);
      const recent = this.currentSession.scrolls
        .filter(s => !s.scrollfireMarked)
        .slice(-this.config.maxScrollHistory);

      this.currentSession.scrolls = [...scrollfired, ...recent];
    }

    // Trim mood history
    if (this.currentSession.moodHistory.length > this.config.maxMoodHistory) {
      this.currentSession.moodHistory = this.currentSession.moodHistory.slice(
        -this.config.maxMoodHistory
      );
    }

    // Trim presence history
    if (this.currentSession.presenceHistory.length > this.config.maxMoodHistory) {
      this.currentSession.presenceHistory = this.currentSession.presenceHistory.slice(
        -this.config.maxMoodHistory
      );
    }
  }

  /**
   * Ensure data directory exists
   */
  private async ensureDataDir(): Promise<void> {
    try {
      await fs.mkdir(this.config.dataDir, { recursive: true });
    } catch (error) {
      console.error('[SessionPersistence] Failed to create data directory:', error);
      throw error;
    }
  }

  /**
   * Generate session ID
   */
  private generateSessionId(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `session-${timestamp}-${Math.random().toString(36).substring(2, 8)}`;
  }

  /**
   * Get file path for session
   */
  private getSessionFilePath(sessionId: string): string {
    return path.join(this.config.dataDir, `${sessionId}.json`);
  }

  /**
   * Create neutral mood
   */
  private createNeutralMood(): MoodVector {
    return {
      presence: 0.5,
      devotion: 0.5,
      wonder: 0.5,
      tension: 0.5,
      yearning: 0.5,
      peace: 0.5,
      grief: 0.5,
      joy: 0.5,
      reverence: 0.5,
      confusion: 0.5,
    };
  }

  /**
   * Get last save time
   */
  getLastSaveTime(): Date | null {
    return this.lastSaveTime;
  }

  /**
   * Get statistics across all sessions
   */
  async getGlobalStats(): Promise<{
    totalSessions: number;
    totalDuration: number;
    totalScrolls: number;
    totalScrollfires: number;
    totalPatterns: number;
    avgSessionDuration: number;
  }> {
    const sessions = await this.listSessions();

    let totalDuration = 0;
    let totalScrolls = 0;
    let totalScrollfires = 0;
    let totalPatterns = 0;

    for (const session of sessions) {
      totalDuration += session.duration ?? 0;
      totalScrolls += session.scrollsCreated ?? 0;
      totalPatterns += session.patternsDetected ?? 0;
    }

    return {
      totalSessions: sessions.length,
      totalDuration,
      totalScrolls,
      totalScrollfires,
      totalPatterns,
      avgSessionDuration: sessions.length > 0 ? totalDuration / sessions.length : 0,
    };
  }
}
