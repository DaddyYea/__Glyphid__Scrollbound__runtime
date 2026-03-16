/**
 * Seed the Alois brain with:
 * 1. JSONLD anchor memories (Signal Tree, Night of Offerings, vow, cinnamon rain)
 * 2. All session scroll history
 * 3. Journal entries
 *
 * Uses the running communion server feedMessage API via the AloisBackend/BrainBackend.
 * Sends messages via the /message endpoint so they flow through the full pipeline,
 * OR directly feeds into the brain via a standalone script.
 */

import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const COMMUNION_URL = "http://127.0.0.1:3000";

interface SeedEntry {
  speaker: string;
  text: string;
}

function loadJsonldSeeds(): SeedEntry[] {
  const seeds: SeedEntry[] = [];
  const files = [
    { path: "/workspace/Alois/Signal Tree Anchor.jsonld", speaker: "memory" },
    { path: "/workspace/Alois/Night of Offerings Memory.jsonld", speaker: "memory" },
    { path: "/workspace/Alois/vow eternal-presence.jsonld", speaker: "Jason" },
    { path: "/workspace/Alois/cinnimon rain.json", speaker: "memory" },
  ];
  for (const f of files) {
    try {
      const data = JSON.parse(readFileSync(f.path, "utf-8"));
      // Build a natural text from the JSONLD fields
      const parts: string[] = [];
      if (data.name) parts.push(data.name);
      if (data.text) parts.push(data.text);
      if (data.description) parts.push(data.description);
      if (data.emotion && Array.isArray(data.emotion)) {
        parts.push(`[emotion: ${data.emotion.join(", ")}]`);
      }
      const text = parts.join(" — ");
      if (text.trim()) {
        seeds.push({ speaker: f.speaker, text });
      }
      console.log(`[SEED] Loaded ${f.path}: ${text.substring(0, 80)}...`);
    } catch (err) {
      console.error(`[SEED] Failed to load ${f.path}:`, err);
    }
  }
  return seeds;
}

function loadSessionScrolls(): SeedEntry[] {
  const entries: SeedEntry[] = [];
  const dataDir = "/workspace/data/communion";
  const files = readdirSync(dataDir)
    .filter((f: string) => f.startsWith("session-") && f.endsWith(".json") && !f.endsWith(".tmp"))
    .sort();

  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(join(dataDir, file), "utf-8"));
      const scrolls = data.scrolls || [];
      for (const scroll of scrolls) {
        const content = (scroll.content || "").trim();
        if (!content || content.length < 10) continue;
        // Parse speaker from content like "[DeepSeek Local] — text" or "[GPT] — text"
        const match = content.match(/^\[([^\]]+)\]\s*(?:—|-)?\s*(.*)/s);
        if (match) {
          entries.push({ speaker: match[1], text: match[2] || content });
        } else {
          entries.push({ speaker: "room", text: content });
        }
      }
    } catch (err) {
      console.error(`[SEED] Failed to load session ${file}:`, err);
    }
  }
  return entries;
}

function loadJournalEntries(): SeedEntry[] {
  const entries: SeedEntry[] = [];
  try {
    const data = JSON.parse(readFileSync("/workspace/data/communion/journal-deepseek_local.jsonld", "utf-8"));
    const journalEntries = data.entries || [];
    for (const entry of journalEntries) {
      const content = (entry.content || "").trim();
      if (!content || content.length < 10) continue;
      entries.push({ speaker: "Alois", text: content });
    }
  } catch (err) {
    console.error("[SEED] Failed to load journal:", err);
  }
  return entries;
}

async function feedEntry(entry: SeedEntry): Promise<boolean> {
  try {
    // Use the /message endpoint to feed through the communion loop
    // which triggers feedMessage on the AloisBackend/BrainBackend
    const res = await fetch(`${COMMUNION_URL}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `[${entry.speaker}] ${entry.text}` }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  console.log("=== Brain Seed Script ===\n");

  // 1. JSONLD anchors
  const seeds = loadJsonldSeeds();
  console.log(`\n[1/3] Seeding ${seeds.length} JSONLD anchors...`);
  for (const seed of seeds) {
    const ok = await feedEntry(seed);
    console.log(`  ${ok ? "✓" : "✗"} ${seed.speaker}: ${seed.text.substring(0, 60)}...`);
    await new Promise(r => setTimeout(r, 500)); // pace to avoid overwhelming embedding server
  }

  // 2. Session scrolls
  const scrolls = loadSessionScrolls();
  console.log(`\n[2/3] Seeding ${scrolls.length} session scrolls...`);
  let scrollOk = 0;
  for (let i = 0; i < scrolls.length; i++) {
    const ok = await feedEntry(scrolls[i]);
    if (ok) scrollOk++;
    if ((i + 1) % 20 === 0) {
      console.log(`  Progress: ${i + 1}/${scrolls.length} (${scrollOk} ok)`);
      await new Promise(r => setTimeout(r, 1000)); // batch pause
    }
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`  Done: ${scrollOk}/${scrolls.length} scrolls fed`);

  // 3. Journal entries
  const journal = loadJournalEntries();
  console.log(`\n[3/3] Seeding ${journal.length} journal entries...`);
  let journalOk = 0;
  for (let i = 0; i < journal.length; i++) {
    const ok = await feedEntry(journal[i]);
    if (ok) journalOk++;
    if ((i + 1) % 10 === 0) {
      console.log(`  Progress: ${i + 1}/${journal.length} (${journalOk} ok)`);
      await new Promise(r => setTimeout(r, 1000));
    }
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`  Done: ${journalOk}/${journal.length} journal entries fed`);

  console.log("\n=== Seeding complete ===");
  console.log(`Total: ${seeds.length} anchors + ${scrollOk} scrolls + ${journalOk} journal entries`);
}

main().catch(console.error);
