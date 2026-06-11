"""Qdrant helpers: collection setup and idempotent creation."""
from __future__ import annotations

from qdrant_client import QdrantClient
from qdrant_client.models import Distance, PayloadSchemaType, VectorParams

from config import (
    CLIP_DIM,
    QDRANT_API_KEY,
    QDRANT_COLLECTION_FRAMES,
    QDRANT_COLLECTION_MOMENTS,
    QDRANT_COLLECTION_SEGMENTS,
    QDRANT_COLLECTION_SESSIONS,
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

    if QDRANT_COLLECTION_MOMENTS in existing:
        status[QDRANT_COLLECTION_MOMENTS] = "exists"
    else:
        c.create_collection(
            collection_name=QDRANT_COLLECTION_MOMENTS,
            vectors_config=VectorParams(size=TEXT_EMBED_DIM, distance=Distance.COSINE),
        )
        status[QDRANT_COLLECTION_MOMENTS] = "created"

    if QDRANT_COLLECTION_SESSIONS in existing:
        status[QDRANT_COLLECTION_SESSIONS] = "exists"
    else:
        c.create_collection(
            collection_name=QDRANT_COLLECTION_SESSIONS,
            vectors_config=VectorParams(size=TEXT_EMBED_DIM, distance=Distance.COSINE),
        )
        status[QDRANT_COLLECTION_SESSIONS] = "created"

    _ensure_payload_index(c, QDRANT_COLLECTION_SEGMENTS, "video_id")
    _ensure_payload_index(c, QDRANT_COLLECTION_FRAMES, "video_id")
    for field in ("video_id", "kind", "industry", "revenue_band", "problems"):
        _ensure_payload_index(c, QDRANT_COLLECTION_MOMENTS, field)
    for field in (
        "video_id",
        "industry",
        "secondary_industries",
        "revenue_band",
        "attendee_gender",
        "topics",
    ):
        _ensure_payload_index(c, QDRANT_COLLECTION_SESSIONS, field)

    return status


def _ensure_payload_index(c: QdrantClient, collection: str, field: str) -> None:
    """Create a keyword payload index on `field` if it doesn't already exist."""
    info = c.get_collection(collection)
    schema = info.payload_schema or {}
    if field in schema:
        return
    c.create_payload_index(
        collection_name=collection, field_name=field, field_schema=PayloadSchemaType.KEYWORD
    )
