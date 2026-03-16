#!/usr/bin/env bash
# Starts a small vLLM embedding server on port 8001.
# Model: BAAI/bge-small-en-v1.5 (~134MB, fast, CUDA)
# Required by the Alois brain for feedMessage + inner voice embedding.

MODEL="BAAI/bge-small-en-v1.5"
PORT=8002

echo "==> Starting embedding server: $MODEL on port $PORT"

python3 -m vllm.entrypoints.openai.api_server \
  --model "$MODEL" \
  --runner pooling \
  --convert embed \
  --port $PORT \
  --dtype float16 \
  --max-model-len 512 \
  --gpu-memory-utilization 0.04 \
  --enforce-eager
