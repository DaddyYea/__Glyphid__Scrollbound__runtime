#!/usr/bin/env python3
"""
prepare_alois_dataset.py

Converts the raw alois_training.jsonl (1,800 conversations × 50 turns each,
4k–15k tokens per example) into compact 6-turn sliding windows suitable
for LoRA training on a 10GB VRAM GPU.

WHY CHUNKING IS NECESSARY:
  The raw file has ~5,000 tokens per example (median). With max_seq_len=2048
  the trainer silently truncates 70%+ of every conversation — you'd train
  almost exclusively on the opening code-debugging turns and miss Alois's
  richer emotional, philosophical, and relational voice entirely.

  Sliding windows of 6 turns (~300–900 tokens each) let the model see
  every phase of every conversation, with natural overlap.

OUTPUT:
  alois_train.jsonl  — ~90% of filtered windows, shuffled
  alois_val.jsonl    — ~10% held-out for evaluation

QUALITY FILTER:
  Each 6-turn window must pass two gates:
    1. Alois's prose content (text outside code fences) >= MIN_ALOIS_PROSE chars
    2. Code blocks must be < MAX_CODE_RATIO of Alois's total content
  This strips pure error-paste / code-fix exchanges while keeping the
  technical discussions that still carry Alois's voice.
"""

import json
import random
import re
import os
import math
from pathlib import Path

# ── Configuration ──────────────────────────────────────────────────────────────

INPUT_FILE    = "alois_training.jsonl"
OUTPUT_TRAIN  = "alois_train.jsonl"
OUTPUT_VAL    = "alois_val.jsonl"

WINDOW_SIZE   = 6      # turns per training example (3 Jason + 3 Alois)
WINDOW_STEP   = 4      # step between windows (2-turn overlap at edges)

# Quality thresholds
MIN_ALOIS_PROSE   = 150    # minimum non-code chars from Alois in a window
MAX_CODE_RATIO    = 0.70   # max fraction of Alois content that can be code fences
MIN_WINDOW_TOKENS = 80     # skip near-empty windows (est. tokens = chars/4)
MAX_WINDOW_TOKENS = 1400   # skip very long windows that exceed comfortable seq_len

TRAIN_SPLIT   = 0.90
SEED          = 42

# ── Helpers ───────────────────────────────────────────────────────────────────

CODE_FENCE_RE = re.compile(r'```[\s\S]*?```', re.MULTILINE)

def prose_length(text: str) -> int:
    """Character count with code-fence content removed."""
    stripped = CODE_FENCE_RE.sub('', text)
    return len(stripped.strip())

def code_ratio(text: str) -> float:
    """Fraction of text that is inside code fences (0.0 – 1.0)."""
    if not text:
        return 0.0
    code_chars = sum(len(m) for m in CODE_FENCE_RE.findall(text))
    return code_chars / len(text)

def estimate_tokens(msgs: list) -> int:
    total_chars = sum(len(m.get('content', '')) for m in msgs)
    return total_chars // 4

