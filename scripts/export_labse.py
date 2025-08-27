#!/usr/bin/env python3
import argparse
import json
import os
from pathlib import Path

from transformers import AutoTokenizer, AutoModel
from transformers.onnx import export, FeaturesManager
from transformers.utils import logging

logging.set_verbosity_info()

# Export encoder-only model to ONNX (sequence classification/feature-extraction)
# Model: cointegrated/LaBSE-en-ru

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="cointegrated/LaBSE-en-ru")
    parser.add_argument("--out", default="/app/models")
    parser.add_argument("--opset", type=int, default=13)
    parser.add_argument("--max_len", type=int, default=256)
    args = parser.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    model_name = args.model
    # Prefer the modern 'default' ONNX feature for encoder-only models
    task = "default"

    tokenizer = AutoTokenizer.from_pretrained(model_name, use_fast=True)
    model = AutoModel.from_pretrained(model_name)

    # Determine ONNX config for the model
    # transformers expects (model_type: str, feature: str)
    model_type = getattr(model.config, "model_type", None) or "bert"
    try:
        onnx_config_cls = FeaturesManager.get_config(model_type, task)
    except KeyError:
        # Fallback for older/newer mappings
        onnx_config_cls = FeaturesManager.get_config(model_type, "sequence-classification")
    onnx_config = onnx_config_cls(model.config)

    onnx_path = out_dir / "encoder.onnx"

    # Dummy inputs
    dummy_inputs = onnx_config.generate_dummy_inputs(tokenizer, framework="pt")

    export(
        preprocessor=tokenizer,
        model=model,
        config=onnx_config,
        opset=args.opset,
        output=onnx_path,
    )

    # Save tokenizer files (vocab.txt, configs) to the output directory
    try:
        tokenizer.save_pretrained(out_dir)
        print(f"[export] Saved tokenizer files to {out_dir}")
    except Exception as e:
        print(f"[export] Warning: failed to save_pretrained tokenizer: {e}")

    # Ensure tokenizer.json exists for @xenova/transformers local loading
    tok_json = out_dir / "tokenizer.json"
    if not tok_json.exists():
        print("[export] tokenizer.json not found; building from vocab.txt using tokenizers library ...")
        try:
            from tokenizers import Tokenizer
            from tokenizers.models import WordPiece
            from tokenizers.normalizers import BertNormalizer
            from tokenizers.pre_tokenizers import BertPreTokenizer
            from tokenizers.trainers import WordPieceTrainer

            vocab_file = out_dir / "vocab.txt"
            if vocab_file.exists():
                # Build vocab dict preserving indices
                vocab = {}
                with open(vocab_file, "r", encoding="utf-8") as vf:
                    for idx, token in enumerate(line.strip() for line in vf):
                        if token:
                            vocab[token] = idx
                unk = "[UNK]"
                cls = "[CLS]"
                sep = "[SEP]"
                special_tokens = [unk, cls, sep]
                tokenizer_fast = Tokenizer(WordPiece(vocab=vocab, unk_token=unk))
                tokenizer_fast.normalizer = BertNormalizer(lowercase=False)
                tokenizer_fast.pre_tokenizer = BertPreTokenizer()
                trainer = WordPieceTrainer(vocab_size=len(vocab), special_tokens=special_tokens)
                tokenizer_fast.train_from_iterator(vocab, trainer=trainer)
                tokenizer_fast.save(str(tok_json))
                print(f"[export] Wrote {tok_json}")
        except Exception as e:
            print(f"[export] Failed to build tokenizer.json: {e}")

    # Ensure tokenizer_config.json and special_tokens_map.json for @xenova/transformers
    tok_cfg = out_dir / "tokenizer_config.json"
    if not tok_cfg.exists():
        cfg_payload = {
            "tokenizer_class": "BertTokenizerFast",
            "do_lower_case": False,
            "model_max_length": args.max_len,
        }
        tok_cfg.write_text(json.dumps(cfg_payload, ensure_ascii=False, indent=2))
        print(f"[export] Wrote {tok_cfg}")

    special_map = out_dir / "special_tokens_map.json"
    if not special_map.exists():
        payload = {
            "unk_token": "[UNK]",
            "sep_token": "[SEP]",
            "pad_token": "[PAD]",
            "cls_token": "[CLS]",
            "mask_token": "[MASK]",
        }
        special_map.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
        print(f"[export] Wrote {special_map}")

    # Metadata
    meta = {
        "source_model": model_name,
        "hidden_size": int(getattr(model.config, "hidden_size", 768)),
        "max_position_embeddings": int(getattr(model.config, "max_position_embeddings", args.max_len)),
        "feature": task,
        "opset": args.opset,
        "files": {
            "onnx": str(onnx_path.name),
            "tokenizer": "tokenizer.json" if (out_dir / "tokenizer.json").exists() else None,
        },
    }
    with open(out_dir / "metadata.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    print("Exported:", onnx_path)

if __name__ == "__main__":
    main()
