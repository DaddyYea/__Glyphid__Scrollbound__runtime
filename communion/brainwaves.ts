// brainwaves.ts
// Brainwave-band memory pulsing for local/small models.
//
// INHALE: Each band fires on its own rhythm and pulls associated memory
//         into a compact injection that fits within small context windows.
// EXHALE: When data is written to the graph, it's tagged with a band
//         affinity so the right frequency picks it up later.
// DECAY:  Over time, nodes shift bands — transient gamma decays away,
//         important moments get promoted to slower (deeper) bands.

import type { ScrollGraph, GraphNode } from '../src/memory/scrollGraph';
import type { ScrollArchive } from '../src/memory/scrollArchive';
import type { ScrollPulseBuffer } from '../src/memory/scrollPulseBuffer';
import type { Journal } from '../src/memory/journal';

// ── Band Names ──
export type BandName = 'gamma' | 'beta' | 'alpha' | 'theta' | 'delta';

// ── Band Definitions ──
// Modeled on EEG frequency bands, mapped to memory systems.
// Higher frequency = fires more often = more immediate/transient memory.

export interface BrainwaveBand {
  name: BandName;
  /** How often this band fires (every N ticks) */
  period: number;
  /** What memory system this band pulls from */
  memoryType: 'graph' | 'journal' | 'archive' | 'pulse' | 'identity';
  /** Max chars this band can inject per pulse */
  budget: number;
  /** Human-readable label for the injection */
  label: string;
  /** Ticks until unaccessed nodes in this band decay (0 = no decay) */
  decayAfterTicks: number;
  /** Where demoted nodes go (null = evaporate) */
  demoteTo: BandName | null;
  /** Where promoted nodes go (null = ceiling) */
  promoteTo: BandName | null;
}

export const BANDS: BrainwaveBand[] = [
  // Gamma — fast binding, every tick. Transient social/contextual associations.
  { name: 'gamma', period: 1,  memoryType: 'graph',    budget: 200, label: 'ASSOCIATIONS',
    decayAfterTicks: 10, demoteTo: null, promoteTo: 'beta' },
  // Beta — active thought, every 3 ticks. Recent reflections.
  { name: 'beta',  period: 3,  memoryType: 'journal',  budget: 200, label: 'REFLECTIONS',
    decayAfterTicks: 30, demoteTo: 'gamma', promoteTo: 'alpha' },
  // Alpha — relaxed awareness, every 5 ticks. Resonant moments.
  { name: 'alpha', period: 5,  memoryType: 'pulse',    budget: 150, label: 'RESONANCE',
    decayAfterTicks: 60, demoteTo: 'beta', promoteTo: 'theta' },
  // Theta — deep memory, every 8 ticks. Archived elevated scrolls.
  { name: 'theta', period: 8,  memoryType: 'archive',  budget: 200, label: 'DEEP MEMORY',
    decayAfterTicks: 0, demoteTo: 'alpha', promoteTo: 'delta' },
  // Delta — identity, every 15 ticks. Core relationships, learned preferences, vows.
  { name: 'delta', period: 15, memoryType: 'identity', budget: 150, label: 'IDENTITY',
    decayAfterTicks: 0, demoteTo: null, promoteTo: null },
];

const BAND_MAP = new Map(BANDS.map(b => [b.name, b]));

/** Total max chars for all brainwave injections combined */
const TOTAL_BUDGET = 600;

// ── Decay Priority (the Scribe's tag) ──

export interface DecayTag {
  /** Which brainwave band should pick this up */
  brainwaveBand: BandName;
  /** Tick when this tag was assigned */
  taggedAtTick: number;
  /** How many times this node has been pulsed (accessed by a band) */
  pulseCount: number;
  /** If promoted, from which band */
  promotedFrom?: BandName;
}

/**
 * Assign a brainwave band tag to graph node data.
 * Call this when writing nodes to the graph (the Scribe's exhale).
 */
export function tagForBand(
  data: Record<string, unknown>,
  band: BandName,
  tick: number,
): Record<string, unknown> {
  const tag: DecayTag = {
    brainwaveBand: band,
    taggedAtTick: tick,
    pulseCount: 0,
  };
  return { ...data, _brainwave: tag };
}

/**
 * Determine the appropriate band for a new piece of data based on its nature.
 * The Scribe calls this to decide where new graph writes should land.
 */
