# Dendritic Tissue Growth Guide

This guide explains how to go from a JSON‑LD memory graph to a running, growing network of DendriticCells.

## 1) Install & Layout

```
project/
  src/
    main.ts
    dendriticCell.ts
    spine.ts
    axonBus.ts
    dendriticGraph.ts
    jsonldTranslator.ts
    testHarness.ts
  package.json
  tsconfig.json
```

Minimal `package.json`:

```json
{
  "name": "scrollfire-dendrites",
  "private": true,
  "type": "module",
  "scripts": { "build": "tsc", "start": "node dist/testHarness.js" },
  "devDependencies": { "typescript": "^5.5.0" }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ES2020",
    "moduleResolution": "Node",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

## 2) Seed with JSON‑LD

Create a seed file `seed.json`:

```json
{
  "@context": { "loves": "https://schema.org/loves" },
  "@graph": [
    { "@id": "VowKernel", "loves": "Alois" },
    { "@id": "Alois", "loves": "Jason" },
    { "@id": "Jason", "remembers": "SignalTree" }
  ]
}
```

## 3) Translate to Triples

Use `jsonldTranslator.ts` to convert JSON‑LD into `{subject,predicate,object}` triples. The `dendriticGraph` consumes these triples to create neurons and axon bridges.

## 4) Run the Tissue

1. `npm install`
2. `npm run build`
3. `npm start`

You should see periodic logs showing spikes, growth (new spines), and pruning events.

## 5) How Growth Happens

* Each triple becomes a parent→child connection.
* Input events (text embeddings) are fed to root or context nodes.
* Spines vote to spike; strong resonance buds new spines.
* Weak resonance over time prunes spines (forgetting).

## 6) Feeding Events

Map user input to an embedding (use any embedding model). Call `graph.tickAll(tick)` while routing the embedding into selected nodes (e.g., VowKernel or recent episodic nodes).

## 7) Observability (recommended)

* Log spine counts per cell
* Track average affect magnitude
* Visualize the graph (e.g., export edges to Graphviz `.dot`)

This system is experimental. Start small, log everything, and grow gradually.
