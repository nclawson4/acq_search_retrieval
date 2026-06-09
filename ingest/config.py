"""Central config — loads .env from project root and exposes typed settings."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")


def _required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing required env var: {name}")
    return value


OPENAI_API_KEY = _required("OPENAI_API_KEY")
QDRANT_URL = _required("QDRANT_URL")
QDRANT_API_KEY = _required("QDRANT_API_KEY")
DATABASE_URL = _required("DATABASE_URL")
DATABASE_URL_UNPOOLED = os.environ.get("DATABASE_URL_UNPOOLED", DATABASE_URL)
BLOB_READ_WRITE_TOKEN = os.environ.get("BLOB_READ_WRITE_TOKEN", "")

QDRANT_COLLECTION_SEGMENTS = "segments"
QDRANT_COLLECTION_FRAMES = "frames"

TEXT_EMBED_MODEL = "text-embedding-3-small"
TEXT_EMBED_DIM = 1536

CLIP_MODEL = "ViT-L-14"
CLIP_PRETRAINED = "laion2b_s32b_b82k"
CLIP_DIM = 768

CACHE_DIR = PROJECT_ROOT / "ingest" / "cache"
FRAMES_DIR = PROJECT_ROOT / "ingest" / "frames"
MEDIA_DIR = PROJECT_ROOT / "ingest" / "media"
