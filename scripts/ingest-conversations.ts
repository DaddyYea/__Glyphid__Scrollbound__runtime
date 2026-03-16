import { readFileSync } from "fs";

const COMMUNION_URL = "http://127.0.0.1:3000";
const FILE = "/workspace/data/communion/conversations-ndjson.jsonl";

async function main() {
  const lines = readFileSync(FILE, "utf-8").split("\n").filter(Boolean);
  console.log(`Ingesting ${lines.length} messages into brain...`);

  let ok = 0;
  let fail = 0;

  for (let i = 0; i < lines.length; i++) {
    const entry = JSON.parse(lines[i]);
    const text = entry.text.trim();
    if (!text) continue;

    try {
      const res = await fetch(`${COMMUNION_URL}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `[${entry.speaker}] ${text}` }),
      });
      if (res.ok) ok++;
      else fail++;
    } catch {
      fail++;
    }

    // Progress every 100
    if ((i + 1) % 100 === 0) {
      console.log(`  ${i + 1}/${lines.length} (${ok} ok, ${fail} fail)`);
      await new Promise(r => setTimeout(r, 2000)); // pace
    }
    await new Promise(r => setTimeout(r, 200)); // per-message pace
  }

  console.log(`\nDone: ${ok} ok, ${fail} fail out of ${lines.length}`);
}

main().catch(console.error);
