"""Phase 1 smoke test — verifies OpenAI, Qdrant, and Neon connectivity.

Exits non-zero on any failure. Run from ingest/ after installing requirements.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from openai import OpenAI  # noqa: E402

from config import (  # noqa: E402
    OPENAI_API_KEY,
    QDRANT_COLLECTION_FRAMES,
    QDRANT_COLLECTION_SEGMENTS,
    TEXT_EMBED_DIM,
    TEXT_EMBED_MODEL,
)
from db import connect  # noqa: E402
from vectors import client as qdrant_client  # noqa: E402


def check_neon() -> None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute("select 1")
        assert cur.fetchone() == (1,)
        cur.execute("select count(*) from videos")
        n_videos = cur.fetchone()[0]
        cur.execute("select count(*) from segments")
        n_segs = cur.fetchone()[0]
    print(f"  Neon OK — videos={n_videos}, segments={n_segs}")


def check_qdrant() -> None:
    c = qdrant_client()
    cols = {col.name for col in c.get_collections().collections}
    for needed in (QDRANT_COLLECTION_SEGMENTS, QDRANT_COLLECTION_FRAMES):
        assert needed in cols, f"missing collection: {needed}"
    info_seg = c.get_collection(QDRANT_COLLECTION_SEGMENTS)
    info_frm = c.get_collection(QDRANT_COLLECTION_FRAMES)
    print(
        f"  Qdrant OK — segments(points={info_seg.points_count}), frames(points={info_frm.points_count})"
    )


def check_openai() -> None:
    oai = OpenAI(api_key=OPENAI_API_KEY)
    resp = oai.embeddings.create(model=TEXT_EMBED_MODEL, input=["smoke test"])
    vec = resp.data[0].embedding
    assert len(vec) == TEXT_EMBED_DIM, f"unexpected embedding dim: {len(vec)}"
    print(f"  OpenAI OK — {TEXT_EMBED_MODEL} returned {len(vec)}-d vector")


def main() -> int:
    failures: list[str] = []
    for name, fn in [("Neon", check_neon), ("Qdrant", check_qdrant), ("OpenAI", check_openai)]:
        print(f"Checking {name} ...")
        try:
            fn()
        except Exception as exc:
            failures.append(f"{name}: {exc!r}")
            print(f"  FAILED — {exc!r}")

    if failures:
        print("\nFAILURES:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("\nAll checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
