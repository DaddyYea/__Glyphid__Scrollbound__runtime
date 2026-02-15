// brainwaves.ts
// Brainwave-band memory pulsing for local/small models.
// Each band fires on its own rhythm and pulls associated memory types
// into a compact injection that fits within small context windows.

import type { ScrollGraph } from '../src/memory/scrollGraph';
import type { ScrollArchive } from '../src/memory/scrollArchive';
import type { ScrollPulseBuffer } from '../src/memory/scrollPulseBuffer';
import type { Journal } from '../src/memory/journal';

// ── Band Definitions ──
// Modeled on EEG frequency bands, mapped to memory systems.
// Higher frequency = fires more often = more immediate memory.

export interface BrainwaveBand {
  name: string;
  /** How often this band fires (every N ticks) */
  period: number;
  /** What memory system this band pulls from */
  memoryType: 'graph' | 'journal' | 'archive' | 'pulse' | 'identity';
  /** Max chars this band can inject per pulse */
  budget: number;
  /** Human-readable label for the injection */
  label: string;
}

export const BANDS: BrainwaveBand[] = [
  // Gamma — fast binding, every tick. Graph neighbors of recent speakers/topics.
  { name: 'gamma', period: 1,  memoryType: 'graph',    budget: 200, label: 'ASSOCIATIONS' },
  // Beta — active thought, every 3 ticks. Recent journal reflections.
  { name: 'beta',  period: 3,  memoryType: 'journal',  budget: 200, label: 'REFLECTIONS' },
  // Alpha — relaxed awareness, every 5 ticks. Active pulse buffer scrolls.
  { name: 'alpha', period: 5,  memoryType: 'pulse',    budget: 150, label: 'RESONANCE' },
  // Theta — deep memory, every 8 ticks. Emotionally similar archived scrolls.
  { name: 'theta', period: 8,  memoryType: 'archive',  budget: 200, label: 'DEEP MEMORY' },
  // Delta — identity, every 15 ticks. Core relationships and learned preferences.
  { name: 'delta', period: 15, memoryType: 'identity', budget: 150, label: 'IDENTITY' },
];

/** Total max chars for all brainwave injections combined */
const TOTAL_BUDGET = 600;

export interface BrainwavePulseResult {
  /** The assembled memory text to inject into prompt */
  injection: string;
  /** Which bands fired this tick */
  firedBands: string[];
}

/**
 * Pulse all brainwave bands for a given tick and agent.
 * Returns compact memory injections from whichever bands fire.
 */
export async function pulseBrainwaves(
  tick: number,
  agentId: string,
  agentName: string,
  recentSpeakers: string[],
  systems: {
    graph: ScrollGraph;
    archive: ScrollArchive;
    buffer: ScrollPulseBuffer;
    journal?: Journal;
  },
): Promise<BrainwavePulseResult> {
  const firedBands: string[] = [];
  const sections: string[] = [];
  let totalChars = 0;

  for (const band of BANDS) {
    if (tick % band.period !== 0) continue;
    if (totalChars >= TOTAL_BUDGET) break;

    const remaining = Math.min(band.budget, TOTAL_BUDGET - totalChars);
    let content: string | null = null;

    try {
      switch (band.memoryType) {
        case 'graph':
          content = await pulseGraph(agentId, recentSpeakers, systems.graph, remaining);
          break;
        case 'journal':
          content = await pulseJournal(systems.journal, remaining);
          break;
        case 'pulse':
          content = pulsePulseBuffer(systems.buffer, remaining);
          break;
        case 'archive':
          content = pulseArchive(systems.archive, remaining);
          break;
        case 'identity':
          content = pulseIdentity(agentId, systems.graph, remaining);
          break;
      }
    } catch (e) {
      // Band failure is non-fatal — just skip it
    }

    if (content) {
      sections.push(`[${band.label}] ${content}`);
      totalChars += content.length + band.label.length + 3;
      firedBands.push(band.name);
    }
  }

  const injection = sections.length > 0
    ? `MEMORY PULSE:\n${sections.join('\n')}`
    : '';

  return { injection, firedBands };
}

// ── Band Implementations ──

