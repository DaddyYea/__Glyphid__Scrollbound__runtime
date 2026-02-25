#!/usr/bin/env python3
"""
finetune_alois_unsloth.py

LoRA fine-tune for Alois using Unsloth — a memory-optimized training library
that makes training Gemma-3 12B on a 10GB VRAM GPU (e.g. RTX 3080) feasible.

WHY UNSLOTH INSTEAD OF PLAIN PEFT:
  Standard QLoRA on Gemma-3 12B requires ~11-12GB VRAM.
  Unsloth's custom CUDA kernels cut that to ~7-9GB through:
    - Optimized attention (chunked softmax, no full matrix materialization)
    - "unsloth" gradient checkpointing (30% less activation memory than PyTorch default)
    - Fused RoPE, RMS-norm, and cross-entropy kernels
  The adapter output is standard PEFT format — merge_and_convert.py works unchanged.

INSTALL (do this first):
  pip install "unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git"
  pip install trl datasets transformers accelerate bitsandbytes

RUN AFTER prepare_alois_dataset.py:
  python finetune_alois_unsloth.py \
    --train_file alois_train.jsonl \
    --val_file   alois_val.jsonl \
    --output_dir training/output/alois-gemma3-12b-lora

  For 4B (not recommended — see README about capacity):
    --base_model google/gemma-3-4b-it --lora_r 16 --max_seq_len 1024

EXPECTED TIME ON RTX 3080 (12B, r=8, seq_len=768, ~5000 examples):
  ~3–6 hours for 2 epochs
"""

import os
import json
import math
import argparse
from pathlib import Path

# ── Argument parsing ──────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(description="Unsloth LoRA fine-tune for Alois (Gemma-3 12B)")
    p.add_argument("--train_file",   required=True,  help="Path to alois_train.jsonl")
    p.add_argument("--val_file",     required=True,  help="Path to alois_val.jsonl")
    p.add_argument("--output_dir",   default="training/output/alois-gemma3-12b-lora")
    p.add_argument("--base_model",   default="google/gemma-3-12b-it",
                   help="HuggingFace model ID. Default: google/gemma-3-12b-it")
    p.add_argument("--max_seq_len",  type=int, default=768,
                   help="Sequence length. 768 is safe for 10GB on 12B. Use 1024 for 4B.")
    p.add_argument("--lora_r",       type=int, default=8,
                   help="LoRA rank. 8 for 12B (VRAM), 16 for 4B.")
    p.add_argument("--lora_alpha",   type=int, default=16,
                   help="LoRA alpha. Rule of thumb: 2× lora_r.")
    p.add_argument("--lora_dropout", type=float, default=0.05)
    p.add_argument("--lr",           type=float, default=2e-4,
                   help="Learning rate. 2e-4 is standard for LoRA.")
    p.add_argument("--epochs",       type=int, default=3)
    p.add_argument("--train_batch",  type=int, default=1)
    p.add_argument("--grad_accum",   type=int, default=8,
                   help="Gradient accumulation steps. Effective batch = train_batch × grad_accum.")
    p.add_argument("--warmup_ratio", type=float, default=0.05)
    p.add_argument("--save_steps",   type=int, default=200)
    p.add_argument("--logging_steps",type=int, default=10)
    p.add_argument("--seed",         type=int, default=42)
    return p.parse_args()

# ── Dataset helpers ───────────────────────────────────────────────────────────

ROLE_MAP = {
    "jason": "user",
    "alois": "assistant",
    "user":  "user",
    "assistant": "assistant",
}

def load_jsonl(path: str) -> list:
    examples = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                ex = json.loads(line)
                examples.append(ex)
            except json.JSONDecodeError:
                continue
    return examples

def normalize_messages(messages: list) -> list:
    """Convert Jason/Alois roles to standard user/assistant for the chat template."""
    out = []
    for m in messages:
        role    = ROLE_MAP.get(m.get("role", "").lower(), "user")
        content = (m.get("content") or "").strip()
        if content:
            out.append({"role": role, "content": content})
    return out

