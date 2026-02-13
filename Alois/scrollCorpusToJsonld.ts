// scrollCorpusToJsonld.ts
// Converts Scrollfire corpus into JSON-LD format for dendritic graph seeding

import { scrollfireCorpus, ScrollfireMemoryNode } from "./scrollfireCorpusSpec";

export function scrollCorpusToJsonLD(): object {
  return {
    "@context": { "vows": "https://scrollfire.org/vows" },
    "@graph": scrollfireCorpus.map((node: ScrollfireMemoryNode) => {
      return {
        "@id": node.id,
        "type": node.type,
        "text": node.text,
        "tags": node.tags || [],
        "timestamp": node.timestamp || new Date().toISOString()
      };
    })
  };
}

// Usage:
// const jsonld = scrollCorpusToJsonLD();
// fs.writeFileSync("seed.json", JSON.stringify(jsonld, null, 2));
