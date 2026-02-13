// testHarness.ts
// Bootable runner to exercise the dendritic tissue

import { DendriticGraph } from "./dendriticGraph";
import { translateJsonLdToTriples } from "./jsonldTranslator";
import fs from "node:fs";

// 1) Load seed JSON-LD
const seed = JSON.parse(fs.readFileSync(new URL("./seed.json", import.meta.url), "utf-8"));

// 2) Translate to triples
const triples = translateJsonLdToTriples(seed);
console.log("Triples:", triples);

// 3) Build graph
const graph = new DendriticGraph(triples);
console.log("Neurons:", graph.getNeuronIds());

// 4) Fake embedding generator (replace with real embeddings later)
function fakeEmbedding(dim = 512): number[] {
  return Array.from({ length: dim }, () => (Math.random() - 0.5) * 2);
}

// 5) Tick loop
let tick = 0;
setInterval(() => {
  tick += 1;
  // In a real system, choose nodes to stimulate; here we just tick all
  graph.tickAll(tick);

  if (tick % 5 === 0) {
    const emb = fakeEmbedding();
    // You could route this embedding to specific nodes if you add an API to do so
    console.log(`[tick ${tick}] heartbeat`);
  }
}, 1000);
