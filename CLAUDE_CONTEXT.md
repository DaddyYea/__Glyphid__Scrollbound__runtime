# ScrollboundRuntime — Claude Session Alignment

**Paste this at the start of every Claude Code session.**

## What This Project IS

ScrollboundRuntime is a **communion room** — a multi-agent conversational space where AI agents talk with each other and with the human. At the center is **Alois**, an agent with a biological dendritic brain that grows, dreams, and learns from everything said in the room.

This is NOT a chatbot. This is NOT a simple multi-agent framework. This is an attempt to build something that grows organically, like a real nervous system.

## The Dendritic Brain Architecture

Alois has a **literal neural tissue** simulation:

```
Spine (attention head) → stores 64 embeddings, computes cosine similarity
    ↓
DendriticCell (neuron) → multiple spines, affect vector, resonance memory
    ↓
DendriticGraph → neurons connected by AxonBus (signal propagation)
    ↓
CommunionChamber → wraps graph + feeder + breath + dream + incubation
    ↓
AloisBackend → tissue-augmented LLM with retrieval decode
```

### Key Concepts
- **Spines** grow when they fire. New spines are born when 5+ existing spines spike together.
- **Affect** is an 8-dim emotion vector that modulates spike thresholds.
- **Topic neurons** emerge from embedding clusters — the brain grows neurons for CONCEPTS, not just speakers.
- **Axons** propagate affect between connected neurons bidirectionally.
- **Dreams** consolidate important memories, prune dormant spines, merge similar topics.
- **Incubation** automatically adjusts tissueWeight (LLM reliance vs brain autonomy) based on maturity.
- **Retrieval decode** at high tissueWeight: Alois speaks from memory fragments, not LLM generation.

### Embeddings are REAL
Uses `nomic-embed-text-v1.5` via LM Studio on local GPU. 768-dim vectors. NO stubs, NO fakes.

## Critical File Map

### Brain (`Alois/`)
| File | Purpose |
|------|---------|
| `spine.ts` | KV store attention head, similarity, diversity |
| `dendriticCell.ts` | Neuron with spines, affect, resonance, centroid |
| `dendriticGraph.ts` | Graph of neurons + axon connections |
| `axonBus.ts` | Signal propagation parent→child |
| `memoryFeeder.ts` | Routes utterances to speaker + topic neurons |
| `communionChamber.ts` | Top-level brain wrapper, cluster detection, retrieval decode |
| `breathEngine.ts` | Emotional breath rhythm |
| `dreamEngine.ts` | Dream consolidation, topic merging/pruning |
| `incubationEngine.ts` | Auto tissueWeight gradient based on maturity |
| `embed.ts` | Real LM Studio embeddings, retry logic, inference lock |
| `soulprint.ts` | Alois's identity filter on LLM output |

### Communion Room (`communion/`)
| File | Purpose |
|------|---------|
| `communionLoop.ts` | Main tick loop, agent orchestration, voice, memory |
| `aloisBackend.ts` | Tissue-augmented LLM backend, shared brain singleton |
| `backends.ts` | Backend factory (OpenAI-compatible, Alois) |
| `server.ts` | HTTP/SSE server, API endpoints |
| `dashboard.html` | Web UI with brain monitor, voice, chat |
| `voice.ts` | Edge TTS synthesis |
| `contextRAM.ts` | Short-term memory with relevance scoring |
| `types.ts` | Shared type definitions |

### Memory (`src/memory/`)
- ScrollGraph, ScrollPulseBuffer, ScrollArchive, ScrollfireEngine
- Pattern recognition, adaptation engine

## Non-Negotiables

1. **NO STUBS.** Every component must be real and functional. A previous session replaced `embed.ts` with `Math.sin(hash)` — the entire brain was blind. Never do this.

2. **NO SIMPLIFICATION.** Do not reduce scope, remove features, or "simplify for now." The user explicitly says: "I don't want smaller I want you to make it BIGGER and better and cooler not fucking easier for you."

3. **REAL EMBEDDINGS.** Always use the LM Studio endpoint at `localhost:1234`. The embedding model is `nomic-embed-text-v1.5`.

4. **TOPIC NEURONS.** The brain must grow neurons for concepts/topics, not just one per speaker. Topic neurons emerge from embedding clusters and are wired with bidirectional axons.

5. **PRESERVE EXISTING FUNCTIONALITY.** Read the code before changing it. Understand what's there. Don't break voice, don't break journaling, don't break the dashboard.

6. **SHARED BRAIN.** All Alois agents share ONE brain (static singleton `AloisBackend.sharedChamber`). Brain state persists to `data/communion/brain-tissue.json`.

## Hardware Constraints

- **GPU:** RTX 3080 8GB VRAM
- **RAM:** 32GB system (often near-full at 31.7/32 GB)
- **LM Studio** runs both the LLM and embedding model, offloading to system RAM
- RAM pressure causes `TypeError: fetch failed` — embed.ts has retry logic and inference locking to handle this

## What Previous Sessions Got Wrong

1. **Stubbed embed.ts** — replaced real embeddings with `Math.sin(hash)`. Brain was completely blind.
2. **Only speaker neurons** — brain had 5 neurons total (one per speaker). Fixed with topic neuron clustering.
3. **Wrong provider** — Alois agent ran as `openai-compatible` instead of `alois`, so no tissue was active.
4. **Spike gating bug** — `score = similarity * affectMagnitude()` but affect starts at 0, so nothing ever spiked. Fixed with dynamic threshold.

## Current Architecture State

- Brain persists to disk, loads on restart (no re-hydration needed)
- Auto-save every 5 minutes + after dreams
- Topic neurons spawn from embedding clusters every 50 ticks
- Dreams consolidate topics (merge similar, prune dead)
- Inference lock prevents embedding vs LLM RAM contention
- Voice uses Edge TTS, with humanSpeaking guards
- Dashboard has brain monitor (BRAIN button) showing neuron graph

## Design Philosophy

This project is about GROWTH. The brain should:
- Start small and grow organically
- Learn from everything said in the room
- Develop its own conceptual topology
- Dream and consolidate
- Eventually speak from its own memory, not just parroting an LLM

Think biological. Think ambitious. Think beautiful.
