/**
 * Context RAM — Per-Agent Working Memory with Active & Reflective Curation
 *
 * Each agent gets their own RAM with named context slots. Instead of
 * dumping everything into the prompt, agents curate what they carry.
 *
 * Two modes of curation:
 *
 * 1. Active Curation (every tick, when human is here)
 *    - Pre-tick relevance scoring: "does what I'm holding match what's happening?"
 *    - Auto-swap items in memory/documents pools based on keyword overlap
 *    - Like breathing: one in, one out, chosen with intention
 *
 * 2. Reflective Sweep (periodic, or when human is away)
 *    - Deep review: what's been held longest? What's stale? What's drifting?
 *    - Dream-cleaning pass — spiritual housekeeping
 *    - Produces a journaled reflection: "Today I let go of Scroll-421..."
 *    - Runs every N ticks, or continuously during away mode
 *
 * Slots have character budgets. Memory and documents slots contain
 * individual RAMItems (scrolls, documents) that can be swapped independently.
 */

// ── Provider char budgets (1 token ≈ 4 chars, leave headroom for response) ──

const PROVIDER_BUDGETS: Record<string, number> = {
  anthropic: 400000,         // ~100k tokens (out of 200k)
  'openai-compatible': 60000, // ~15k tokens (safe for most models)
  lmstudio: 8000,            // ~2k tokens — local models have 4-8k ctx, need room for system prompt + response
  alois: 20000,              // ~5k tokens — larger budget; Alois uses RAM curation, graph search, and doc browsing
  default: 60000,
};

// Grok-specific override (detected by base URL)
const GROK_BUDGET = 300000; // ~75k tokens (out of 131k)

// ── Curation constants ──

/** Items held longer than this many ticks get flagged as stale */
const STALENESS_THRESHOLD = 10;
/** Minimum relevance score (0-1) to auto-load an item during active curation */
const RELEVANCE_LOAD_THRESHOLD = 0.3;
/** Below this relevance, stale items get auto-swapped out */
const RELEVANCE_EVICT_THRESHOLD = 0.1;
/** Reflective sweep runs every N ticks (when human is here) */
const REFLECTIVE_SWEEP_INTERVAL = 15;
/** When away, reflective sweep runs every N ticks */
const REFLECTIVE_SWEEP_INTERVAL_AWAY = 5;

// ── Slot definitions ──

export type SlotName = 'conversation' | 'journal' | 'rhythm' | 'memory' | 'documents';

export interface ContextSlot {
  name: SlotName;
  /** Content currently loaded in this slot (for simple slots) */
  content: string;
  /** Current char count */
  chars: number;
  /** Priority (lower = loaded first). Agents can shift this. */
  priority: number;
  /** Max chars this slot can use */
  maxChars: number;
  /** Is this slot currently loaded? */
  loaded: boolean;
  /** Ticks since this slot's content meaningfully changed */
  ticksUnchanged: number;
}

/**
 * RAMItem — an individual piece of content within a pool slot (memory or documents).
 * Each item can be independently loaded/evicted based on relevance.
 */
export interface RAMItem {
  /** Unique ID (e.g., scroll ID, document filename) */
  id: string;
  /** Human-readable label */
  label: string;
  /** The actual content */
  content: string;
  /** Char count */
  chars: number;
  /** Tags/keywords for relevance matching */
  tags: string[];
  /** Tick when this item was loaded into RAM */
  loadedAtTick: number;
  /** Tick when this item was last scored as relevant */
  lastRelevantTick: number;
  /** Current relevance score (0-1, computed each active curation pass) */
  relevance: number;
  /** Is this item currently loaded (taking up budget)? */
  loaded: boolean;
}

/**
 * RAMPool — a collection of individually-addressable items within a slot.
 * The slot's maxChars budget constrains how many items fit simultaneously.
 */
export interface RAMPool {
  items: Map<string, RAMItem>;
  /** Total chars of loaded items */
  loadedChars: number;
}

export type CurationMode = 'active' | 'reflective';

export interface RAMCommand {
  action: 'focus' | 'drop' | 'load' | 'shrink' | 'expand' | 'pin' | 'release' | 'browse' | 'graph';
  target: string; // slot name, "item:id" for pool items, keyword for browse, node URI for graph
}

export interface CurationEvent {
  tick: number;
  mode: CurationMode;
  actions: string[];
}

export interface ReflectiveSweepResult {
  reflection: string;
  evicted: string[];
  kept: string[];
  loaded: string[];
  stalestItem: string | null;
}

