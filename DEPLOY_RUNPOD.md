# RunPod Serverless Deploy

## What this does

Builds a Docker container that runs the Communion server (`communion/server.ts`) on port 3000. The server hosts the dashboard, SSE event stream, and all agent API endpoints.

## Entrypoint

```
node --max-old-space-size=4096 --require tsx/cjs communion/server.ts
```

This starts the HTTP server with the TypeScript runtime loader. The `tsx/cjs` require hook lets Node run `.ts` files with ESM import syntax directly.

## Volume Mount (required)

The container expects a volume mounted at `/app/data` containing at minimum:

```
data/communion/dynamic-agents.json
```

This file configures which AI agent to use. Without it, the server will exit with:
```
No agents configured. Either create communion.config.json or set API key env vars.
```

A template is provided at `dynamic-agents.template.json` in the repo root. Copy it, fill in your API key, and place it in your mounted volume as `communion/dynamic-agents.json`.

### What goes in the volume

```
/app/data/
  communion/
    dynamic-agents.json    ← required (agent config + API key)
    brain-tissue.json      ← optional (Alois brain state, created automatically)
    presets.json            ← optional (audio presets, created automatically)
    golden/                ← optional (golden set data, created automatically)
```

### Template setup

```bash
# Copy template and edit with your API key
cp dynamic-agents.template.json /your/volume/path/communion/dynamic-agents.json
# Edit the file: replace YOUR_API_KEY_HERE with your DeepSeek API key
```

## Environment Variables

Set these in RunPod's template environment variables:

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | No | `3000` | Server port |
| `HUMAN_NAME` | No | `Jason` | Display name for human participant |
| `TICK_INTERVAL_MS` | No | `15000` | Agent tick interval in ms |
| `DATA_DIR` | No | `data/communion` | State directory (inside the volume mount) |

## RunPod Setup Steps

1. Create a RunPod Network Volume
2. Populate it with `communion/dynamic-agents.json` (from template)
3. Go to RunPod Serverless → New Endpoint
4. Choose "GitHub Repo" → point to this repo and branch
5. Attach the Network Volume at `/app/data`
6. Set environment variables if needed
7. Expose port 3000
8. Deploy

## Local Docker Test

```bash
# Build
docker build -t scrollbound .

# Run with local data directory mounted
docker run -p 3000:3000 -v ./data:/app/data scrollbound
```

## Important Notes

- **No GPU required** for remote API agents (DeepSeek, OpenAI-compatible). GPU only needed for local GGUF models.
- **Local models** (llama.cpp, GGUF files) are excluded from the Docker image. Use remote API agents only.
- **Whisper STT** (speech-to-text) requires a microphone and Python — not available in serverless containers.
- **TTS** (Edge TTS) works in the container — it uses HTTP, not local audio.
- **Heap size** is set to 4GB (`--max-old-space-size=4096`). Adjust the CMD in the Dockerfile if your RunPod plan has more RAM.
- **Brain tissue** and all state persist only if the volume is mounted. Without a volume, state is lost on container restart.
