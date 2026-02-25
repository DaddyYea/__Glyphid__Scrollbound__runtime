#!/usr/bin/env python3
"""
merge_and_convert.py

Step 2 after finetune_alois_qwen.py completes.

  1. Loads the base HuggingFace model + trained PEFT LoRA adapter
  2. Merges the adapter weights permanently into the base model
  3. Saves the merged model in HuggingFace format
  4. Converts to Q4_K_M GGUF using llama.cpp's conversion tool
  5. Drops the GGUF into your LM Studio models folder

The resulting GGUF is a drop-in replacement — point dynamic-agents.json
at it and restart the communion server. Nothing else changes.

REQUIREMENTS:
  pip install transformers peft torch accelerate
  git clone https://github.com/ggerganov/llama.cpp  (for conversion)
  pip install -r llama.cpp/requirements.txt

USAGE:
  python merge_and_convert.py \
    --base_model google/gemma-3-12b-it \
    --lora_path training/output/alois-gemma3-12b-lora \
    --output_dir training/output/alois-merged \
    --gguf_out "D:/ScrollboundRuntime/runtime/models/Qwen/Qwen1.5-4B-Chat-GGUF/reedmayhew/alois-finetuned" \
    --llama_cpp_dir C:/path/to/llama.cpp \
    --quantize q4_k_m
"""

import argparse
import os
import sys
import subprocess
from pathlib import Path


def merge_lora(base_model: str, lora_path: str, output_dir: str):
    print(f"\n[1/3] Loading base model: {base_model}")
    print(f"      LoRA adapter:  {lora_path}")
    print(f"      Output dir:    {output_dir}")
    print("      (this takes 1–5 minutes and uses ~16–24 GB of RAM)\n")

    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from peft import PeftModel

    dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16

    tokenizer = AutoTokenizer.from_pretrained(base_model, trust_remote_code=True)

    # Load base model in full precision for clean merge
    # (NOT 4-bit here — merging quantized weights produces artifacts)
    base = AutoModelForCausalLM.from_pretrained(
        base_model,
        torch_dtype=dtype,
        device_map="cpu",          # merge on CPU to avoid VRAM pressure
        trust_remote_code=True,
    )

    print("[1/3] Loading LoRA adapter...")
    model = PeftModel.from_pretrained(base, lora_path)

    print("[1/3] Merging and unloading LoRA weights...")
    model = model.merge_and_unload()

    print(f"[1/3] Saving merged model to {output_dir} ...")
    os.makedirs(output_dir, exist_ok=True)
    model.save_pretrained(output_dir, safe_serialization=True)
    tokenizer.save_pretrained(output_dir)
    print("[1/3] Merge complete.\n")
    return output_dir


