"""Text and image embeddings.

- Text via OpenAI text-embedding-3-small (1536-d). Batched.
- Images via open CLIP ViT-L-14 (768-d). Lazy-loaded once per process.

Both encoders are also usable on queries: the same OpenAI model embeds the
search text for the segment index, and CLIP's text encoder embeds the same
search text for the frame index. Cross-modal retrieval relies on this.
"""
from __future__ import annotations

import threading
from pathlib import Path
from typing import Iterable

import numpy as np
from openai import OpenAI
from PIL import Image

from config import (
    CLIP_DIM,
    CLIP_MODEL,
    CLIP_PRETRAINED,
    OPENAI_API_KEY,
    TEXT_EMBED_DIM,
    TEXT_EMBED_MODEL,
)

_TEXT_BATCH = 64
_IMAGE_BATCH = 16


def embed_texts(texts: list[str]) -> np.ndarray:
    """Returns a (len(texts), 1536) float32 array."""
    if not texts:
        return np.zeros((0, TEXT_EMBED_DIM), dtype=np.float32)
    client = OpenAI(api_key=OPENAI_API_KEY)
    out: list[list[float]] = []
    for i in range(0, len(texts), _TEXT_BATCH):
        batch = texts[i : i + _TEXT_BATCH]
        resp = client.embeddings.create(model=TEXT_EMBED_MODEL, input=batch)
        out.extend([d.embedding for d in resp.data])
    return np.asarray(out, dtype=np.float32)


_clip_lock = threading.Lock()
_clip_state: dict = {}


def _ensure_clip():
    with _clip_lock:
        if _clip_state:
            return _clip_state
        import torch
        import open_clip

        device = "cuda" if torch.cuda.is_available() else "cpu"
        model, _, preprocess = open_clip.create_model_and_transforms(
            CLIP_MODEL, pretrained=CLIP_PRETRAINED
        )
        model.eval()
        model.to(device)
        tokenizer = open_clip.get_tokenizer(CLIP_MODEL)
        _clip_state.update(
            model=model, preprocess=preprocess, tokenizer=tokenizer, device=device, torch=torch
        )
        return _clip_state


def embed_images(paths: Iterable[Path]) -> np.ndarray:
    state = _ensure_clip()
    torch = state["torch"]
    preprocess = state["preprocess"]
    model = state["model"]
    device = state["device"]

    all_paths = list(paths)
    if not all_paths:
        return np.zeros((0, CLIP_DIM), dtype=np.float32)

    embeddings: list[np.ndarray] = []
    for i in range(0, len(all_paths), _IMAGE_BATCH):
        batch_paths = all_paths[i : i + _IMAGE_BATCH]
        tensors = []
        for p in batch_paths:
            with Image.open(p) as im:
                tensors.append(preprocess(im.convert("RGB")))
        batch = torch.stack(tensors).to(device)
        with torch.no_grad():
            vecs = model.encode_image(batch)
            vecs = vecs / vecs.norm(dim=-1, keepdim=True)
        embeddings.append(vecs.detach().cpu().float().numpy())

    return np.concatenate(embeddings, axis=0)


def embed_clip_text(query: str) -> np.ndarray:
    """Embed a search query with CLIP's text encoder for frame retrieval."""
    state = _ensure_clip()
    torch = state["torch"]
    tokenizer = state["tokenizer"]
    model = state["model"]
    device = state["device"]
    tokens = tokenizer([query]).to(device)
    with torch.no_grad():
        vec = model.encode_text(tokens)
        vec = vec / vec.norm(dim=-1, keepdim=True)
    return vec.detach().cpu().float().numpy()[0]