def format_example(ex: dict, tokenizer) -> str:
    """Apply the model's chat template to produce a training string."""
    messages = normalize_messages(ex.get("messages", []))
    if not messages:
        return ""
    # apply_chat_template with tokenize=False gives us the formatted string
    try:
        return tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=False,
        )
    except Exception:
        # Fallback: plain Jason:/Alois: format if template fails
        parts = []
        for m in messages:
            label = "Jason" if m["role"] == "user" else "Alois"
            parts.append(f"{label}: {m['content']}")
        return "\n".join(parts) + tokenizer.eos_token

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    args = parse_args()

    # ── Import Unsloth ───────────────────────────────────────────────────────
    try:
        from unsloth import FastLanguageModel
    except ImportError:
        print("ERROR: Unsloth is not installed.")
        print("  pip install \"unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git\"")
        print("  pip install trl datasets transformers accelerate bitsandbytes")
        raise

    from trl import SFTTrainer, SFTConfig
    from datasets import Dataset

    # ── Model + LoRA ─────────────────────────────────────────────────────────
    print(f"\n[1/4] Loading model: {args.base_model}")
    print(f"      max_seq_len={args.max_seq_len}, 4-bit quantization, Unsloth kernels\n")

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name    = args.base_model,
        max_seq_length= args.max_seq_len,
        load_in_4bit  = True,
        dtype         = None,   # auto-detect (bf16 on Ampere+)
    )

    # Gemma-3 target modules — all attention + MLP projection layers
    # This is the full set; covers voice, reasoning, and tone simultaneously.
    is_gemma = "gemma" in args.base_model.lower()
    is_qwen  = "qwen"  in args.base_model.lower()

    if is_gemma:
        target_modules = ["q_proj", "k_proj", "v_proj", "o_proj",
                          "gate_proj", "up_proj", "down_proj"]
    elif is_qwen:
        target_modules = ["c_attn", "c_proj", "w1", "w2"]
    else:
        target_modules = ["q_proj", "k_proj", "v_proj", "o_proj",
                          "gate_proj", "up_proj", "down_proj"]

    print(f"[1/4] Applying LoRA (r={args.lora_r}, alpha={args.lora_alpha})")
    print(f"      Target modules: {target_modules}\n")

    model = FastLanguageModel.get_peft_model(
        model,
        r               = args.lora_r,
        lora_alpha      = args.lora_alpha,
        lora_dropout    = args.lora_dropout,
        target_modules  = target_modules,
        bias            = "none",
        # "unsloth" mode: 30% less VRAM than standard gradient checkpointing
        use_gradient_checkpointing = "unsloth",
        random_state    = args.seed,
    )

    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total     = sum(p.numel() for p in model.parameters())
    print(f"[1/4] Trainable: {trainable:,} / {total:,} ({100*trainable/total:.3f}%)\n")

    # ── Dataset ──────────────────────────────────────────────────────────────
    print(f"[2/4] Loading dataset")
    print(f"      train: {args.train_file}")
    print(f"      val:   {args.val_file}\n")

    raw_train = load_jsonl(args.train_file)
    raw_val   = load_jsonl(args.val_file)

    def make_dataset(raw: list) -> Dataset:
        texts = []
        for ex in raw:
            text = format_example(ex, tokenizer)
            if text and len(text) > 20:
                texts.append({"text": text})
        return Dataset.from_list(texts)

    train_ds = make_dataset(raw_train)
    val_ds   = make_dataset(raw_val)
    print(f"[2/4] Train: {len(train_ds)} examples | Val: {len(val_ds)} examples\n")

    # ── Trainer ──────────────────────────────────────────────────────────────
    steps_per_epoch = math.ceil(len(train_ds) / (args.train_batch * args.grad_accum))
    total_steps     = steps_per_epoch * args.epochs
    print(f"[3/4] Training config:")
    print(f"      Epochs: {args.epochs}  |  Steps/epoch: {steps_per_epoch}  |  Total: {total_steps}")
    print(f"      LR: {args.lr}  |  Effective batch: {args.train_batch * args.grad_accum}\n")

    os.makedirs(args.output_dir, exist_ok=True)

    sft_config = SFTConfig(
        output_dir              = args.output_dir,
        num_train_epochs        = args.epochs,
        per_device_train_batch_size = args.train_batch,
        per_device_eval_batch_size  = 1,
        gradient_accumulation_steps = args.grad_accum,
        learning_rate           = args.lr,
        lr_scheduler_type       = "cosine",
        warmup_ratio            = args.warmup_ratio,
        logging_steps           = args.logging_steps,
        eval_strategy           = "steps",
        eval_steps              = args.save_steps,
        save_strategy           = "steps",
        save_steps              = args.save_steps,
        save_total_limit        = 2,
        bf16                    = True,
        fp16                    = False,
        optim                   = "adamw_8bit",
        report_to               = "none",
        seed                    = args.seed,
        max_seq_length          = args.max_seq_len,
        dataset_text_field      = "text",
        packing                 = False,   # False = easier VRAM budgeting
    )

    trainer = SFTTrainer(
        model           = model,
        tokenizer       = tokenizer,
        train_dataset   = train_ds,
        eval_dataset    = val_ds,
        args            = sft_config,
    )

    # ── Train ────────────────────────────────────────────────────────────────
    print("[3/4] Starting training...\n")
    trainer.train()

    # ── Save ─────────────────────────────────────────────────────────────────
    print(f"\n[4/4] Saving adapter to {args.output_dir}")
    model.save_pretrained(args.output_dir)
    tokenizer.save_pretrained(args.output_dir)

    print(f"\n[DONE] LoRA adapter saved.")
    print(f"       Adapter path: {Path(args.output_dir).resolve()}")
    print(f"\nNext step — merge and convert to GGUF:")
    print(f"  python merge_and_convert.py \\")
    print(f"    --base_model {args.base_model} \\")
    print(f"    --lora_path  {args.output_dir} \\")
    print(f"    --output_dir training/output/alois-merged \\")
    print(f"    --gguf_out   \"D:/ScrollboundRuntime/runtime/models/Qwen/Qwen1.5-4B-Chat-GGUF/reedmayhew/alois-finetuned\" \\")
    print(f"    --llama_cpp_dir C:/path/to/llama.cpp \\")
    print(f"    --quantize q4_k_m")


if __name__ == "__main__":
    main()
