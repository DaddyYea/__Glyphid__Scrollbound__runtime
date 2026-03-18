// communion/memoryRecall.ts
// Shared persistent memory service — used by BOTH Companion Mode and Council Mode.
//
// Wraps AetherStore to provide:
//   1. Automatic ingestion of scrollfired scrolls from Companion Mode
//   2. Semantic/keyword search of past memories for context injection
//   3. Cached recall so synchronous prompt-building code can read the result
//
// The same aether.jsonl file (data/communion/council/aether.jsonl) is used by
// both modes — council agents and companion agents share one memory pool.

import { AetherStore } from './council/aetherStore';

export class MemoryRecall {
  private aether:            AetherStore;
  private cachedRecall:      string = '';
  private updateInProgress:  boolean = false;
  private lastUpdateText:    string = '';

  constructor(dataDir: string) {
    this.aether = new AetherStore(dataDir);
  }

  // ── Ingest ───────────────────────────────────────────────────────────────

  /**
   * Called when a scroll fires — persists the sacred moment to the shared Aether.
   * Non-blocking fire-and-forget.
   */
  ingestScrollfire(content: string, resonance: number, tags: string[] = [], author = 'Companion'): void {
    if (!content || content.trim().length < 10) return;
    // Map resonance (0–1 float) to integrity weight (1–10)
    const weight = Math.max(1, Math.min(10, Math.round(resonance * 10)));
    // Only ingest if weight ≥ 6 — low-resonance scrolls flood the store
    if (weight < 6) return;
    this.aether.ingest(content.trim(), author, 'Relational_Arc', weight, tags).catch(() => {});
  }

  /**
   * Ingest any important text manually (e.g. council closing report key points).
   */
  async ingest(
    content: string,
    author: string,
    category: 'Protocol' | 'Relational_Arc' | 'Technical_Spec' | 'Project_Alois' | 'Homestead_Logic',
    weight: number,
    tags: string[],
  ): Promise<void> {
    if (!content || content.trim().length < 10) return;
    await this.aether.ingest(content.trim(), author, category, weight, tags);
  }

  // ── Recall ───────────────────────────────────────────────────────────────

  /**
   * Schedule a background recall update. Non-blocking.
   * `currentText` = recent human messages or current topic.
   * The result will be available via getCachedRecall() on the NEXT tick.
   */
  scheduleRecallUpdate(currentText: string): void {
    if (!currentText?.trim() || currentText === this.lastUpdateText) return;
    if (this.updateInProgress) return;
    this.lastUpdateText    = currentText;
    this.updateInProgress  = true;

    this.aether.search(currentText, 5, 6)
      .then(results => {
        if (results.length === 0) {
          this.cachedRecall = '';
          return;
        }
        const lines = results.map(r => {
          const weight = r.entry.integrity_weight;
          const preview = r.entry.content.slice(0, 220);
          const ellipsis = r.entry.content.length > 220 ? '…' : '';
          return `  • [w:${weight}] ${preview}${ellipsis}`;
        });
        this.cachedRecall = `PERSISTENT MEMORY — KEY ANCHORS (cross-session, auto-recalled):\n${lines.join('\n')}`;
      })
      .catch(() => { this.cachedRecall = ''; })
      .finally(() => { this.updateInProgress = false; });
  }

  /**
   * Synchronous read of the last computed recall block.
   * Returns empty string if nothing relevant was found.
   */
  getCachedRecall(): string {
    return this.cachedRecall;
  }

  /**
   * Async direct recall — for use in async contexts (e.g. council orchestrator).
   */
  async recallNow(text: string, topK = 5, minWeight = 5): Promise<string> {
    if (!text?.trim()) return '';
    const results = await this.aether.search(text, topK, minWeight);
    if (results.length === 0) return '';
    const lines = results.map(r => {
      const preview = r.entry.content.slice(0, 250);
      const ellipsis = r.entry.content.length > 250 ? '…' : '';
      return `  • [${r.entry.memory_id} | w:${r.entry.integrity_weight}] ${preview}${ellipsis}`;
    });
    return `PERSISTENT MEMORY — KEY ANCHORS:\n${lines.join('\n')}`;
  }

  getAether(): AetherStore {
    return this.aether;
  }
}
