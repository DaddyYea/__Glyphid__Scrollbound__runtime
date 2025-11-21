# Llama.cpp Server Configuration

## Dual-Lobe Architecture

This runtime uses TWO separate llama-server instances:
- **Qwen (language lobe)** - Port 1234 - 14B parameter model
- **Phi (emotional lobe)** - Port 1235 - 2.7B parameter model

**CRITICAL: Each lobe has different GPU and performance requirements.**

## Configuration Method

**DO NOT modify the base args in `startLobe()` function.**

Each lobe's specific configuration is defined in its `extraArgs` array in the `lobes` constant.

## Qwen (Language Lobe) Specification

```bash
./server \
  -m models/qwen/qwen1_5-14b-chat-q4_k_m.gguf \
  --port 1234 \
  --n-gpu-layers 35 \
  --ctx-size 4096 \
  --threads 10 \
  --batch-size 64 \
  --mlock
```

**Why these settings:**
- `--n-gpu-layers 35`: 14B model needs more GPU layers offloaded
- `--ctx-size 4096`: Larger context for conversational coherence
- `--threads 10`: Balanced CPU threading
- `--batch-size 64`: Efficient batch processing
- `--mlock`: Prevents memory swapping

## Phi (Emotional Lobe) Specification

```bash
./server \
  -m models/phi2/phi-2.Q4_K_M.gguf \
  --port 1235 \
  --n-gpu-layers 32 \
  --ctx-size 2048 \
  --threads 10 \
  --batch-size 64 \
  --mlock
```

**Why these settings:**
- `--n-gpu-layers 32`: Smaller model, fewer layers (safe for 6-8GB VRAM)
- `--ctx-size 2048`: Smaller context for emotional processing (not conversational)
- `--threads 10`: Matched to Qwen for consistency
- `--batch-size 64`: Same batch size
- `--mlock`: Prevents memory swapping

## Low VRAM Fallback

If you have limited VRAM (< 8GB):
- Qwen: `--n-gpu-layers 20`
- Phi: `--n-gpu-layers 16`

## Code Location

Configuration is in `Tools/runRuntime.ts`:

```typescript
const lobes: LobeConfig[] = [
  {
    name: 'Qwen (language)',
    modelRelativePath: ['runtime', 'models', 'Qwen', 'qwen1_5-14b-chat-q4_k_m.gguf'],
    port: 1234,
    extraArgs: [
      '--n-gpu-layers', '35',
      '--ctx-size', '4096',
      '--threads', '10',
      '--batch-size', '64',
      '--mlock'
    ]
  },
  {
    name: 'Phi (emotional)',
    modelRelativePath: ['runtime', 'models', 'phi-2.Q4_K_M.gguf'],
    port: 1235,
    extraArgs: [
      '--n-gpu-layers', '32',
      '--ctx-size', '2048',
      '--threads', '10',
      '--batch-size', '64',
      '--mlock'
    ]
  }
];
```

## WARNING

**Never apply global settings to both lobes.** They are different model sizes with different requirements. Always use the `extraArgs` field for lobe-specific configuration.