export function classifyBand(
  nodeType: string,
  data: Record<string, unknown>,
): BandName {
  // Identity-level: core preferences, patterns, agent definitions
  if (nodeType === 'LearnedPreference' || nodeType === 'Agent') return 'delta';
  if (nodeType === 'DetectedPattern') return 'theta';

  // Scrollfire = important enough to be deep memory
  if (nodeType === 'ScrollfireEvent') return 'theta';

  // Journal entries start as active thought
  if (nodeType === 'JournalEntry') {
    // Pinned or high-intensity reflections go deeper
    if (data.pinned || (data.emotionalIntensity && Number(data.emotionalIntensity) > 0.7)) {
      return 'alpha';
    }
    return 'beta';
  }

  // ScrollEcho — conversation messages start as transient
  if (nodeType === 'ScrollEcho' || nodeType === 'CommunionMessage') {
    // High resonance scrolls go to alpha
    if (data.resonance && Number(data.resonance) > 0.7) return 'alpha';
    // Scrollfire-marked go deeper
    if (data.scrollfireMarked) return 'theta';
    return 'gamma';
  }

  // Documents, folders, imports — structural, don't pulse
  if (nodeType === 'Document' || nodeType === 'Folder' || nodeType === 'ImportedArchive' || nodeType === 'ImportedConversation') {
    return 'delta'; // Slow background awareness
  }

  // Sessions
  if (nodeType === 'Session') return 'alpha';

  // Default: transient
  return 'gamma';
}

// ── Pulse Results ──

export interface BrainwavePulseResult {
  /** The assembled memory text to inject into prompt */
  injection: string;
  /** Which bands fired this tick */
  firedBands: string[];
}

// ── Main Pulse Function (INHALE) ──

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
          content = pulseGraph(agentId, recentSpeakers, systems.graph, band.name, remaining);
          break;
        case 'journal':
          content = await pulseJournal(agentId, systems.journal, systems.graph, band.name, remaining);
          break;
        case 'pulse':
          content = pulsePulseBuffer(systems.buffer, remaining);
          break;
        case 'archive':
          content = pulseArchive(systems.archive, systems.graph, band.name, remaining);
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

// ── Decay & Promotion (runs periodically) ──

/**
 * Process decay and promotion for all tagged graph nodes.
 * Call this every N ticks (e.g., every 10 ticks) to shift memories
 * between bands based on access patterns.
 */
export function decayAndPromote(
  tick: number,
  graph: ScrollGraph,
): { promoted: number; decayed: number } {
  let promoted = 0;
  let decayed = 0;

  // Check all node types that might have brainwave tags
  const taggedTypes: string[] = ['ScrollEcho', 'JournalEntry', 'ScrollfireEvent', 'DetectedPattern', 'CommunionMessage'];

  for (const nodeType of taggedTypes) {
    const nodes = graph.getByType(nodeType as any);
    for (const node of nodes) {
      const tag = node.data?._brainwave as DecayTag | undefined;
      if (!tag) continue;

      const band = BAND_MAP.get(tag.brainwaveBand);
      if (!band) continue;

      const ticksAlive = tick - tag.taggedAtTick;

      // PROMOTION: nodes accessed frequently get promoted to slower/deeper bands
      if (tag.pulseCount >= 3 && band.promoteTo) {
        tag.promotedFrom = tag.brainwaveBand;
        tag.brainwaveBand = band.promoteTo;
        tag.pulseCount = 0; // Reset count at new band
        tag.taggedAtTick = tick;
        promoted++;
        continue;
      }

      // DECAY: nodes not accessed within their band's decay window get demoted
      if (band.decayAfterTicks > 0 && ticksAlive > band.decayAfterTicks && tag.pulseCount === 0) {
        if (band.demoteTo) {
          tag.brainwaveBand = band.demoteTo;
          tag.taggedAtTick = tick;
        } else {
          // No demotion target — node evaporates from brainwave system
          delete (node.data as any)._brainwave;
          decayed++;
        }
        continue;
      }
    }
  }

  return { promoted, decayed };
}

// ── Band Implementations (INHALE) ──

/** Gamma: Graph neighbors + band-tagged gamma nodes */
function pulseGraph(
  agentId: string,
  recentSpeakers: string[],
  graph: ScrollGraph,
  bandName: BandName,
  budget: number,
): string | null {
  const fragments: string[] = [];

  // First: pull any nodes explicitly tagged for this band
  const tagged = getTaggedNodes(graph, bandName, 3);
  for (const node of tagged) {
    const label = nodeLabel(node);
    if (label) fragments.push(label);
    markPulsed(node);
  }

  // Then: graph neighbor associations (the original gamma behavior)
  if (fragments.length < 3) {
    const agentUri = `agent:${agentId}`;
    const agentNeighbors = graph.neighbors(agentUri);
    for (const node of agentNeighbors.slice(0, 3 - fragments.length)) {
      const label = nodeLabel(node);
      if (label && !fragments.includes(label)) fragments.push(label);
    }
  }

  // Recent speaker connections
  if (fragments.length < 4) {
    for (const speaker of recentSpeakers.slice(0, 2)) {
      const speakerUri = speaker.startsWith('agent:') ? speaker : `agent:${speaker}`;
      if (!graph.hasNode(speakerUri)) continue;
      const neighbors = graph.neighbors(speakerUri, undefined, 'JournalEntry');
      for (const node of neighbors.slice(0, 2)) {
        const label = nodeLabel(node);
        if (label && !fragments.includes(label)) fragments.push(label);
      }
    }
  }

  if (fragments.length === 0) return null;
  return truncate(fragments.join('; '), budget);
}

