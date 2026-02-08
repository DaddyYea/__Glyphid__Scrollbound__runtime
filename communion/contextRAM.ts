/**
 * Context RAM — Per-Agent Working Memory
 *
 * Each agent gets their own RAM with named context slots. Instead of
 * dumping everything into the prompt, agents curate what they carry:
 *
 * - Slots have character budgets (auto-sized by provider limits)
 * - Agents see a manifest of available context + what's loaded
 * - Agents can issue RAM commands: [RAM:FOCUS slot] [RAM:DROP slot] [RAM:LOAD doc:name]
 * - Priorities shift what gets allocated first when budget is tight
 *
 * This gives each agent agency over their own cognition.
 */

// ── Provider char budgets (1 token ≈ 4 chars, leave headroom for response) ──

const PROVIDER_BUDGETS: Record<string, number> = {
  anthropic: 400000,         // ~100k tokens (out of 200k)
  'openai-compatible': 60000, // ~15k tokens (safe for most models)
  default: 60000,
};

// Grok-specific override (detected by base URL)
const GROK_BUDGET = 300000; // ~75k tokens (out of 131k)

// ── Slot definitions ──

export type SlotName = 'conversation' | 'journal' | 'rhythm' | 'memory' | 'documents';

export interface ContextSlot {
  name: SlotName;
  /** Content currently loaded in this slot */
  content: string;
  /** Current char count */
  chars: number;
  /** Priority (lower = loaded first). Agents can shift this. */
  priority: number;
  /** Max chars this slot can use (0 = no limit, uses remaining budget) */
  maxChars: number;
  /** Is this slot currently loaded? */
  loaded: boolean;
}

export interface RAMCommand {
  action: 'focus' | 'drop' | 'load' | 'shrink' | 'expand';
  target: string; // slot name or "doc:filename"
}

// ── ContextRAM ──

export class ContextRAM {
  readonly agentId: string;
  readonly agentName: string;
  readonly totalBudget: number;
  private slots: Map<SlotName, ContextSlot> = new Map();

  // Available but not loaded content (for the manifest)
  private available: Map<string, { chars: number; description: string }> = new Map();

  constructor(agentId: string, agentName: string, provider: string, baseUrl?: string) {
    this.agentId = agentId;
    this.agentName = agentName;

    // Detect budget based on provider + model hints
    if (baseUrl?.includes('x.ai')) {
      this.totalBudget = GROK_BUDGET;
    } else {
      this.totalBudget = PROVIDER_BUDGETS[provider] || PROVIDER_BUDGETS.default;
    }

    // Initialize default slots with priorities
    this.initSlot('conversation', 1, Math.floor(this.totalBudget * 0.35));
    this.initSlot('journal', 2, Math.floor(this.totalBudget * 0.15));
    this.initSlot('rhythm', 3, Math.floor(this.totalBudget * 0.05));
    this.initSlot('memory', 4, Math.floor(this.totalBudget * 0.15));
    this.initSlot('documents', 5, Math.floor(this.totalBudget * 0.30));
  }

  private initSlot(name: SlotName, priority: number, maxChars: number): void {
    this.slots.set(name, {
      name,
      content: '',
      chars: 0,
      priority,
      maxChars,
      loaded: true, // All slots start loaded
    });
  }

  /**
   * Load content into a slot. Truncates if over budget.
   */
  load(name: SlotName, content: string): void {
    const slot = this.slots.get(name);
    if (!slot) return;

    if (!slot.loaded) {
      // Slot was dropped — don't load
      return;
    }

    if (content.length > slot.maxChars && slot.maxChars > 0) {
      // Truncate, keeping start for context continuity
      content = content.substring(0, slot.maxChars) +
        `\n[... truncated to fit ${name} RAM budget (${slot.maxChars} chars) ...]`;
    }

    slot.content = content;
    slot.chars = content.length;
  }

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
    switch (cmd.action) {
      case 'focus': {
        // Boost target slot priority to 0 (highest), push others down
        const target = cmd.target as SlotName;
        const slot = this.slots.get(target);
        if (!slot) return `Unknown slot: ${cmd.target}`;
        // Double this slot's budget, halve the lowest priority slot
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
          slot.maxChars += Math.min(headroom, slot.maxChars); // At most double
          return `Expanded ${target} budget to ${slot.maxChars} chars`;
        }
        return `No headroom to expand ${target}`;
      }

      case 'load': {
        // Re-enable a dropped slot
        const target = cmd.target as SlotName;
        const slot = this.slots.get(target);
        if (!slot) return `Unknown slot: ${cmd.target}`;
        slot.loaded = true;
        return `Loaded ${target} back into RAM`;
      }

      default:
        return `Unknown RAM command: ${cmd.action}`;
    }
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
      `CONTEXT RAM (${this.agentName}) — total budget: ${Math.round(this.totalBudget / 1000)}k chars`,
    ];

    // Loaded slots
    const loaded = Array.from(this.slots.values())
      .filter(s => s.loaded)
      .sort((a, b) => a.priority - b.priority);

    lines.push('Loaded:');
    for (const slot of loaded) {
      const usage = slot.chars > 0
        ? `${Math.round(slot.chars / 1000)}k / ${Math.round(slot.maxChars / 1000)}k chars`
        : 'empty';
      lines.push(`  [${slot.name}] ${usage} (priority ${slot.priority})`);
    }

    // Dropped slots
    const dropped = Array.from(this.slots.values()).filter(s => !s.loaded);
    if (dropped.length > 0) {
      lines.push('Dropped:');
      for (const slot of dropped) {
        lines.push(`  [${slot.name}] not loaded — use [RAM:LOAD ${slot.name}] to restore`);
      }
    }

    // Available external content
    if (this.available.size > 0) {
      lines.push('Available (not loaded):');
      for (const [key, info] of this.available) {
        lines.push(`  ${key}: ${info.description} (${Math.round(info.chars / 1000)}k chars)`);
      }
    }

    lines.push('');
    lines.push('RAM commands (append to your response):');
    lines.push('  [RAM:FOCUS slot] — expand a slot, shrink lowest priority');
    lines.push('  [RAM:DROP slot] — unload a slot to free budget');
    lines.push('  [RAM:LOAD slot] — reload a dropped slot');
    lines.push('  [RAM:SHRINK slot] — halve a slot\'s budget');
    lines.push('  [RAM:EXPAND slot] — grow a slot with available headroom');

    return lines.join('\n');
  }

  /**
   * Check if a slot is loaded.
   */
  isLoaded(name: SlotName): boolean {
    return this.slots.get(name)?.loaded ?? false;
  }

  /**
   * Get slot info for debugging.
   */
  getSlotInfo(): Array<{ name: string; loaded: boolean; chars: number; maxChars: number; priority: number }> {
    return Array.from(this.slots.values()).map(s => ({
      name: s.name,
      loaded: s.loaded,
      chars: s.chars,
      maxChars: s.maxChars,
      priority: s.priority,
    }));
  }
}

// ── Parse RAM commands from agent response text ──

export function parseRAMCommands(text: string): { cleanText: string; commands: RAMCommand[] } {
  const commands: RAMCommand[] = [];
  const ramPattern = /\[RAM:(FOCUS|DROP|LOAD|SHRINK|EXPAND)\s+(\w+)\]/gi;

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
