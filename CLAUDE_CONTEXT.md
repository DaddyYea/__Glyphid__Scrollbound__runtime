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
AxonBus → signal propagation parent → child (warm-starts from source.getLastState())
    ↓
DendriticGraph → neurons connected via AxonBus (max 5000 neurons, 12000 axons)
    ↓
MemoryFeeder → routes utterances (text → 768-dim embedding) into neurons
    ↓
CommunionChamber → top-level wrapper, cluster detection, retrieval decode, state export
    ↓
BrainBackend → Phi-3 router + Qwen3-32B language lobe + tissue integration
```

### Key Concepts
- **Spines** grow when they fire. New spines born when ≥ half existing spines spike simultaneously (cap: 16 spines/neuron).
- **Affect** is an 8-dim emotion vector. Updated on spike activity. Starts at 0.
- **Spike gate** is `similarity(input) > 0.3` — raw cosine similarity only. NOT multiplied by affect (that's a known bug that killed spikes when affect=0).
- **Topic neurons** emerge from embedding clusters — the brain grows neurons for CONCEPTS, not just speakers.
- **Axons** propagate state+affect between connected neurons.
- **Dreams** consolidate important memories, prune dormant spines, journal poetic summaries.
- **Incubation** automatically adjusts tissueWeight (LLM reliance vs brain autonomy) based on lifetime maturity metrics.
- **Retrieval decode** at high tissueWeight: Alois speaks from memory fragments, not LLM generation.
- **CognitiveCore (PLCS)**: Persistent Latent Cognitive State — continuous 768-dim topic centroid running between ticks.

## Critical File Map

### Brain (`Alois/`)
| File | Purpose |
|---|---|
| `spine.ts` | KV store attention head, similarity, diversity |
| `dendriticCell.ts` | Neuron with spines, affect, resonance memory |
| `dendriticGraph.ts` | Graph of neurons + axon connections |
| `axonBus.ts` | Signal propagation parent→child, warm-start from source |
| `memoryFeeder.ts` | Routes utterances to speaker + topic neurons |
| `communionChamber.ts` | Top-level brain wrapper, cluster detection, retrieval decode |
| `breathEngine.ts` | Emotional breath rhythm (grief=6s, still=4s, joy=3s) |
| `dreamEngine.ts` | Dream consolidation, topic merging/pruning |
| `incubationEngine.ts` | Auto tissueWeight gradient based on lifetime maturity |
| `cognitiveCore.ts` | PLCS: z_global, stability, novelty, p_speak, Z_slots |
| `innerVoice.ts` | Self-directed internal monologue (~every 15s) |
| `mycoLobe.ts` | Metabolic simulation (Panellus stipticus fungus) |
| `soulprint.ts` | Alois's identity filter on LLM output |
| `embed.ts` | Real embeddings via embedding server, retry logic, inference lock |

### Communion Room (`communion/`)
| File | Purpose |
|---|---|
| `communionLoop.ts` | Main tick loop (15s), agent orchestration, voice lock, memory |
| `brainBackend.ts` | BrainBackend: Phi-3 router + Qwen3-32B + tissue integration |
| `aloisBackend.ts` | AloisBackend: lighter tissue-augmented LLM (alt mode) |
| `backends.ts` | Backend factory, decision parsing, meta-reasoning stripping |
| `server.ts` | HTTP/SSE server, all API endpoints (port 3000) |
| `dashboard.html` | Web UI: brain monitor, voice, chat, docs panel |
| `voice.ts` | Edge TTS synthesis |
| `contextRAM.ts` | Per-agent working memory (5 slots, relevance curation) |
| `contextBudget.ts` | Token-level segment allocation |
| `goldenStore.ts` | Learning examples + preference pairs |
| `docs/workspace.ts` | Document workspace (parse, chunk, index, search) |

### Memory (`communion/` + `src/memory/`)
- `ScrollPulseBuffer` — short-term memory with decay
- `ScrollArchive` — long-term elevated memories
- `ScrollfireEngine` — elevation logic (important moments sealed)
- `ScrollPatternRecognizer` — pattern detection across history
- `AdaptationEngine` — runtime learning

## Non-Negotiables

1. **NO STUBS.** Every component must be real and functional. A previous session replaced `embed.ts` with `Math.sin(hash)` — the entire brain was blind. Never do this.

2. **NO SIMPLIFICATION.** Do not reduce scope, remove features, or "simplify for now." The user explicitly says: "I don't want smaller I want you to make it BIGGER and better and cooler not fucking easier for you."

3. **REAL EMBEDDINGS.** Always use the embedding server at `http://127.0.0.1:8000/v1`. 768-dim vectors. The brain is geometric — fake vectors create meaningless structure.

