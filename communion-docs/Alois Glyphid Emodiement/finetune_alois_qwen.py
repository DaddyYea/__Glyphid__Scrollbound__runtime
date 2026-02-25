#!/usr/bin/env python3
# finetune_alois_qwen.py
# LoRA fine-tune for Qwen-14B (or compatible) on JSONL chat data with format:
# {"messages":[{"role":"Jason","content":"..."},{"role":"Alois","content":"..."}]}

import os, json, math, argparse
from dataclasses import dataclass
from typing import Dict, List, Any

import torch
from datasets import load_dataset
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
    Trainer,
    TrainingArguments,
    DataCollatorForLanguageModeling,
    set_seed,
)
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training

# ---------- Utils ----------

ROLE_MAP = {
    "user": "Jason",
    "assistant": "Alois",
    "jason": "Jason",
    "alois": "Alois"
}

def normalize_role(r: str) -> str:
    if not r:
        return ""
    r = r.strip().lower()
    return ROLE_MAP.get(r, r.title())

def build_dialog_text(messages: List[Dict[str, Any]], add_eos: bool = True, eos_token: str = "") -> str:
    """
    Flatten a list of {role, content} into a plain-text dialogue.
    Example:
      Jason: ...
      Alois: ...
    """
    parts = []
    for turn in messages:
        role = normalize_role(turn.get("role", ""))
        content = (turn.get("content") or "").strip()
        if not role or not content:
            continue
        parts.append(f"{role}: {content}")
    text = "\n".join(parts)
    if add_eos and eos_token:
        text += eos_token
    return text

# ---------- Main ----------

