"""Qdrant helpers: collection setup and idempotent creation."""
from __future__ import annotations

from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams

from config import (
    CLIP_DIM,
    QDRANT_API_KEY,
    QDRANT_COLLECTION_FRAMES,
    QDRANT_COLLECTION_SEGMENTS,
    QDRANT_URL,
    TEXT_EMBED_DIM,
)


def client() -> QdrantClient:
    return QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY, timeout=30)


def ensure_collections() -> dict[str, str]:
    """Create the segments + frames collections if missing. Returns a status map."""
    c = client()
    status: dict[str, str] = {}

    existing = {col.name for col in c.get_collections().collections}

    if QDRANT_COLLECTION_SEGMENTS in existing:
        status[QDRANT_COLLECTION_SEGMENTS] = "exists"
    else:
        c.create_collection(
            collection_name=QDRANT_COLLECTION_SEGMENTS,
            vectors_config=VectorParams(size=TEXT_EMBED_DIM, distance=Distance.COSINE),
        )
        status[QDRANT_COLLECTION_SEGMENTS] = "created"

    if QDRANT_COLLECTION_FRAMES in existing:
        status[QDRANT_COLLECTION_FRAMES] = "exists"
    else:
        c.create_collection(
            collection_name=QDRANT_COLLECTION_FRAMES,
            vectors_config=VectorParams(size=CLIP_DIM, distance=Distance.COSINE),
        )
        status[QDRANT_COLLECTION_FRAMES] = "created"

    return status