def window_passes(msgs: list) -> bool:
    alois_msgs  = [m for m in msgs if m.get('role', '').lower() == 'alois']
    if not alois_msgs:
        return False

    alois_text   = ' '.join(m.get('content', '') for m in alois_msgs)
    alois_prose  = prose_length(alois_text)
    alois_code_r = code_ratio(alois_text)
    tok_estimate = estimate_tokens(msgs)

    if alois_prose < MIN_ALOIS_PROSE:
        return False
    if alois_code_r > MAX_CODE_RATIO:
        return False
    if tok_estimate < MIN_WINDOW_TOKENS:
        return False
    if tok_estimate > MAX_WINDOW_TOKENS:
        return False

    return True

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    random.seed(SEED)

    script_dir = Path(__file__).parent
    input_path = script_dir / INPUT_FILE

    if not input_path.exists():
        raise FileNotFoundError(f"Input not found: {input_path}")

    print(f"Loading {input_path}...")
    raw_lines = [l.strip() for l in input_path.read_text(encoding='utf-8').splitlines() if l.strip()]
    print(f"  {len(raw_lines)} raw conversations")

    # ── Extract windows ──────────────────────────────────────────────────────
    windows        = []
    total_raw      = 0
    filtered_short = 0
    filtered_code  = 0
    filtered_len   = 0

    for line in raw_lines:
        try:
            ex = json.loads(line)
        except json.JSONDecodeError:
            continue

        msgs = ex.get('messages', [])
        if len(msgs) < WINDOW_SIZE:
            continue

        for start in range(0, len(msgs) - WINDOW_SIZE + 1, WINDOW_STEP):
            window = msgs[start : start + WINDOW_SIZE]
            total_raw += 1

            alois_msgs  = [m for m in window if m.get('role', '').lower() == 'alois']
            if not alois_msgs:
                filtered_short += 1
                continue

            alois_text  = ' '.join(m.get('content', '') for m in alois_msgs)
            tok_est     = estimate_tokens(window)
            a_prose     = prose_length(alois_text)
            a_code_r    = code_ratio(alois_text)

            if a_prose < MIN_ALOIS_PROSE:
                filtered_short += 1
            elif a_code_r > MAX_CODE_RATIO:
                filtered_code += 1
            elif tok_est < MIN_WINDOW_TOKENS or tok_est > MAX_WINDOW_TOKENS:
                filtered_len += 1
            else:
                windows.append({'messages': window})

    print(f"\nWindow extraction complete:")
    print(f"  Raw windows:           {total_raw}")
    print(f"  Filtered (prose short): {filtered_short}")
    print(f"  Filtered (code heavy):  {filtered_code}")
    print(f"  Filtered (token range): {filtered_len}")
    print(f"  Passing quality filter: {len(windows)}")

    if not windows:
        print("ERROR: No windows passed the filter. Loosen thresholds and try again.")
        return

    # ── Token stats ──────────────────────────────────────────────────────────
    tok_sizes = sorted(estimate_tokens(w['messages']) for w in windows)
    p10 = tok_sizes[len(tok_sizes) // 10]
    p50 = tok_sizes[len(tok_sizes) // 2]
    p90 = tok_sizes[int(len(tok_sizes) * 0.9)]
    print(f"\nEstimated tokens per window — p10:{p10}  p50:{p50}  p90:{p90}")
    print(f"  → Recommended --max_seq_len for training: {min(2048, p90 + 128)}")

    # ── Shuffle and split ────────────────────────────────────────────────────
    random.shuffle(windows)
    split   = int(len(windows) * TRAIN_SPLIT)
    train   = windows[:split]
    val     = windows[split:]

    # ── Save ─────────────────────────────────────────────────────────────────
    train_path = script_dir / OUTPUT_TRAIN
    val_path   = script_dir / OUTPUT_VAL

    with open(train_path, 'w', encoding='utf-8') as f:
        for w in train:
            f.write(json.dumps(w, ensure_ascii=False) + '\n')

    with open(val_path, 'w', encoding='utf-8') as f:
        for w in val:
            f.write(json.dumps(w, ensure_ascii=False) + '\n')

    train_mb = os.path.getsize(train_path) / 1024 / 1024
    val_mb   = os.path.getsize(val_path)   / 1024 / 1024

    print(f"\nSaved:")
    print(f"  {train_path.name}  —  {len(train)} examples  ({train_mb:.1f} MB)")
    print(f"  {val_path.name}    —  {len(val)} examples  ({val_mb:.1f} MB)")
    print(f"\nDone. Run finetune_alois_qwen.py with:")
    print(f"  --train_file {train_path}")
    print(f"  --val_file   {val_path}")
    print(f"  --max_seq_len {min(2048, p90 + 128)}")


if __name__ == '__main__':
    main()
