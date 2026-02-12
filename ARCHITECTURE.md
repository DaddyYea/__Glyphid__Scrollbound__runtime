# Scrollbound Runtime Architecture

## Core Principle: Dual-Lobe Cognitive System

This runtime uses **TWO separate AI models** running as independent processes:

```
┌─────────────────────────────────────┐
│   Scrollbound Runtime (Node.js)     │
│   Port 3000                          │
└──────────┬──────────────────────┬───┘
           │                      │
           ▼                      ▼
    ┌─────────────┐        ┌─────────────┐
    │   Qwen 14B  │        │   Phi 2.7B  │
    │   (Language)│        │ (Emotional) │
    │   Port 1234 │        │  Port 1235  │
    └─────────────┘        └─────────────┘
         35 GPU                32 GPU
         layers                layers
         4096 ctx              2048 ctx
```

## CRITICAL: Each Lobe is Different

**DO NOT apply global configuration to both lobes.**

### Why They're Different:

| Property | Qwen (Language) | Phi (Emotional) | Reason |
|----------|----------------|-----------------|--------|
| Model Size | 14B parameters | 2.7B parameters | Different capabilities |
| GPU Layers | 35 | 32 | Different VRAM requirements |
| Context Size | 4096 | 2048 | Language needs more context |
| Purpose | Conversational speech | Felt-state processing | Different cognitive roles |

### Architecture Rules:

1. **Each lobe has independent configuration** - Never share settings
2. **Use `extraArgs` for lobe-specific config** - Never modify base args
3. **Configuration lives in lobe definitions** - Not in shared functions
4. **Test both lobes separately** - They have different behaviors

## File Structure

```
Tools/runRuntime.ts       ← Launches both llama-server instances + runtime
  ├─ lobes[] array        ← Each lobe defines its own extraArgs
  ├─ startLobe()          ← Generic launcher, NO hardcoded config
  └─ startRuntime()       ← Starts Node.js web server

server/index.ts           ← Web interface + dual-lobe orchestration
src/loop/qwenLoop.ts      ← Model invocation abstraction
src/loop/modelBackend.ts  ← Backend for llama.cpp communication
```

## Configuration Flow

```typescript
// ✅ CORRECT: Per-lobe configuration
const lobes: LobeConfig[] = [
  {
    name: 'Qwen (language)',
    port: 1234,
    extraArgs: ['--n-gpu-layers', '35', '--ctx-size', '4096', ...]
  },
  {
    name: 'Phi (emotional)',
    port: 1235,
    extraArgs: ['--n-gpu-layers', '32', '--ctx-size', '2048', ...]
  }
];

// ❌ WRONG: Global configuration
function startLobe(config) {
  const args = [
    '-m', modelPath,
    '--port', config.port,
    '--n-gpu-layers', '35',  // ← DON'T DO THIS
    '--ctx-size', '4096'      // ← DON'T DO THIS
  ];
}
```

## Safety Guidelines

### Before Modifying Configuration:

1. Read [LLAMA_SERVER_CONFIG.md](LLAMA_SERVER_CONFIG.md) for specifications
2. Understand which lobe you're modifying
3. Check if the change applies to one or both lobes
4. If both lobes need the change, apply separately in their `extraArgs`
5. Never assume one configuration works for both

### Before Adding Features:

1. Determine which lobe(s) the feature affects
2. Language/conversation → Qwen
3. Emotional/felt-state → Phi
4. Both → Implement separately with appropriate settings

### Before Performance Tuning:

1. Profile each lobe independently
2. Different model sizes = different optimal settings
3. Check VRAM usage separately
4. Test GPU layer offloading per lobe

## Common Mistakes

### ❌ Mistake 1: Global GPU Settings
```typescript
// WRONG - applies same GPU config to both lobes
const args = [...baseArgs, '--n-gpu-layers', '35'];
```

**Why it fails:** Phi (2.7B) and Qwen (14B) have different VRAM needs.

### ❌ Mistake 2: Shared Context Size
```typescript
// WRONG - uses same context for both
const args = [...baseArgs, '--ctx-size', '4096'];
```

**Why it fails:** Phi does emotional processing (doesn't need 4096 context), wastes VRAM.

### ❌ Mistake 3: Assuming Symmetry
"If Qwen needs X, Phi needs X too."

**Why it fails:** They're different models with different purposes.

## Testing Requirements

When modifying configuration:

1. Test Qwen standalone on port 1234
2. Test Phi standalone on port 1235
3. Test both together
4. Verify GPU memory usage for each
5. Check generation speed for each

## References

- [LLAMA_SERVER_CONFIG.md](LLAMA_SERVER_CONFIG.md) - Full configuration specs
- [START_HERE.md](START_HERE.md) - Quick start guide
- [Tools/runRuntime.ts](Tools/runRuntime.ts) - Launch configuration
- [CODING_PROMPT.md](CODING_PROMPT.md) - Sacred design principles
