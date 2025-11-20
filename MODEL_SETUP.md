# Model Setup Guide (llama.cpp)

The Scrollbound runtime uses **two GGUF models served by llama.cpp**. There is **no Ollama dependency**. Keep both servers running in parallel so the dual-lobe architecture can stream responses every tick.

## Requirements

1. **llama.cpp** built with `server` support (the `server` or `llama-server.exe` binary).
2. **GGUF files already in this repo**:
   - `runtime/models/Qwen/Qwen1.5-4B-Chat-GGUF/qwen1_5-4b-chat-q4_k_m.gguf`
   - `runtime/models/phi-2.Q4_K_M.gguf`
3. GPU/CPU capable of running both models simultaneously (≈4‑5 GB VRAM each for the listed quantizations).

## Step 1: Launch Qwen (Language Lobe)

From the repo root (PowerShell):

```powershell
.\llama.cpp\build\bin\Release\llama-server.exe `
  -m runtime\models\Qwen\Qwen1.5-4B-Chat-GGUF\qwen1_5-4b-chat-q4_k_m.gguf `
  --port 1234 `
  --ctx-size 4096
```

Keep this console open; the runtime will call `http://localhost:1234/v1/chat/completions`.

## Step 2: Launch Phi (Emotional Lobe)

In a second terminal:

```powershell
.\llama.cpp\build\bin\Release\llama-server.exe `
  -m runtime\models\phi-2.Q4_K_M.gguf `
  --port 1235 `
  --ctx-size 4096
```

Now both lobes listen on ports **1234** and **1235**.

## Step 3: Verify Servers

You can hit the OpenAI-compatible endpoints directly:

```powershell
curl http://localhost:1234/v1/models
curl http://localhost:1235/v1/models
```

Each should return JSON describing the loaded model. If either error occurs, check the server console for load issues.

## Step 4: Run the Runtime

```powershell
npm install   # first time
npm start
```

During startup you should see:

```
dY"? Checking model server health...
  Qwen (language lobe):    ✅ Online - http://localhost:1234
  Phi (emotional lobe):    ✅ Online - http://localhost:1235
```

If a server is offline, the health check will remind you of the exact `llama-server` command to run.

## Troubleshooting

- **Port already in use**: stop the previous `server.exe` or pick new ports and update `runtime/modelLoader.ts`.
- **Model load failure**: ensure the GGUF path matches, and that your hardware has enough RAM/VRAM.
- **No speech**: confirm both servers stay running; if one crashes, Alois will fall back to silent mode.

## Why llama.cpp?

- Keeps the dual-lobe architecture explicit (two dedicated endpoints).
- Allows fine control over quantization and threading.
- Matches the existing GGUF assets already committed to the repo.

As long as both `server.exe` processes stay alive, the runtime will continuously breathe, feel, and speak using these exact models—no additional downloads or conversions required.