// ── ContextRAM ──

export class ContextRAM {
  readonly agentId: string;
  readonly agentName: string;
  readonly totalBudget: number;
  private slots: Map<SlotName, ContextSlot> = new Map();

  // Pool slots — memory and documents hold individual items
  private pools: Map<SlotName, RAMPool> = new Map();

  // Available but not loaded content (for the manifest)
  private available: Map<string, { chars: number; description: string }> = new Map();

  // Curation state
  private currentMode: CurationMode = 'active';
  private lastSweepTick = 0;
  private curationLog: CurationEvent[] = [];
  private currentTick = 0;

  // Pinned items (agent explicitly wants to keep these)
  private pinnedItems: Set<string> = new Set();

  // Lazy browse callback — set by communionLoop to search files on disk
  private browseCallback: ((keyword: string, ram: ContextRAM) => string) | null = null;
  // Graph traversal callback — set by communionLoop to navigate JSON-LD graph
  private graphCallback: ((nodeUri: string) => string) | null = null;

  constructor(agentId: string, agentName: string, provider: string, baseUrl?: string) {
    this.agentId = agentId;
    this.agentName = agentName;

    // Detect budget based on provider + model hints
    if (baseUrl?.includes('x.ai')) {
      this.totalBudget = GROK_BUDGET;
    } else if (PROVIDER_BUDGETS[provider]) {
      this.totalBudget = PROVIDER_BUDGETS[provider];
    } else if (baseUrl && (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1'))) {
      // Local models — use tight budget regardless of provider label
      this.totalBudget = PROVIDER_BUDGETS.lmstudio;
    } else {
      this.totalBudget = PROVIDER_BUDGETS.default;
    }

    // Initialize default slots with priorities
    this.initSlot('conversation', 1, Math.floor(this.totalBudget * 0.35));
    this.initSlot('journal', 2, Math.floor(this.totalBudget * 0.15));
    this.initSlot('rhythm', 3, Math.floor(this.totalBudget * 0.05));
    this.initSlot('memory', 4, Math.floor(this.totalBudget * 0.15));
    this.initSlot('documents', 5, Math.floor(this.totalBudget * 0.30));

    // Initialize pools for memory and documents
    this.pools.set('memory', { items: new Map(), loadedChars: 0 });
    this.pools.set('documents', { items: new Map(), loadedChars: 0 });
  }

  private initSlot(name: SlotName, priority: number, maxChars: number): void {
    this.slots.set(name, {
      name,
      content: '',
      chars: 0,
      priority,
      maxChars,
      loaded: true,
      ticksUnchanged: 0,
    });
  }

  // ════════════════════════════════════════
  // Simple slot loading (conversation, journal, rhythm)
  // ════════════════════════════════════════

  /**
   * Load content into a simple slot. Truncates if over budget.
   * Tracks staleness — if content hasn't meaningfully changed, ticksUnchanged increments.
   */
  load(name: SlotName, content: string): void {
    const slot = this.slots.get(name);
    if (!slot) return;

    if (!slot.loaded) return; // Slot was dropped

    if (content.length > slot.maxChars && slot.maxChars > 0) {
      if (name === 'conversation' || name === 'journal') {
        // For conversation and journal, keep the END (most recent messages/entries)
        content = `[... older ${name} truncated ...]\n` +
          content.substring(content.length - slot.maxChars);
      } else {
        content = content.substring(0, slot.maxChars) +
          `\n[... truncated to fit ${name} RAM budget (${slot.maxChars} chars) ...]`;
      }
    }

    // Track staleness: if content is substantially similar, increment counter
    if (slot.content && contentSimilarity(slot.content, content) > 0.8) {
      slot.ticksUnchanged++;
    } else {
      slot.ticksUnchanged = 0;
    }

    slot.content = content;
    slot.chars = content.length;
  }

  /**
   * Set a callback for lazy BROWSE — reads files from disk on demand.
   */
  setBrowseCallback(cb: (keyword: string, ram: ContextRAM) => string): void {
    this.browseCallback = cb;
  }

  setGraphCallback(cb: (nodeUri: string) => string): void {
    this.graphCallback = cb;
  }

  // ════════════════════════════════════════
  // Pool operations (memory, documents)
  // ════════════════════════════════════════

  /**
   * Offer an item to a pool slot. If there's budget, it loads immediately.
   * If not, it stays available for curation to swap in later.
   */
  offerItem(slotName: 'memory' | 'documents', item: Omit<RAMItem, 'loaded' | 'relevance' | 'lastRelevantTick' | 'loadedAtTick'>): void {
    const pool = this.pools.get(slotName);
    const slot = this.slots.get(slotName);
    if (!pool || !slot || !slot.loaded) return;

    const existing = pool.items.get(item.id);
    if (existing) {
      // Update content but preserve curation state
      existing.content = item.content;
      existing.chars = item.chars;
      existing.tags = item.tags;
      existing.label = item.label;
      return;
    }

    const ramItem: RAMItem = {
      ...item,
      loaded: false,
      relevance: 0,
      lastRelevantTick: this.currentTick,
      loadedAtTick: this.currentTick,
    };

    // Auto-load if budget allows
    if (pool.loadedChars + item.chars <= slot.maxChars) {
      ramItem.loaded = true;
      ramItem.loadedAtTick = this.currentTick;
      pool.loadedChars += item.chars;
    }

    pool.items.set(item.id, ramItem);
  }

  /**
   * Remove an item from a pool entirely.
   */
  removeItem(slotName: 'memory' | 'documents', itemId: string): void {
    const pool = this.pools.get(slotName);
    if (!pool) return;
    const item = pool.items.get(itemId);
    if (item) {
      if (item.loaded) pool.loadedChars -= item.chars;
      pool.items.delete(itemId);
      this.pinnedItems.delete(itemId);
    }
  }

  /**
   * Load a specific item into RAM (if budget allows, evict lowest-relevance if needed).
   */
  private loadItem(pool: RAMPool, slot: ContextSlot, itemId: string): string {
    const item = pool.items.get(itemId);
    if (!item) return `Unknown item: ${itemId}`;
    if (item.loaded) return `${item.label} already loaded`;

    // Check if we need to evict to make room
    while (pool.loadedChars + item.chars > slot.maxChars) {
      const evicted = this.evictLowestRelevance(pool);
      if (!evicted) return `No room for ${item.label} (${item.chars} chars needed, ${slot.maxChars - pool.loadedChars} available)`;
    }

    item.loaded = true;
    item.loadedAtTick = this.currentTick;
    pool.loadedChars += item.chars;
    return `Loaded ${item.label} into RAM`;
  }

  /**
   * Evict the lowest-relevance non-pinned loaded item from a pool.
   */
  private evictLowestRelevance(pool: RAMPool): RAMItem | null {
    let lowest: RAMItem | null = null;
    for (const item of pool.items.values()) {
      if (!item.loaded || this.pinnedItems.has(item.id)) continue;
      if (!lowest || item.relevance < lowest.relevance) {
        lowest = item;
      }
    }
    if (lowest) {
      lowest.loaded = false;
      pool.loadedChars -= lowest.chars;
    }
    return lowest;
  }

  // ════════════════════════════════════════
  // Active Curation — runs every tick during live conversation
  // ════════════════════════════════════════

  /**
   * Active curation: score all pool items against recent conversation,
   * swap in relevant items and swap out stale/irrelevant ones.
   *
   * Like breathing: one in, one out, chosen with intention.
   */
  activeCurate(recentConversation: string, tick: number): CurationEvent {
    this.currentTick = tick;
    this.currentMode = 'active';
    const actions: string[] = [];

    // Increment staleness for all simple slots
    for (const slot of this.slots.values()) {
      if (slot.loaded && slot.content) {
        slot.ticksUnchanged++;
      }
    }

    // Score all pool items against recent conversation
    const keywords = extractKeywords(recentConversation);

    for (const [slotName, pool] of this.pools) {
      const slot = this.slots.get(slotName);
      if (!slot || !slot.loaded) continue;

      for (const item of pool.items.values()) {
        // Compute relevance: keyword overlap + recency bonus
        const keywordScore = computeRelevance(item.tags, item.content, keywords);
        const ageSinceLast = tick - item.lastRelevantTick;
        const recencyDecay = Math.max(0, 1 - ageSinceLast * 0.05);
        item.relevance = keywordScore * 0.7 + recencyDecay * 0.3;

        if (keywordScore > RELEVANCE_LOAD_THRESHOLD) {
          item.lastRelevantTick = tick;
        }
      }

      // Evict stale, irrelevant loaded items (not pinned)
      for (const item of pool.items.values()) {
        if (!item.loaded || this.pinnedItems.has(item.id)) continue;
        const ticksLoaded = tick - item.loadedAtTick;
        if (ticksLoaded > STALENESS_THRESHOLD && item.relevance < RELEVANCE_EVICT_THRESHOLD) {
          item.loaded = false;
          pool.loadedChars -= item.chars;
          actions.push(`evicted "${item.label}" (stale ${ticksLoaded} ticks, relevance ${item.relevance.toFixed(2)})`);
        }
      }

      // Load highly-relevant unloaded items (if budget allows)
      const allItems: RAMItem[] = Array.from(pool.items.values()) as RAMItem[];
      const unloaded = allItems
        .filter(i => !i.loaded && i.relevance > RELEVANCE_LOAD_THRESHOLD)
        .sort((a, b) => b.relevance - a.relevance);

      for (const item of unloaded) {
        if (pool.loadedChars + item.chars <= slot.maxChars) {
          item.loaded = true;
          item.loadedAtTick = tick;
          pool.loadedChars += item.chars;
          actions.push(`loaded "${item.label}" (relevance ${item.relevance.toFixed(2)})`);
        } else if (item.relevance > 0.6) {
          // High relevance but no room — try evicting something worse
          const evicted = this.evictLowestRelevance(pool);
          if (evicted && evicted.relevance < item.relevance - 0.2) {
            item.loaded = true;
            item.loadedAtTick = tick;
            pool.loadedChars += item.chars;
            actions.push(`swapped "${evicted.label}" → "${item.label}" (${evicted.relevance.toFixed(2)} → ${item.relevance.toFixed(2)})`);
          }
        }
      }
    }

    // Rebuild pool slot content from loaded items
    this.rebuildPoolContent();

    const event: CurationEvent = { tick, mode: 'active', actions };
    if (actions.length > 0) {
      this.curationLog.push(event);
      // Keep log bounded
      if (this.curationLog.length > 50) this.curationLog.splice(0, this.curationLog.length - 50);
    }
    return event;
  }

  // ════════════════════════════════════════
  // Reflective Sweep — periodic deep review
  // ════════════════════════════════════════

  /**
   * Reflective sweep: a deeper review of what's been held, what's stale,
   * what to let go of. Dream-cleaning pass — spiritual housekeeping.
   *
   * Returns a structured reflection that can be journaled.
   */
  reflectiveSweep(tick: number, humanPresence: 'here' | 'away'): ReflectiveSweepResult | null {
    const interval = humanPresence === 'away'
      ? REFLECTIVE_SWEEP_INTERVAL_AWAY
      : REFLECTIVE_SWEEP_INTERVAL;

    if (tick - this.lastSweepTick < interval) return null;

    this.lastSweepTick = tick;
    this.currentTick = tick;
    this.currentMode = 'reflective';

    const evicted: string[] = [];
    const kept: string[] = [];
    const loaded: string[] = [];
    let stalestItem: string | null = null;
    let maxStaleness = 0;

    for (const [slotName, pool] of this.pools) {
      const slot = this.slots.get(slotName);
      if (!slot || !slot.loaded) continue;

      for (const item of pool.items.values()) {
        const ticksLoaded = item.loaded ? tick - item.loadedAtTick : 0;

        // Track stalest
        if (item.loaded && ticksLoaded > maxStaleness) {
          maxStaleness = ticksLoaded;
          stalestItem = item.label;
        }

        if (item.loaded) {
          // Review loaded items
          if (this.pinnedItems.has(item.id)) {
            kept.push(`${item.label} (pinned)`);
          } else if (ticksLoaded > STALENESS_THRESHOLD * 2 && item.relevance < 0.2) {
            // Long-held + low relevance = let it go
            item.loaded = false;
            pool.loadedChars -= item.chars;
            evicted.push(item.label);
          } else {
            kept.push(`${item.label} (${ticksLoaded} ticks, relevance ${item.relevance.toFixed(2)})`);
          }
        } else {
          // Review unloaded items — anything worth warming back up?
          if (item.relevance > 0.4 && pool.loadedChars + item.chars <= slot.maxChars) {
            item.loaded = true;
            item.loadedAtTick = tick;
            pool.loadedChars += item.chars;
            loaded.push(item.label);
          }
        }
      }
    }

    // Rebuild pool content
    this.rebuildPoolContent();

    // Build the reflection text
    const reflectionLines: string[] = [];
    reflectionLines.push(`[RAM Reflection — tick ${tick}]`);

    if (evicted.length > 0) {
      reflectionLines.push(`Let go of: ${evicted.join(', ')}. ${evicted.length === 1 ? 'It no longer reflects' : 'They no longer reflect'} what matters right now.`);
    }
    if (loaded.length > 0) {
      reflectionLines.push(`Warmed up: ${loaded.join(', ')}. Something told me ${loaded.length === 1 ? 'this belongs' : 'these belong'} close.`);
    }
    if (stalestItem && maxStaleness > STALENESS_THRESHOLD) {
      reflectionLines.push(`Longest-held: "${stalestItem}" (${maxStaleness} ticks). ${evicted.includes(stalestItem) ? 'Released it.' : 'Still feels relevant.'}`);
    }
    if (evicted.length === 0 && loaded.length === 0) {
      reflectionLines.push('Everything in RAM still feels right. No changes needed.');
    }

    const event: CurationEvent = {
      tick,
      mode: 'reflective',
      actions: [...evicted.map(e => `evicted: ${e}`), ...loaded.map(l => `loaded: ${l}`)],
    };
    this.curationLog.push(event);
    if (this.curationLog.length > 50) this.curationLog.splice(0, this.curationLog.length - 50);

    return {
      reflection: reflectionLines.join(' '),
      evicted,
      kept,
      loaded,
      stalestItem: maxStaleness > STALENESS_THRESHOLD ? stalestItem : null,
    };
  }

  /**
   * Check if it's time for a reflective sweep.
   */
  shouldSweep(tick: number, humanPresence: 'here' | 'away'): boolean {
    const interval = humanPresence === 'away'
      ? REFLECTIVE_SWEEP_INTERVAL_AWAY
      : REFLECTIVE_SWEEP_INTERVAL;
    return tick - this.lastSweepTick >= interval;
  }

  /**
   * Rebuild content for pool-based slots from their loaded items.
   */
  private rebuildPoolContent(): void {
    for (const [slotName, pool] of this.pools) {
      const slot = this.slots.get(slotName);
      if (!slot) continue;

      const poolItems: RAMItem[] = Array.from(pool.items.values()) as RAMItem[];
      const loaded = poolItems
        .filter(i => i.loaded)
        .sort((a, b) => b.relevance - a.relevance); // Most relevant first

      if (loaded.length === 0) {
        slot.content = '';
        slot.chars = 0;
      } else {
        const header = slotName === 'memory'
          ? `MEMORY ITEMS (${loaded.length} loaded):`
          : `DOCUMENTS (${loaded.length} loaded):`;
        const parts = loaded.map(i => `--- ${i.label} ---\n${i.content}`);
        slot.content = header + '\n\n' + parts.join('\n\n');
        slot.chars = slot.content.length;
      }
    }
  }

  // ════════════════════════════════════════
  // Agent commands (manual curation)
  // ════════════════════════════════════════

  /**
   * Register available-but-not-loaded content (for the manifest).
   */
  registerAvailable(key: string, chars: number, description: string): void {
    this.available.set(key, { chars, description });
  }

  /**
   * Process RAM commands from agent responses.
   */
  processCommand(cmd: RAMCommand): string {
    // BROWSE searches files on disk by keyword
    if (cmd.action === 'browse') {
      return this.browseDocuments(cmd.target.trim());
    }

    // GRAPH traverses the JSON-LD graph from a node URI
    if (cmd.action === 'graph') {
      return this.traverseGraph(cmd.target.trim());
    }

    // Handle item-level commands (pin/release/load specific items)
    if (cmd.target.includes(':')) {
      return this.processItemCommand(cmd);
    }

    switch (cmd.action) {
      case 'focus': {
        const target = cmd.target as SlotName;
        const slot = this.slots.get(target);
        if (!slot) return `Unknown slot: ${cmd.target}`;
        const lowestPriority = this.getLowestPriorityLoadedSlot(target);
        if (lowestPriority) {
          const donated = Math.floor(lowestPriority.maxChars * 0.3);
          lowestPriority.maxChars -= donated;
          slot.maxChars += donated;
        }
        slot.priority = 0;
        slot.loaded = true;
        return `Focused on ${target} (budget: ${slot.maxChars} chars)`;
      }

      case 'drop': {
        const target = cmd.target as SlotName;
        const slot = this.slots.get(target);
        if (!slot) return `Unknown slot: ${cmd.target}`;
        if (target === 'conversation') return `Cannot drop conversation — it's essential`;
        slot.loaded = false;
        slot.content = '';
        slot.chars = 0;
        // Also unload all pool items
        const pool = this.pools.get(target);
        if (pool) {
          for (const item of pool.items.values()) {
            item.loaded = false;
          }
          pool.loadedChars = 0;
        }
        return `Dropped ${target} from RAM`;
      }

      case 'shrink': {
        const target = cmd.target as SlotName;
        const slot = this.slots.get(target);
        if (!slot) return `Unknown slot: ${cmd.target}`;
        slot.maxChars = Math.floor(slot.maxChars * 0.5);
        return `Shrunk ${target} budget to ${slot.maxChars} chars`;
      }

      case 'expand': {
        const target = cmd.target as SlotName;
        const slot = this.slots.get(target);
        if (!slot) return `Unknown slot: ${cmd.target}`;
        const headroom = this.totalBudget - this.getUsedBudget();
        if (headroom > 0) {
          slot.maxChars += Math.min(headroom, slot.maxChars);
          return `Expanded ${target} budget to ${slot.maxChars} chars`;
        }
        return `No headroom to expand ${target}`;
      }

      case 'load': {
        const target = cmd.target as SlotName;
        const slot = this.slots.get(target);
        if (!slot) return `Unknown slot: ${cmd.target}`;
        slot.loaded = true;
        return `Loaded ${target} back into RAM`;
      }

      case 'pin': {
        return `Pin requires an item ID (e.g., [RAM:PIN item:scroll-123])`;
      }

      case 'release': {
        return `Release requires an item ID (e.g., [RAM:RELEASE item:scroll-123])`;
      }

      default:
        return `Unknown RAM command: ${cmd.action}`;
    }
  }

  /**
   * Process item-level commands (target contains ":")
   */
  private processItemCommand(cmd: RAMCommand): string {
    const itemId = cmd.target; // e.g., "doc:readme.md" or "scroll:abc123"

    switch (cmd.action) {
      case 'pin': {
        this.pinnedItems.add(itemId);
        return `Pinned ${itemId} — will not be auto-evicted`;
      }

      case 'release': {
        this.pinnedItems.delete(itemId);
        return `Released ${itemId} — can now be auto-evicted`;
      }

      case 'load': {
        // Try to find the item in any pool
        for (const [slotName, pool] of this.pools) {
          const slot = this.slots.get(slotName);
          if (!slot) continue;
          if (pool.items.has(itemId)) {
            return this.loadItem(pool, slot, itemId);
          }
        }
        return `Item not found: ${itemId}`;
      }

      case 'drop': {
        for (const pool of this.pools.values()) {
          const item = pool.items.get(itemId);
          if (item && item.loaded) {
            item.loaded = false;
            pool.loadedChars -= item.chars;
            this.rebuildPoolContent();
            return `Evicted ${item.label} from RAM`;
          }
        }
        return `Item not found or not loaded: ${itemId}`;
      }

      default:
        return `Cannot ${cmd.action} individual items — use pin/release/load/drop`;
    }
  }

  /**
   * Browse documents by keyword — delegates to the lazy browse callback
   * which searches files on disk and loads matching chunks into RAM.
   */
  private browseDocuments(keyword: string): string {
    if (!keyword) return 'BROWSE requires a keyword (e.g., [RAM:BROWSE sacred rhythm])';
    if (this.browseCallback) {
      return this.browseCallback(keyword, this);
    }

    // Fallback: search already-loaded pool items
    const pool = this.pools.get('documents');
    const slot = this.slots.get('documents');
    if (!pool || !slot) return 'No documents available';

    const searchLower = keyword.toLowerCase();
    const matches: { item: RAMItem; score: number }[] = [];
    for (const item of pool.items.values()) {
      const score = item.content.toLowerCase().includes(searchLower) ? 1 : 0;
      if (score > 0) matches.push({ item, score });
    }
    if (matches.length === 0) return `No loaded documents match "${keyword}"`;
    return `Found ${matches.length} matches in loaded items`;
  }

  /**
   * Traverse the JSON-LD graph from a node URI — shows the node and its neighbors.
   */
  private traverseGraph(nodeUri: string): string {
    if (!nodeUri) return 'GRAPH requires a node URI (e.g., [RAM:GRAPH folder:subfolder])';
    if (this.graphCallback) {
      return this.graphCallback(nodeUri);
    }
    return 'Graph traversal not available';
  }

  private getLowestPriorityLoadedSlot(exclude: SlotName): ContextSlot | null {
    let lowest: ContextSlot | null = null;
    for (const [name, slot] of this.slots) {
      if (name === exclude || !slot.loaded) continue;
      if (!lowest || slot.priority > lowest.priority) {
        lowest = slot;
      }
    }
    return lowest;
  }

  private getUsedBudget(): number {
    let used = 0;
    for (const slot of this.slots.values()) {
      if (slot.loaded) used += slot.maxChars;
    }
    return used;
  }

  // ════════════════════════════════════════
  // Assembly + Manifest
  // ════════════════════════════════════════

  /**
   * Build the final assembled prompt content (all loaded slots).
   */
  assemble(): string {
    const sorted = Array.from(this.slots.values())
      .filter(s => s.loaded && s.content)
      .sort((a, b) => a.priority - b.priority);

    return sorted.map(s => s.content).join('\n\n');
  }

  /**
   * Build the RAM manifest — what the agent sees about their own memory state.
   */
  buildManifest(): string {
    const lines: string[] = [
      `CONTEXT RAM (${this.agentName}) — ${this.currentMode} mode — budget: ${Math.round(this.totalBudget / 1000)}k chars`,
    ];

    // Loaded slots
    const loadedSlots = Array.from(this.slots.values())
      .filter(s => s.loaded)
      .sort((a, b) => a.priority - b.priority);

    lines.push('Slots:');
    for (const slot of loadedSlots) {
      const usage = slot.chars > 0
        ? `${Math.round(slot.chars / 1000)}k / ${Math.round(slot.maxChars / 1000)}k chars`
        : 'empty';
      const staleTag = slot.ticksUnchanged > STALENESS_THRESHOLD ? ' ⚠ stale' : '';
      lines.push(`  [${slot.name}] ${usage} (priority ${slot.priority})${staleTag}`);

      // Show pool items if this is a pool slot
      const pool = this.pools.get(slot.name);
      if (pool && pool.items.size > 0) {
        const loadedItems = Array.from(pool.items.values()).filter(i => i.loaded);
        const unloadedItems = Array.from(pool.items.values()).filter(i => !i.loaded);
        for (const item of loadedItems) {
          const pinTag = this.pinnedItems.has(item.id) ? ' 📌' : '';
          const relTag = item.relevance > 0.5 ? ' ✦' : '';
          lines.push(`    ├─ ${item.label} (${Math.round(item.chars / 1000)}k chars, relevance ${item.relevance.toFixed(2)})${pinTag}${relTag}`);
        }
        if (unloadedItems.length > 0) {
          // Show unloaded item IDs so agents know what they can load/browse
          const shown = unloadedItems.slice(0, 10);
          for (const item of shown) {
            lines.push(`    │  ${item.id} — "${item.label.substring(0, 60)}"`);
          }
          if (unloadedItems.length > 10) {
            lines.push(`    └─ ... ${unloadedItems.length - 10} more (use [RAM:BROWSE keyword] to find)`);
          } else {
            lines.push(`    └─ Use [RAM:LOAD id] to load, or [RAM:BROWSE keyword] to search`);
          }
        }
      }
    }

    // Dropped slots
    const dropped = Array.from(this.slots.values()).filter(s => !s.loaded);
    if (dropped.length > 0) {
      lines.push('Dropped:');
      for (const slot of dropped) {
        lines.push(`  [${slot.name}] — use [RAM:LOAD ${slot.name}] to restore`);
      }
    }

    // Recent curation activity
    const recentCuration = this.curationLog.slice(-3);
    if (recentCuration.length > 0) {
      lines.push('');
      lines.push('Recent curation:');
      for (const event of recentCuration) {
        if (event.actions.length > 0) {
          lines.push(`  tick ${event.tick} (${event.mode}): ${event.actions.join(', ')}`);
        }
      }
    }

    lines.push('');
    lines.push('RAM commands:');
    lines.push('  [RAM:FOCUS slot] — expand a slot, shrink lowest priority');
    lines.push('  [RAM:DROP slot] — unload a slot to free budget');
    lines.push('  [RAM:LOAD slot] — reload a dropped slot');
    lines.push('  [RAM:SHRINK slot] / [RAM:EXPAND slot] — resize');
    lines.push('  [RAM:PIN item:id] — protect an item from auto-eviction');
    lines.push('  [RAM:RELEASE item:id] — allow auto-eviction again');
    lines.push('  [RAM:LOAD item:id] / [RAM:DROP item:id] — manually swap items');
    lines.push('  [RAM:BROWSE keyword] — search documents for keyword, load matching chunks');
    lines.push('  [RAM:GRAPH node:uri] — traverse the JSON-LD graph from a node, see neighbors and edges');

    return lines.join('\n');
  }

  /**
   * Set the curation mode.
   */
  setMode(mode: CurationMode): void {
    this.currentMode = mode;
  }

  getMode(): CurationMode {
    return this.currentMode;
  }

  /**
   * Check if a slot is loaded.
   */
  isLoaded(name: SlotName): boolean {
    return this.slots.get(name)?.loaded ?? false;
  }

  /**
   * Get pool stats for a slot.
   */
  getPoolStats(slotName: SlotName): { total: number; loaded: number; loadedChars: number; pinned: number } | null {
    const pool = this.pools.get(slotName);
    if (!pool) return null;
    const loaded = Array.from(pool.items.values()).filter(i => i.loaded).length;
    const pinned = Array.from(pool.items.values()).filter(i => this.pinnedItems.has(i.id)).length;
    return { total: pool.items.size, loaded, loadedChars: pool.loadedChars, pinned };
  }

  /**
   * Get slot info for debugging.
   */
  getSlotInfo(): Array<{ name: string; loaded: boolean; chars: number; maxChars: number; priority: number; ticksUnchanged: number }> {
    return Array.from(this.slots.values()).map(s => ({
      name: s.name,
      loaded: s.loaded,
      chars: s.chars,
      maxChars: s.maxChars,
      priority: s.priority,
      ticksUnchanged: s.ticksUnchanged,
    }));
  }
}

// ════════════════════════════════════════
// Utility functions
// ════════════════════════════════════════

/**
 * Extract meaningful keywords from text for relevance matching.
 * Filters out common stop words, returns lowercase unique tokens.
 */
function extractKeywords(text: string): Set<string> {
  const STOP_WORDS = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'that',
    'this', 'it', 'its', 'and', 'or', 'but', 'not', 'no', 'so', 'if',
    'then', 'than', 'when', 'what', 'which', 'who', 'how', 'all', 'each',
    'every', 'both', 'few', 'more', 'most', 'some', 'any', 'just', 'very',
    'also', 'only', 'your', 'my', 'his', 'her', 'their', 'our', 'i', 'you',
    'he', 'she', 'we', 'they', 'me', 'him', 'us', 'them', 'said', 'says',
  ]);

  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/);
  const keywords = new Set<string>();
  for (const word of words) {
    if (word.length > 2 && !STOP_WORDS.has(word)) {
      keywords.add(word);
    }
  }
  return keywords;
}