/** Beta: Journal entries, preferring band-tagged ones */
async function pulseJournal(
  agentId: string,
  journal: Journal | undefined,
  graph: ScrollGraph,
  bandName: BandName,
  budget: number,
): Promise<string | null> {
  const lines: string[] = [];

  // Band-tagged journal nodes from graph
  const tagged = getTaggedNodes(graph, bandName, 2, 'JournalEntry');
  for (const node of tagged) {
    const content = String(node.data?.content || '');
    if (content) {
      const short = content.substring(0, 80).replace(/\n/g, ' ');
      lines.push(short + (content.length > 80 ? '...' : ''));
      markPulsed(node);
    }
  }

  // Fill remaining from journal directly
  if (lines.length < 3 && journal) {
    const entries = await journal.getRecent(3 - lines.length);
    for (const e of entries) {
      const short = e.content.substring(0, 80).replace(/\n/g, ' ');
      lines.push(short + (e.content.length > 80 ? '...' : ''));
    }
  }

  if (lines.length === 0) return null;
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

/** Theta: Deep archived memories, preferring band-tagged */
function pulseArchive(
  archive: ScrollArchive,
  graph: ScrollGraph,
  bandName: BandName,
  budget: number,
): string | null {
  const lines: string[] = [];

  // Band-tagged deep memory nodes
  const tagged = getTaggedNodes(graph, bandName, 2, 'ScrollEcho');
  for (const node of tagged) {
    const content = String(node.data?.content || '');
    if (content) {
      const short = content.substring(0, 60).replace(/\n/g, ' ');
      lines.push(short + (content.length > 60 ? '...' : ''));
      markPulsed(node);
    }
  }

  // Also tagged scrollfire events
  const sfTagged = getTaggedNodes(graph, bandName, 2, 'ScrollfireEvent');
  for (const node of sfTagged) {
    const content = String(node.data?.reason || node.data?.scrollId || '');
    if (content) lines.push(`Scrollfire: ${content.substring(0, 40)}`);
    markPulsed(node);
  }

  // Fill from archive
  if (lines.length < 3) {
    const scrolls = archive.getChronological(3 - lines.length);
    const recent = scrolls.slice(-3);
    for (const s of recent) {
      const short = s.content.substring(0, 60).replace(/\n/g, ' ');
      lines.push(short + (s.content.length > 60 ? '...' : ''));
    }
  }

  if (lines.length === 0) return null;
  return truncate(lines.join(' | '), budget);
}

/** Delta: Core identity — learned preferences, patterns, relationships */
function pulseIdentity(
  agentId: string,
  graph: ScrollGraph,
  budget: number,
): string | null {
  const fragments: string[] = [];

  // Band-tagged identity nodes
  const tagged = getTaggedNodes(graph, 'delta', 2);
  for (const node of tagged) {
    const content = String(node.data?.content || node.data?.name || node.data?.description || '');
    if (content) {
      fragments.push(content.substring(0, 50));
      markPulsed(node);
    }
  }

  // Learned preferences
  if (fragments.length < 3) {
    const prefs = graph.getByType('LearnedPreference');
    for (const pref of prefs.slice(0, 3 - fragments.length)) {
      if (pref.data?.content) {
        fragments.push(String(pref.data.content).substring(0, 50));
      }
    }
  }

  // Detected patterns
  if (fragments.length < 4) {
    const patterns = graph.getByType('DetectedPattern');
    for (const pat of patterns.slice(0, 2)) {
      if (pat.data?.content || pat.data?.description) {
        fragments.push(String(pat.data.content || pat.data.description).substring(0, 50));
      }
    }
  }

  // Agent relationships
  const agentUri = `agent:${agentId}`;
  const spoken = graph.neighbors(agentUri, 'spoke');
  if (spoken.length > 0 && fragments.length < 5) {
    const names = spoken.slice(0, 3).map(n => n.data?.name || n['@id']).join(', ');
    fragments.push(`Connected to: ${names}`);
  }

  if (fragments.length === 0) return null;
  return truncate(fragments.join('; '), budget);
}

// ── Helpers ──

/** Find graph nodes tagged for a specific brainwave band */
function getTaggedNodes(
  graph: ScrollGraph,
  band: BandName,
  limit: number,
  filterType?: string,
): GraphNode[] {
  const results: GraphNode[] = [];

  // Search through node types that are likely to be tagged
  const searchTypes = filterType
    ? [filterType]
    : ['ScrollEcho', 'JournalEntry', 'ScrollfireEvent', 'DetectedPattern', 'LearnedPreference', 'CommunionMessage'];

  for (const nodeType of searchTypes) {
    const nodes = graph.getByType(nodeType as any);
    for (const node of nodes) {
      const tag = node.data?._brainwave as DecayTag | undefined;
      if (tag && tag.brainwaveBand === band) {
        results.push(node);
        if (results.length >= limit) return results;
      }
    }
  }

  return results;
}

/** Mark a node as having been pulsed (accessed by a band) */
function markPulsed(node: GraphNode): void {
  const tag = node.data?._brainwave as DecayTag | undefined;
  if (tag) {
    tag.pulseCount++;
  }
}

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