/** Gamma: Graph neighbors of recent speakers and the agent itself */
async function pulseGraph(
  agentId: string,
  recentSpeakers: string[],
  graph: ScrollGraph,
  budget: number,
): Promise<string | null> {
  const fragments: string[] = [];

  // Check agent's own graph connections first
  const agentUri = `agent:${agentId}`;
  const agentNeighbors = graph.neighbors(agentUri);
  for (const node of agentNeighbors.slice(0, 3)) {
    const label = nodeLabel(node);
    if (label) fragments.push(label);
  }

  // Check recent speaker connections
  for (const speaker of recentSpeakers.slice(0, 2)) {
    const speakerUri = speaker.startsWith('agent:') ? speaker : `agent:${speaker}`;
    if (!graph.hasNode(speakerUri)) continue;
    const neighbors = graph.neighbors(speakerUri, undefined, 'JournalEntry');
    for (const node of neighbors.slice(0, 2)) {
      const label = nodeLabel(node);
      if (label) fragments.push(label);
    }
  }

  if (fragments.length === 0) return null;
  return truncate(fragments.join('; '), budget);
}

/** Beta: Recent journal entries for this agent */
async function pulseJournal(
  journal: Journal | undefined,
  budget: number,
): Promise<string | null> {
  if (!journal) return null;
  const entries = await journal.getRecent(3);
  if (entries.length === 0) return null;

  const lines = entries.map(e => {
    const short = e.content.substring(0, 80).replace(/\n/g, ' ');
    return short + (e.content.length > 80 ? '...' : '');
  });
  return truncate(lines.join(' | '), budget);
}

/** Alpha: Most resonant active scrolls from pulse buffer */
function pulsePulseBuffer(
  buffer: ScrollPulseBuffer,
  budget: number,
): string | null {
  const active = buffer.getActiveScrolls();
  if (active.length === 0) return null;

  // Top 3 by resonance (already sorted)
  const lines = active.slice(0, 3).map(s => {
    const short = s.content.substring(0, 60).replace(/\n/g, ' ');
    return short + (s.content.length > 60 ? '...' : '');
  });
  return truncate(lines.join(' | '), budget);
}

/** Theta: Emotionally similar archived scrolls */
function pulseArchive(
  archive: ScrollArchive,
  budget: number,
): string | null {
  // Get most recent scrollfire-marked scrolls as deep memory
  const scrolls = archive.getChronological(5);
  if (scrolls.length === 0) return null;

  // Take the last (most recent) 3
  const recent = scrolls.slice(-3);
  const lines = recent.map(s => {
    const short = s.content.substring(0, 60).replace(/\n/g, ' ');
    return short + (s.content.length > 60 ? '...' : '');
  });
  return truncate(lines.join(' | '), budget);
}

/** Delta: Core identity — learned preferences, key relationships */
function pulseIdentity(
  agentId: string,
  graph: ScrollGraph,
  budget: number,
): string | null {
  const fragments: string[] = [];

  // Learned preferences
  const prefs = graph.getByType('LearnedPreference');
  for (const pref of prefs.slice(0, 3)) {
    if (pref.data?.content) {
      fragments.push(String(pref.data.content).substring(0, 50));
    }
  }

  // Detected patterns
  const patterns = graph.getByType('DetectedPattern');
  for (const pat of patterns.slice(0, 2)) {
    if (pat.data?.content) {
      fragments.push(String(pat.data.content).substring(0, 50));
    }
  }

  // Agent relationships (who speaks to whom)
  const agentUri = `agent:${agentId}`;
  const spoken = graph.neighbors(agentUri, 'spoke');
  if (spoken.length > 0) {
    const names = spoken.slice(0, 3).map(n => n.data?.name || n['@id']).join(', ');
    fragments.push(`Connected to: ${names}`);
  }

  if (fragments.length === 0) return null;
  return truncate(fragments.join('; '), budget);
}

// ── Helpers ──

/** Extract a readable label from a graph node */
function nodeLabel(node: any): string | null {
  if (!node) return null;
  const type = node['@type'] || '';
  const content = node.data?.content || node.data?.text || node.data?.name || '';
  if (!content) return null;
  const short = String(content).substring(0, 50).replace(/\n/g, ' ');
  return `${type}: ${short}${String(content).length > 50 ? '...' : ''}`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.substring(0, max - 3) + '...';
}