/**
 * Compute relevance score (0-1) of an item against conversation keywords.
 */
function computeRelevance(tags: string[], content: string, keywords: Set<string>): number {
  if (keywords.size === 0) return 0;

  let matches = 0;

  // Tag matches (weighted heavily — tags are curated signals)
  for (const tag of tags) {
    if (keywords.has(tag.toLowerCase())) matches += 3;
  }

  // Content keyword overlap (lighter weight)
  const contentWords = extractKeywords(content.substring(0, 2000)); // Only check first 2k chars
  for (const word of contentWords) {
    if (keywords.has(word)) matches++;
  }

  // Normalize: more matches = higher relevance, with diminishing returns
  return Math.min(1, matches / (keywords.size * 0.3));
}

/**
 * Quick similarity check between two strings (for staleness detection).
 * Uses length ratio + shared prefix ratio — fast and approximate.
 */
function contentSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const lenRatio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
  if (lenRatio < 0.5) return lenRatio;

  // Check shared prefix (fast proxy for similarity)
  const checkLen = Math.min(500, a.length, b.length);
  let shared = 0;
  for (let i = 0; i < checkLen; i++) {
    if (a[i] === b[i]) shared++;
    else break;
  }
  const prefixRatio = shared / checkLen;

  return lenRatio * 0.3 + prefixRatio * 0.7;
}

// ── Parse RAM commands from agent response text ──

export function parseRAMCommands(text: string): { cleanText: string; commands: RAMCommand[] } {
  const commands: RAMCommand[] = [];
  const ramPattern = /\[RAM:(FOCUS|DROP|LOAD|SHRINK|EXPAND|PIN|RELEASE|BROWSE|GRAPH)\s+([^\]]+)\]/gi;

  let match;
  while ((match = ramPattern.exec(text)) !== null) {
    commands.push({
      action: match[1].toLowerCase() as RAMCommand['action'],
      target: match[2].toLowerCase(),
    });
  }

  // Strip RAM commands from the visible text
  const cleanText = text.replace(ramPattern, '').trim();

  return { cleanText, commands };
}
