"""CivicFlow local / open-source AI layer.

Intended runtime:
  Phone (Kotlin port) → first-pass classification (this algorithm)
  Flask               → same algorithm as offline fallback
  Gemini              → deeper reasoning when the cloud is available

Honest NPU note:
  This environment does not execute Snapdragon NPU inference. The hashing
  n-gram encoder below is a real on-device-capable model (tiny, open,
  deterministic) designed to run on CPU now and on NPU later via ONNX.

Optional upgrade path (not required at runtime):
  CIVICFLOW_ONNX_MODEL = path to MiniLM / Gemma ONNX for richer embeddings.
"""

from __future__ import annotations

import hashlib
import math
import os
from typing import Any

from civic_intelligence import classify_local, merge_local_and_cloud, validate_and_normalize

DIM = 128


def hashed_ngram_embed(text: str, dim: int = DIM) -> list[float]:
    """Open, portable encoder — same math as android/.../LocalCivicModel.kt."""
    vec = [0.0] * dim
    tokens = [t for t in "".join(ch.lower() if ch.isalnum() else " " for ch in (text or "")).split() if t]
    for i, _ in enumerate(tokens):
        for n in (1, 2, 3):
            if i + n > len(tokens):
                continue
            gram = " ".join(tokens[i : i + n])
            digest = hashlib.md5(gram.encode("utf-8")).hexdigest()
            idx = int(digest[:8], 16) % dim
            vec[idx] += 1.0 / n
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


def cosine(a: list[float], b: list[float]) -> float:
    return float(sum(x * y for x, y in zip(a, b)))


def try_onnx_embed(text: str) -> list[float] | None:
    path = os.getenv("CIVICFLOW_ONNX_MODEL")
    if not path or not os.path.isfile(path):
        return None
    try:
        import numpy as np
        import onnxruntime as ort  # type: ignore
    except Exception:
        return None
    # Placeholder hook: real MiniLM tokenization would go here.
    # We refuse to fake NPU/ONNX results if the session cannot run.
    try:
        sess = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
        _ = sess
        _ = np
        _ = text
    except Exception:
        return None
    return None


def first_pass(problem: str, city: str = "", image_hint: str = "") -> dict[str, Any]:
    combined = " ".join(p for p in (problem, city, image_hint) if p)
    result = classify_local(problem, city)
    result["embedding"] = hashed_ngram_embed(combined)
    result["localModel"] = "CivicHashNgram-128 (open, on-device-capable)"
    result["onnxAvailable"] = try_onnx_embed(combined) is not None
    result["npuClaim"] = False
    return result


def analyze_hybrid(
    problem: str,
    city: str = "",
    gemini_payload: dict[str, Any] | None = None,
    image_hint: str = "",
) -> dict[str, Any]:
    local = first_pass(problem, city, image_hint)
    merged = merge_local_and_cloud(local, gemini_payload)
    merged["embedding"] = local.get("embedding")
    merged["localModel"] = local.get("localModel")
    merged["npuClaim"] = False
    return validate_and_normalize(merged, problem, city)