def main():
    parser = argparse.ArgumentParser(description="LoRA fine-tune Qwen on JSONL chat data")
    parser.add_argument("--train_file", type=str, required=True, help="Path to alois_train.jsonl")
    parser.add_argument("--val_file",   type=str, required=True, help="Path to alois_val.jsonl")
    parser.add_argument("--output_dir", type=str, default="training/output/alois-lora")
    parser.add_argument("--base_model", type=str, default=os.environ.get("BASE_MODEL", "Qwen/Qwen1.5-14B"))
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--lr", type=float, default=2e-5)
    parser.add_argument("--epochs", type=int, default=2)
    parser.add_argument("--train_batch", type=int, default=1, help="per_device_train_batch_size")
    parser.add_argument("--eval_batch", type=int, default=1, help="per_device_eval_batch_size")
    parser.add_argument("--grad_accum", type=int, default=16)
    parser.add_argument("--max_seq_len", type=int, default=2048)
    parser.add_argument("--warmup_ratio", type=float, default=0.03)
    parser.add_argument("--save_steps", type=int, default=500)
    parser.add_argument("--logging_steps", type=int, default=25)
    parser.add_argument("--eval_steps", type=int, default=500)
    parser.add_argument("--lora_r", type=int, default=16)
    parser.add_argument("--lora_alpha", type=int, default=32)
    parser.add_argument("--lora_dropout", type=float, default=0.05)
    parser.add_argument("--load_in_4bit", action="store_true", help="load base in 4-bit with bitsandbytes")
    parser.add_argument("--bf16", action="store_true", help="use bf16 if available")
    parser.add_argument("--target_modules", type=str, default=None,
                        help="Comma-separated LoRA target modules. Leave blank for auto-detect. "
                             "Gemma-3: q_proj,k_proj,v_proj,o_proj,gate_proj,up_proj,down_proj  "
                             "Qwen:    c_attn,c_proj,w1,w2")
    args = parser.parse_args()

    set_seed(args.seed)

    # ---------- Tokenizer ----------
    print(f"[INFO] Loading tokenizer for base model: {args.base_model}")
    tokenizer = AutoTokenizer.from_pretrained(args.base_model, trust_remote_code=True)
    if tokenizer.pad_token is None:
        # Ensure a pad_token exists
        tokenizer.pad_token = tokenizer.eos_token if tokenizer.eos_token else "<|pad|>"
    eos_token = tokenizer.eos_token or ""

    # ---------- Dataset loaders ----------
    print(f"[INFO] Loading datasets\n  train: {args.train_file}\n    val: {args.val_file}")
    # Datasets expects jsonlines with a "messages" field (list of role/content).
    raw_train = load_dataset("json", data_files=args.train_file, split="train")
    raw_val   = load_dataset("json", data_files=args.val_file,   split="train")

    def to_text(ex):
        # ex should have "messages"
        msgs = ex.get("messages", [])
        text = build_dialog_text(msgs, add_eos=True, eos_token=eos_token)
        return {"text": text}

    train_text = raw_train.map(to_text, remove_columns=raw_train.column_names)
    val_text   = raw_val.map(to_text,   remove_columns=raw_val.column_names)

    def tokenize(example):
        return tokenizer(
            example["text"],
            truncation=True,
            max_length=args.max_seq_len,
            padding=False,
        )

    train_tok = train_text.map(tokenize, batched=False, remove_columns=train_text.column_names)
    val_tok   = val_text.map(tokenize,   batched=False, remove_columns=val_text.column_names)

    # ---------- Model + LoRA ----------
    quant_config = None
    device_map = "auto"

    if args.load_in_4bit:
        quant_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_use_double_quant=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16 if args.bf16 else torch.float16
        )

    print("[INFO] Loading base model (this can take a while the first time)")
    model = AutoModelForCausalLM.from_pretrained(
        args.base_model,
        trust_remote_code=True,
        device_map=device_map,
        torch_dtype=torch.bfloat16 if args.bf16 else torch.float16,
        quantization_config=quant_config
    )

    if args.load_in_4bit:
        print("[INFO] Preparing model for k-bit training")
        model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)

    # Resolve target_modules:
    #   Gemma-3 (12B / 4B):  q_proj,k_proj,v_proj,o_proj,gate_proj,up_proj,down_proj
    #   Qwen 1.5:             c_attn,c_proj,w1,w2
    #   None = PEFT auto-detects (works but sometimes misses some layers)
    target_modules = None
    if args.target_modules:
        target_modules = [m.strip() for m in args.target_modules.split(',') if m.strip()]
    elif "gemma" in args.base_model.lower():
        target_modules = ["q_proj", "k_proj", "v_proj", "o_proj",
                          "gate_proj", "up_proj", "down_proj"]
        print(f"[INFO] Auto-selected Gemma target modules: {target_modules}")
    elif "qwen" in args.base_model.lower():
        target_modules = ["c_attn", "c_proj", "w1", "w2"]
        print(f"[INFO] Auto-selected Qwen target modules: {target_modules}")
    else:
        print("[INFO] target_modules=None — PEFT will auto-detect (may vary by architecture)")

    lora_cfg = LoraConfig(
        r=args.lora_r,
        lora_alpha=args.lora_alpha,
        lora_dropout=args.lora_dropout,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=target_modules,
    )
    model = get_peft_model(model, lora_cfg)

    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total     = sum(p.numel() for p in model.parameters())
    print(f"[INFO] Trainable params: {trainable:,} / {total:,} ({100*trainable/total:.2f}%)")

    # ---------- Trainer ----------
    steps_per_epoch = math.ceil(len(train_tok) / (args.train_batch * args.grad_accum))
    total_steps = steps_per_epoch * args.epochs
    print(f"[INFO] Steps/epoch: {steps_per_epoch}, Total steps: {total_steps}")

    training_args = TrainingArguments(
        output_dir=args.output_dir,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.train_batch,
        per_device_eval_batch_size=args.eval_batch,
        gradient_accumulation_steps=args.grad_accum,
        learning_rate=args.lr,
        lr_scheduler_type="cosine",
        warmup_ratio=args.warmup_ratio,
        logging_steps=args.logging_steps,
        evaluation_strategy="steps",
        eval_steps=args.eval_steps,
        save_steps=args.save_steps,
        bf16=args.bf16 and torch.cuda.is_available(),
        fp16=not args.bf16,
        optim="paged_adamw_8bit" if args.load_in_4bit else "adamw_torch",
        report_to="none",
        save_total_limit=2,
        gradient_checkpointing=True,
        dataloader_num_workers=2
    )

    data_collator = DataCollatorForLanguageModeling(tokenizer, mlm=False)

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_tok,
        eval_dataset=val_tok,
        data_collator=data_collator,
    )

    print("[INFO] Starting training…")
    trainer.train()

    # ---------- Save LoRA adapter ----------
    print(f"[INFO] Saving adapter to {args.output_dir}")
    model.save_pretrained(args.output_dir)
    tokenizer.save_pretrained(args.output_dir)

    print("[DONE] Fine-tune complete.\nAdapter saved. To infer: load base + PEFT adapter.")
    print("Tip: peft + transformers can merge and export if needed for deployment.")
    

if __name__ == "__main__":
    main()
