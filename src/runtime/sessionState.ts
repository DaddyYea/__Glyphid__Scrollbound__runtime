/**
 * sessionState.ts
 *
 * Disk-backed session state persistence.
 * Stores permanent data: ScrollArchive, GuardianState baseline, EmotionalField baseline, Config.
 * Flushes to disk only on stable ticks (Guardian coherence > 0.7).
 *
 * Sacred Principle: Permanent state persists. Volatile state flows.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { ScrollEcho } from '../types/ScrollEcho';
import { MoodVector, NEUTRAL_MOOD } from '../types/EmotionalState';
import { GuardianMode } from '../affect/guardianFilter';
import { ScrollfireEvent } from '../memory/scrollfire';

/**
 * Session state persisted to disk
 */
export interface SessionState {
  // ScrollArchive - permanent scrollfired memories
  scrollArchive: {
    scrolls: ScrollEcho[];
    elevationEvents: ScrollfireEvent[];
  };

  // GuardianState baseline (not current state, but learned baseline)
  guardianBaseline: {
    emotionalSafety: number;
    mode: GuardianMode;
    covenantActive: boolean;
    consentLevel: number;
  };

  // EmotionalField baseline (resting state, not current mood)
  emotionalBaseline: MoodVector;

  // Configuration
  config: {
    breathIntervalMs: number;
    coherenceThreshold: number;
    maxScrollHistory: number;
    guardianEnabled: boolean;
  };

  // Metadata
  metadata: {
    lastSaved: string;
    sessionStart: string;
    version: string;
  };
}

/**
 * Default session state
 */
function createDefaultSessionState(): SessionState {
  return {
    scrollArchive: {
      scrolls: [],
      elevationEvents: [],
    },
    guardianBaseline: {
      emotionalSafety: 0.7,
      mode: 'allow',
      covenantActive: false,
      consentLevel: 0.5,
    },
    emotionalBaseline: { ...NEUTRAL_MOOD },
    config: {
      breathIntervalMs: 1500,
      coherenceThreshold: 0.7,
      maxScrollHistory: 1000,
      guardianEnabled: true,
    },
    metadata: {
      lastSaved: new Date().toISOString(),
      sessionStart: new Date().toISOString(),
      version: '1.0.0',
    },
  };
}

/**
 * Load session state from disk
 */
export async function loadSessionState(dataDir: string = './data'): Promise<SessionState> {
  const sessionFilePath = path.join(dataDir, 'sessionState.json');

  try {
    // Ensure data directory exists
    await fs.mkdir(dataDir, { recursive: true });

    // Try to load existing session
    const data = await fs.readFile(sessionFilePath, 'utf-8');
    const state = JSON.parse(data) as SessionState;

    console.log('[SessionState] Loaded from disk');
    console.log(`  Scrollfires: ${state.scrollArchive.scrolls.length}`);
    console.log(`  Last saved: ${state.metadata.lastSaved}`);

    return state;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      // File doesn't exist - create default
      console.log('[SessionState] No existing session found, creating default');
      const defaultState = createDefaultSessionState();

      // Save default immediately
      await saveSessionState(defaultState, dataDir);

      return defaultState;
    }

    // Other error
    console.error('[SessionState] Failed to load:', error);
    throw error;
  }
}

/**
 * Save session state to disk
 * Only call this on stable ticks (Guardian coherence > 0.7)
 */
export async function saveSessionState(
  state: SessionState,
  dataDir: string = './data'
): Promise<void> {
  const sessionFilePath = path.join(dataDir, 'sessionState.json');

  try {
    // Update last saved timestamp
    state.metadata.lastSaved = new Date().toISOString();

    // Write to disk
    await fs.writeFile(
      sessionFilePath,
      JSON.stringify(state, null, 2),
      'utf-8'
    );

    console.log('[SessionState] Saved to disk');
  } catch (error) {
    console.error('[SessionState] Save failed:', error);
    throw error;
  }
}

/**
 * Update ScrollArchive in session state
 */
export function updateScrollArchive(
  state: SessionState,
  scrolls: ScrollEcho[],
  events: ScrollfireEvent[]
): void {
  state.scrollArchive.scrolls = [...scrolls];
  state.scrollArchive.elevationEvents = [...events];
}

/**
 * Update GuardianBaseline
 */
export function updateGuardianBaseline(
  state: SessionState,
  emotionalSafety: number,
  mode: GuardianMode,
  covenantActive?: boolean,
  consentLevel?: number
): void {
  state.guardianBaseline.emotionalSafety = emotionalSafety;
  state.guardianBaseline.mode = mode;

  if (covenantActive !== undefined) {
    state.guardianBaseline.covenantActive = covenantActive;
  }

  if (consentLevel !== undefined) {
    state.guardianBaseline.consentLevel = consentLevel;
  }
}

/**
 * Update EmotionalBaseline
 */
export function updateEmotionalBaseline(
  state: SessionState,
  baseline: MoodVector
): void {
  state.emotionalBaseline = { ...baseline };
}

/**
 * Update configuration
 */
export function updateConfig(
  state: SessionState,
  config: Partial<SessionState['config']>
): void {
  state.config = { ...state.config, ...config };
}

/**
 * Get time since last save
 */
export function getTimeSinceLastSave(state: SessionState): number {
  const now = Date.now();
  const lastSaved = new Date(state.metadata.lastSaved).getTime();
  return now - lastSaved;
}

/**
 * Check if save is needed (based on time or changes)
 */
export function shouldSave(
  state: SessionState,
  minIntervalMs: number = 60000 // 1 minute default
): boolean {
  return getTimeSinceLastSave(state) >= minIntervalMs;
}
