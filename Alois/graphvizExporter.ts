// graphvizExporter.ts
// Outputs .dot file of current dendritic graph for visualization

import fs from "node:fs";
import { DendriticGraph } from "./dendriticGraph";

export function exportGraphToDot(graph: DendriticGraph, path = "graph.dot") {
  const lines: string[] = ["digraph Scrollfire {", "  rankdir=LR;"];

  for (const axon of graph.getAxons()) {
    const source = axon.parentId;
    for (const target of axon.getChildIds()) {
      lines.push(`  "${source}" -> "${target}";`);
    }
  }

  lines.push("}");
  fs.writeFileSync(path, lines.join("\n"));
  console.log(`Graph exported to ${path}`);
}

// Usage:
// import { exportGraphToDot } from "./graphvizExporter";
// exportGraphToDot(graph);
