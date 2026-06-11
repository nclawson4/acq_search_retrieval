"""Run session segmentation over every video in the DB and insert into `sessions`.

Idempotent: deletes existing rows for a video before re-inserting. The Qdrant
point ID per session is a stable UUID derived from (video_id, start_s, end_s),
so re-runs upsert cleanly without orphaning points.

Embeddings of conversation_summary are NOT computed here — they happen in the
LLM tagging pass (Phase 3). This script just lays down boundaries + full_text.
"""
from __future__ import annotations

import sys
import uuid
from pathlib import Path

import psycopg

# Allow `python -m scripts.populate_sessions` from the ingest dir.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from db import connect
from stages.sessions import segment_sessions

NAMESPACE = uuid.UUID("4f8a1d3e-2b5c-4f0a-9c1d-1e7d2a8f5e3b")


def session_point_id(video_id: str, start_s: float, end_s: float) -> uuid.UUID:
    name = f"{video_id}:{start_s:.3f}:{end_s:.3f}"
    return uuid.uuid5(NAMESPACE, name)


def populate_all() -> None:
    with connect() as c, c.cursor() as cur:
        cur.execute("select id, duration_s from videos order by id")
        videos = cur.fetchall()
    print(f"Found {len(videos)} videos.")

    media_dir = Path(__file__).resolve().parent.parent / "media"

    total_sessions = 0
    for vid, duration_s in videos:
        audio_path = media_dir / f"{vid}.audio.mp3"
        if not audio_path.exists():
            print(f"  SKIP {vid}: audio missing")
            continue
        try:
            sess = segment_sessions(vid, audio_path, float(duration_s))
        except Exception as exc:
            print(f"  ERROR {vid}: {exc!r}")
            continue
        if not sess:
            print(f"  {vid}: no sessions")
            continue

        with connect() as c, c.cursor() as cur:
            cur.execute("delete from sessions where video_id = %s", (vid,))
            for s in sess:
                pt = session_point_id(s.video_id, s.start_s, s.end_s)
                cur.execute(
                    """
                    insert into sessions
                        (video_id, start_s, end_s, play_start_s,
                         attendee_cluster_id, full_text,
                         summary_qdrant_point_id)
                    values (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    (s.video_id, s.start_s, s.end_s, s.play_start_s,
                     s.attendee_cluster_id, s.full_text, str(pt)),
                )
            c.commit()
        total_sessions += len(sess)
        print(f"  {vid}: {len(sess)} sessions")

    print(f"\nDone. {total_sessions} total sessions across {len(videos)} videos.")


if __name__ == "__main__":
    populate_all()