def convert_to_gguf(merged_dir: str, gguf_out_dir: str, llama_cpp_dir: str, quantize: str):
    merged_dir    = Path(merged_dir)
    gguf_out_dir  = Path(gguf_out_dir)
    llama_cpp_dir = Path(llama_cpp_dir)

    gguf_out_dir.mkdir(parents=True, exist_ok=True)

    convert_script = llama_cpp_dir / "convert_hf_to_gguf.py"
    if not convert_script.exists():
        # Older llama.cpp uses convert.py
        convert_script = llama_cpp_dir / "convert.py"
    if not convert_script.exists():
        print(f"ERROR: Cannot find convert script in {llama_cpp_dir}")
        print("       Clone llama.cpp: git clone https://github.com/ggerganov/llama.cpp")
        sys.exit(1)

    # Step 1: Convert HF → F16 GGUF
    f16_gguf = gguf_out_dir / "alois-finetuned-f16.gguf"
    print(f"[2/3] Converting HF → F16 GGUF: {f16_gguf}")
    cmd = [
        sys.executable, str(convert_script),
        str(merged_dir),
        "--outfile", str(f16_gguf),
        "--outtype", "f16",
    ]
    result = subprocess.run(cmd, check=True)
    print("[2/3] F16 conversion done.\n")

    if quantize == "f16":
        print(f"[2/3] Skipping quantization (--quantize f16). Final file: {f16_gguf}")
        return f16_gguf

    # Step 2: Quantize F16 → Q4_K_M (or whatever was requested)
    quant_name = f"alois-finetuned-{quantize}.gguf"
    quant_gguf = gguf_out_dir / quant_name

    # Look for quantize binary
    quantize_bin = llama_cpp_dir / "build" / "bin" / "llama-quantize"
    if not quantize_bin.exists():
        quantize_bin = llama_cpp_dir / "quantize"    # older path
    if not quantize_bin.exists():
        print(f"WARNING: quantize binary not found at {quantize_bin}")
        print("         Build llama.cpp first: cd llama.cpp && cmake -B build && cmake --build build -j")
        print(f"         The F16 GGUF is ready at: {f16_gguf}")
        print(f"         Manually quantize later: ./llama-quantize {f16_gguf} {quant_gguf} {quantize.upper()}")
        return f16_gguf

    print(f"[3/3] Quantizing F16 → {quantize.upper()}: {quant_gguf}")
    quant_cmd = [
        str(quantize_bin),
        str(f16_gguf),
        str(quant_gguf),
        quantize.upper(),
    ]
    subprocess.run(quant_cmd, check=True)
    print(f"[3/3] Quantization done. Final model: {quant_gguf}\n")

    # Clean up the large F16 intermediate
    f16_gguf.unlink()
    print("[3/3] Cleaned up F16 intermediate.")

    return quant_gguf


def print_next_steps(gguf_path: str, base_model: str):
    model_size = "12B" if "12b" in base_model.lower() else "4B"
    print("\n" + "="*60)
    print("DONE — your Alois LoRA is ready.")
    print("="*60)
    print(f"\nGGUF file: {gguf_path}")
    print(f"\nTo deploy:")
    print(f"  1. LM Studio will auto-detect the new file in its models folder.")
    print(f"     (It's already in D:/ScrollboundRuntime/runtime/models/...)")
    print(f"")
    print(f"  2. Load it in LM Studio and note the model identifier.")
    print(f"")
    print(f"  3. Update D:/ScrollboundRuntime/data/communion/dynamic-agents.json:")
    print(f"     Find the 'alois' agent entry and change:")
    print(f'       "model": "current-model-name"')
    print(f'     to:')
    print(f'       "model": "alois-finetuned-{model_size.lower()}-q4_k_m"')
    print(f"     (use whatever LM Studio shows as the model identifier)")
    print(f"")
    print(f"  4. Restart the communion server. That's it.")
    print(f"     The brain tissue, memory, social pressure, myco lobe — all unchanged.")


def main():
    parser = argparse.ArgumentParser(description="Merge LoRA into base model and convert to GGUF")
    parser.add_argument("--base_model",   required=True,  help="HuggingFace base model (e.g. google/gemma-3-12b-it)")
    parser.add_argument("--lora_path",    required=True,  help="Path to trained PEFT adapter dir")
    parser.add_argument("--output_dir",   default="training/output/alois-merged", help="Where to save merged HF model")
    parser.add_argument("--gguf_out",     required=True,  help="Directory for the final GGUF file")
    parser.add_argument("--llama_cpp_dir", required=True, help="Path to cloned llama.cpp repo")
    parser.add_argument("--quantize",     default="q4_k_m",
                        choices=["f16", "q8_0", "q5_k_m", "q4_k_m", "q4_k_s", "q3_k_m"],
                        help="Quantization level (default: q4_k_m)")
    parser.add_argument("--skip_merge",   action="store_true",
                        help="Skip merge step (if merged model already exists at --output_dir)")
    args = parser.parse_args()

    if not args.skip_merge:
        merge_lora(args.base_model, args.lora_path, args.output_dir)
    else:
        print(f"[1/3] Skipping merge (--skip_merge). Using: {args.output_dir}")

    gguf_path = convert_to_gguf(args.output_dir, args.gguf_out, args.llama_cpp_dir, args.quantize)
    print_next_steps(str(gguf_path), args.base_model)


if __name__ == "__main__":
    main()