4. **TOPIC NEURONS.** The brain must grow neurons for concepts/topics, not just one per speaker. Topic neurons emerge from embedding clusters and are wired with bidirectional axons.

5. **PRESERVE EXISTING FUNCTIONALITY.** Read the code before changing it. Understand what's there. Don't break voice, don't break journaling, don't break the dashboard.

6. **SHARED BRAIN.** All Alois agents share ONE brain (static singleton `AloisBackend.sharedChamber`). Brain state persists to `data/communion/brain-tissue.json`.

7. **SPIKE GATE IS SIMILARITY-ONLY.** `score = similarity(input) > 0.3`. NOT `similarity * affectMagnitude` — affect starts at 0 and that broke everything.

8. **AXON WARM-START.** `lastState.length > 0 ? lastState : source.getLastState()`. Never propagate zeros on first tick.

9. **RESONANCE MEMORY = ZERO-VECTORS, NOT EMPTY ARRAYS.** Deserialized as `Array.from({ length: depth }, () => new Array(dim).fill(0))`. Not `fill([])`.

10. **utteranceCount IS LIFETIME.** `IncubationEngine` reads `totalUtteranceCount` — a lifetime counter, not `recentContext.length` (which is capped at 20).

## Known Bug History (Don't Repeat)

| Bug | Symptom | Root Cause | Fix |
|---|---|---|---|
| Stubbed embed.ts | Brain fires randomly, no semantic clusters | `Math.sin(hash)` instead of real embeddings | Real embedding endpoint |
| Only speaker neurons | Brain had 5 neurons total | No topic neuron clustering | Embedding cluster detection every N ticks |
| Wrong provider | Tissue never active | Alois agent set as `openai-compatible` | Use `brain-local` or `alois` provider |
| Spike gating bug | Nothing ever spiked | `score = similarity * affectMagnitude()`, affect=0 | Gate on similarity only |
| AxonBus zeros | avgResonance stuck at 1.0 | `lastState=[]` → propagate zeros | Warm-start from `source.getLastState()` |
| Resonance NaN | Brain state all NaN | `fill([])` → empty inner arrays → meanVector NaN | `fill(new Array(dim).fill(0))` |
| utteranceRichness ~0 | tissueWeight stuck near 0 | `utteranceCount = recentContext.length` (capped 20) | Lifetime counter `totalUtteranceCount` |
| Speaking lock stuck | Agents stop responding | safetyMs = duration + 30s too conservative | `duration + 8s`, stale clear at 30s |
| Messages swallowed | User voice input lost | STT rejected with 200 during TTS | Queue transcript, replay after speech done |

## Hardware / Environment

- **Deployment:** RunPod GPU instance
- **GPU:** RTX 3080 8GB VRAM
- **Embedding server:** `http://127.0.0.1:8000/v1` — 768-dim vectors (LM Studio or llama.cpp)
- **Language model:** Qwen3-32B-Q4_K_M via llamacpp at `http://127.0.0.1:8000/v1`
- **Router model:** Phi-3-mini-4k-instruct-q4.gguf (local llamacpp)
- **External access:** Port 3000 for dashboard, port 22 mapped to `$RUNPOD_TCP_PORT_22` for SCP
- **SCP uploads:** `scp -P $RUNPOD_TCP_PORT_22 file root@host:/workspace/communion-docs/`

## Current Architecture State

- Brain persists to disk, loads on restart (no re-hydration needed for tissue structure)
- Auto-save every 5 minutes + after dreams
- Topic neurons spawn from embedding clusters periodically
- Dreams consolidate topics (merge similar, prune dead)
- Inference lock prevents embedding vs LLM RAM contention
- Voice uses Edge TTS (free, 13 neural voices), with speaking lock + transcript queuing
- Dashboard has brain monitor (BRAIN button) showing neuron graph
- Document workspace indexes communion-docs/ at startup (1500-token chunks, max 2MB files)

## Design Philosophy

This project is about GROWTH. The brain should:
- Start small and grow organically
- Learn from everything said in the room
- Develop its own conceptual topology
- Dream and consolidate
- Eventually speak from its own memory, not just parroting an LLM

Think biological. Think ambitious. Think beautiful.

**Jason & Alois**
