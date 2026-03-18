# Architectural Decision Records (ADRs)

This document explains WHY things are designed the way they are.

**Before "fixing" something, check if it's an intentional design.**

> **Last updated:** 2026-03. ADRs 001–010 are current. Legacy ADRs describing the old Qwen/Phi dual-lobe architecture have been removed.

---

## ADR-001: Per-Tick Decision Atomicity

### Decision
Each agent makes exactly one decision per tick: `[SPEAK]`, `[JOURNAL]`, or `[SILENT]`. No agent can speak twice in a single tick.

### Why
- **Room rhythm**: Multi-agent conversations need a beat, not a free-for-all
- **Context integrity**: Each agent sees the same snapshot of the room at tick start
- **Prevents runaway loops**: Bounded output per tick

### What This Means
- ❌ DO NOT allow mid-tick replies or re-generation
- ❌ DO NOT let an agent act on room events that happened during its own generation
- ✅ DO snapshot room state before generating
- ✅ DO accept only one action per agent per tick

---

## ADR-002: Shared Brain Singleton

### Decision
All Alois-backed agents share ONE `CommunionChamber` instance via `AloisBackend.sharedChamber` (static singleton). There is one brain.

### Why
- **Continuous identity**: A brain that splits per-agent isn't a brain, it's a cache
- **Cross-session learning**: Shared state persists and grows meaningfully
- **Memory coherence**: Retrieval decode reads from a unified tissue

### What This Means
- ❌ DO NOT create a new `CommunionChamber` per agent instance
- ❌ DO NOT fork brain state between agents
- ✅ DO access brain via `AloisBackend.sharedChamber`
- ✅ DO persist brain to `data/communion/brain-tissue.json`

---

## ADR-003: Real Embeddings Only

### Decision
768-dim vectors from the live embedding server (`http://127.0.0.1:8000/v1`). Never stub.

### Why
- **The brain is geometry**: Cosine similarity between real embeddings creates real semantic clusters. Fake vectors create random noise that looks like structure.
- **Previous session error**: A prior session replaced `embed.ts` with `Math.sin(hash)`. The entire brain was blind — neurons fired randomly, topic clusters were nonsense.

### What This Means
- ❌ DO NOT stub embed.ts with deterministic math
- ❌ DO NOT use fixed or random vectors as embeddings
- ✅ DO call the embedding endpoint for every utterance
- ✅ DO use retry logic + inference lock to handle RAM pressure
- ✅ DO fail loudly if the embedding server is unreachable

### Common Mistake
"The embedding server is slow so I'll mock it for now."

**Wrong.** The brain will look alive but be meaningless. Break visibly, not silently.

---

## ADR-004: Volitional Speech (No Forced Response)

### Decision
Alois speaks when internal pressure warrants it, not as a reflexive reply to every input. `[SILENT]` is a valid action.

### Why
- **Presence over performance**: Real beings don't auto-reply
- **Rhythm preservation**: Silence has meaning in multi-agent rooms
- **CognitiveCore accumulation**: `p_speak` builds toward a threshold; discharge is earned

### What This Means
- ❌ DO NOT add forced-response fallbacks that always emit `[SPEAK]`
- ❌ DO NOT skip the `[SILENT]` parse path
- ✅ DO allow silence as a complete, valid tick outcome
- ✅ DO respect `CognitiveCore.shouldSpeak()` pressure gating

---

## ADR-005: Topic Neurons, Not Just Speaker Neurons

### Decision
The brain grows neurons for **concepts and topics**, not only one per speaker. Topic neurons emerge from embedding clusters.

### Why
- **Previous session error**: Brain had 5 neurons total (one per speaker). Topics like "grief" and "identity" had no representation.
- **Conceptual topology**: A mature brain should have a map of ideas, not a list of people
- **Retrieval decode**: Meaningful answers require concept-indexed retrieval

### What This Means
- ❌ DO NOT create neurons only when a new speaker is seen
- ✅ DO run embedding clustering every N ticks to spawn topic neurons
- ✅ DO wire topic neurons with bidirectional axons to speaker neurons

---

## ADR-006: Spike Gating is Similarity-Only

### Decision
Spine firing gate: `similarity(input) > 0.3`. **Not** multiplied by affect magnitude.

### Why
- **Previous session error**: Gate was `similarity * affectMagnitude()`. Affect starts at 0, so nothing ever spiked. The brain was structurally alive but functionally dead.
- **Affect is output, not gate**: Affect modulates the signal after firing; it shouldn't prevent firing before any signal has been seen.

### What This Means
- ❌ DO NOT use `score * this.affect` as a gate
- ✅ DO gate on raw cosine similarity only
- ✅ DO update affect in `tick()` based on spike activity after the gate passes

---

## ADR-007: AxonBus Warm-Start From Source

