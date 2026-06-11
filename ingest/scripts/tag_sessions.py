"""Phase 3: LLM-tag every session, embed summaries, push to Qdrant.

Idempotent: re-running re-tags + re-embeds + replaces points. Cheap (~$0.05
total at the current corpus size).
"""
from __future__ import annotations

import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np
from qdrant_client.models import FieldCondition, Filter, FilterSelector, MatchValue, PointStruct

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import QDRANT_COLLECTION_SESSIONS
from db import connect
from stages.embed import embed_texts
from stages.tag_session import tag_session
from vectors import client as qdrant_client


def _fetch_sessions() -> list[dict]:
    with connect() as c, c.cursor() as cur:
        cur.execute(
            """
            select s.id, s.video_id, s.start_s, s.end_s, s.full_text,
                   s.summary_qdrant_point_id, v.title
            from sessions s join videos v on v.id = s.video_id
            order by s.video_id, s.start_s
            """
        )
        return [
            {
                "id": r[0], "video_id": r[1], "start_s": float(r[2]),
                "end_s": float(r[3]), "full_text": r[4],
                "point_id": r[5], "video_title": r[6],
            }
            for r in cur.fetchall()
        ]


def tag_all(concurrency: int = 6) -> None:
    sessions = _fetch_sessions()
    print(f"{len(sessions)} sessions to tag.")

    def work(s):
        t0 = time.time()
        try:
            return s, tag_session(s["full_text"]), None, time.time() - t0
        except Exception as e:
            return s, None, repr(e), time.time() - t0

    tagged: list[tuple[dict, object]] = []
    with ThreadPoolExecutor(max_workers=concurrency) as ex:
        futures = [ex.submit(work, s) for s in sessions]
        done = 0
        for f in as_completed(futures):
            s, tags, err, dt = f.result()
            done += 1
            if err:
                print(f"  [{done}/{len(sessions)}] ERROR  {s['video_id']}@{int(s['start_s'])}s  {err}")
                continue
            tagged.append((s, tags))
            print(f"  [{done}/{len(sessions)}] OK  {s['video_id']}@{int(s['start_s'])}s "
                  f"  ind={tags.industry}  rev={tags.revenue_band}  g={tags.gender}  "
                  f"topics={tags.topics}  ({dt:.1f}s)")

    if not tagged:
        return

    # Embed all summaries in one batch.
    summaries = [t.conversation_summary for _, t in tagged]
    print(f"\nEmbedding {len(summaries)} summaries ...")
    vecs = embed_texts(summaries)

    # Write Postgres rows + Qdrant points.
    print("Writing Postgres ...")
    with connect() as c, c.cursor() as cur:
        for (s, t) in tagged:
            cur.execute(
                """
                update sessions set
                    industry = %s,
                    revenue_band = %s,
                    attendee_gender = %s,
                    topics = %s,
                    conversation_summary = %s
                where id = %s
                """,
                (t.industry, t.revenue_band, t.gender, t.topics, t.conversation_summary, s["id"]),
            )
        c.commit()

    # Replace points: simpler to delete the entire collection's points for any
    # touched video, then upsert. We're rewriting all 69, so just clear all
    # and upsert.
    qc = qdrant_client()
    qc.delete(
        collection_name=QDRANT_COLLECTION_SESSIONS,
        points_selector=FilterSelector(filter=Filter(must=[])),
    )

    points = []
    for (s, t), vec in zip(tagged, vecs):
        points.append(
            PointStruct(
                id=str(s["point_id"]),
                vector=vec.tolist(),
                payload={
                    "session_id": s["id"],
                    "video_id": s["video_id"],
                    "video_title": s["video_title"],
                    "start_s": s["start_s"],
                    "end_s": s["end_s"],
                    "industry": t.industry,
                    "revenue_band": t.revenue_band,
                    "attendee_gender": t.gender,
                    "topics": t.topics,
                    "conversation_summary": t.conversation_summary,
                },
            )
        )
    print(f"Upserting {len(points)} Qdrant points ...")
    qc.upsert(collection_name=QDRANT_COLLECTION_SESSIONS, points=points)
    print("Done.")


if __name__ == "__main__":
    tag_all()