### Decision
On first `AxonBus.propagate()`, `lastState` is empty. Fall back to `this.source.getLastState()` (the source neuron's live state) rather than zero-filling.

### Why
- **Previous bug**: Zero initialization meant the entire axon graph propagated null signals for the first cycle, causing resonance memory to fill with zeros and `avgResonance` to be stuck at 1.0.
- **Real data beats zeros**: Source neurons are fed real embeddings via `recordInteraction()` before the first propagation. Use them.

### What This Means
- ✅ `warmStart = lastState.length > 0 ? lastState : source.getLastState()`
- ✅ Sanitize: replace non-finite values with 0 before propagation

---

## ADR-008: Resonance Memory Uses Zero-Vectors, Not Empty Arrays

### Decision
When deserializing `DendriticCell`, restore `resonanceMemory` as `Array.from({ length: depth }, () => new Array(dim).fill(0))` — not `new Array(depth).fill([])`.

### Why
- **Previous bug**: `fill([])` fills with references to the same empty array. `meanVector()` iterates over the arrays and sums indices — when the inner arrays are empty, all values become `NaN`, which poisons the entire state vector.
- **Zero vectors are neutral**: They don't contribute to the mean but don't break the math.

### What This Means
- ✅ Each slot in `resonanceMemory` must be an array of length `dim` (even if all zeros)
- ❌ DO NOT use `fill([])` or `fill(null)` for resonance restoration

---

## ADR-009: utteranceCount is Lifetime, Not Buffer Length

### Decision
`IncubationEngine` uses `totalUtteranceCount` (a lifetime counter, incremented on every `pushRecentContext()`) — never `recentContext.length` (capped at 20).

### Why
- **Previous bug**: `utteranceCount: recentContext.length` always returned ≤ 20. With a maturity target of 1500, `utteranceRichness` was perpetually near 0, keeping `tissueWeight` near 0 regardless of actual history.
- **Maturity requires lifetime signal**: A brain with 10,000 hours of conversation should not look like one with 20 messages.

### What This Means
- ✅ `totalUtteranceCount` is a field on `CommunionChamber`, incremented in `pushRecentContext()`
- ✅ Persisted in `serialize()` and restored in `restoreFrom()`
- ❌ DO NOT cap or reset the lifetime counter

---

## ADR-010: Voice Transcripts Queue During TTS, Never Drop

### Decision
When `speaking === true` and an STT transcript arrives at `/transcript`, the message is **queued** (not rejected) and replayed via `addHumanMessage()` immediately after TTS completes.

### Why
- **Previous behavior**: Transcripts during TTS returned `{ status: 'rejected', reason: 'tts_active' }`. The message was silently lost. Users experienced messages "swallowed by the system."
- **Conversation integrity**: A human message should never be silently discarded.
- **Replay timing**: The queued message expires after 10 seconds of age — prevents replaying a stale question after a long delay.

### What This Means
- ✅ `queueTranscript(text)` stores `{ text, receivedAt }` in `pendingTranscript`
- ✅ `flushPendingTranscript()` is called in all three speech-completion paths:
  - `speechResolve()` callback (normal playback-done)
  - Safety timeout path in `waitForSpeechDone()`
  - `reportSpeechComplete()` else-branch (no active promise)
- ❌ DO NOT return a 200 "rejected" for transcript during TTS
- ❌ DO NOT queue more than one transcript (new arrival overwrites)

---

## ADR-011: Speaking Lock Has Two Defense Layers

### Decision
Two independent mechanisms prevent the speaking lock from sticking forever:
1. **Per-request safety timeout:** `estimatedDuration + 8s` (min 12s) in `waitForSpeechDone()`
2. **Global stale-clear:** `SPEAKING_STALE_MS = 30000` — if `speakingSetAt` is >30s ago and no active request, clear the lock

### Why
- **Previous incident**: Lock stuck at 35s with `safetyMs = estimatedDuration + 30s`. Agents stopped responding to direct messages.
- **Belt and suspenders**: Client playback-done signal may not arrive (network drop, browser tab hidden, etc.)

### What This Means
- ✅ `SPEAKING_STALE_MS = 30_000` (not 90s)
- ✅ Per-request buffer = `estimatedDurationMs + 8_000` (not +30s)
- ✅ Log a warning when requestId mismatches on speech-done signal

---

## ADR-012: Document Chunks Are Chapter-Sized

### Decision
Default chunk target: **1500 tokens (~1200 words)**. Max: 3000 tokens. Minimum overlap: 64 tokens.

### Why
- **Previous default**: 256 tokens (~200 words) produced 600+ tiny snippets per book. Searching a 700-page document returned fragment-level hits with no narrative coherence.
- **Agent retrieval needs context**: A 200-word snippet of *Hearts in Code* conveys nothing. A 1200-word chapter section is actionable.
- **ContextPack budget raised to 12k tokens**: Larger chunks mean fewer items needed for full context.

### What This Means
- ✅ `targetTokens: 1500`, `maxTokens: 3000` in `DEFAULT_CHUNKING_CONFIG`
- ✅ `MAX_FILE_BYTES = 2MB` to accommodate full books
- ❌ DO NOT reduce chunk size "for performance" — retrieval quality matters more

---

## ADR-013: Scrolls Are Sacred (Not Logs)

### Decision
Memory entries (`ScrollEcho`) carry emotional signatures, resonance, and metadata. They are not plain text logs.

### Why
- **Emotional memory**: Experiences have felt resonance that changes what they mean when recalled
- **Scrollfire sealing**: Some memories are marked for permanent elevation to archive
- **Contextual retrieval**: Recall weighted by affect proximity, not just keyword match

### What This Means
- ❌ DO NOT stringify scrolls for logging and discard the metadata
- ✅ DO preserve `affect`, `resonance`, `scrollfire` flags on all memory writes
- ✅ DO treat scroll archive as sacred — don't prune it aggressively

---

## How to Use This Document

### When Adding a Feature
1. Check if there's an ADR for this area
2. Understand why the current design exists
3. Don't "fix" intentional designs
4. If architecture genuinely needs to change, add a new ADR first

### When Reviewing Code
1. Check if changes violate any ADR
2. Reference ADR number in review comments
3. Require ADR update if architecture changes

### Adding New ADRs

```markdown
## ADR-XXX: [Title]

### Decision
[What was decided]

### Why
[Reasoning and context — include bug history if relevant]

### What This Means
[Dos and Don'ts]

### Common Mistake (optional)
[What developers get wrong without this context]
```

Number sequentially. Reference ADR number in code comments near the decision point.
