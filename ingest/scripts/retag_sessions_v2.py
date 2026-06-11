"""Re-tag every session with the verification-gated multi-industry pipeline.

Writes back primary `industry`, `secondary_industries[]`, `industry_evidence`
JSON (including audit rejects for transparency), plus refreshes
`conversation_summary`, `revenue_band`, `attendee_gender`, `topics`. Also
re-embeds the summary into Qdrant.

Idempotent. Concurrency-limited to keep API spend predictable.
"""
from __future__ import annotations

import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np
from qdrant_client.models import FieldCondition, Filter, FilterSelector, PointStruct

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import QDRANT_COLLECTION_SESSIONS
from db import connect
from stages.embed import embed_texts
from stages.tag_session_v2 import IndustryTag, SessionTagsV2, tag_session_v2
from vectors import client as qdrant_client


CONCURRENCY = 4


def _fetch_sessions() -> list[dict]:
    with connect() as c, c.cursor() as cur:
        cur.execute(
            """
            select s.id, s.video_id, s.start_s, s.end_s, s.full_text,
                   s.summary_qdrant_point_id, s.dup_group_id, v.title
            from sessions s join videos v on v.id = s.video_id
            order by s.id
            """
        )
        return [
            {
                "id": r[0],
                "video_id": r[1],
                "start_s": float(r[2]),
                "end_s": float(r[3]),
                "full_text": r[4],
                "point_id": r[5],
                "dup_group_id": r[6],
                "video_title": r[7],
            }
            for r in cur.fetchall()
        ]


def _evidence_payload(tags: SessionTagsV2) -> dict:
    """Serializable per-industry evidence block, including audit rejects."""
    def row(t: IndustryTag) -> dict:
        return {
            "industry": t.industry,
            "confidence": round(t.confidence, 3),
            "evidence": t.evidence,
            "actively_discussed": t.actively_discussed,
            "quote_verified": t.quote_verified,
            "audit_passed": t.audit_passed,
            "audit_reason": t.audit_reason,
        }

    return {
        "primary": row(tags.primary_tag),
        "secondaries_kept": [row(t) for t in tags.secondary_tags],
        "secondaries_rejected": [
            row(t)
            for t in tags.all_candidates
            if t is not tags.primary_tag and t not in tags.secondary_tags
        ],
    }


def retag_all() -> None:
    sessions = _fetch_sessions()
    print(f"{len(sessions)} sessions to retag.")

    def work(s):
        t0 = time.time()
        try:
            return s, tag_session_v2(s["full_text"]), None, time.time() - t0
        except Exception as e:
            return s, None, repr(e), time.time() - t0

    tagged: list[tuple[dict, SessionTagsV2]] = []
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as ex:
        futures = [ex.submit(work, s) for s in sessions]
        done = 0
        for f in as_completed(futures):
            s, tags, err, dt = f.result()
            done += 1
            if err:
                print(f"  [{done}/{len(sessions)}] ERROR  s{s['id']} {s['video_id']}  {err}")
                continue
            tagged.append((s, tags))
            secondary_label = (
                ",".join(tags.secondary_industries) if tags.secondary_industries else "-"
            )
            print(
                f"  [{done}/{len(sessions)}] OK  s{s['id']:>3} {s['video_id']:<14} "
                f"prim={tags.primary_industry:<26}  sec=[{secondary_label}]  "
                f"({dt:.1f}s)"
            )

    if not tagged:
        return

    summaries = [t.conversation_summary for _, t in tagged]
    print(f"\nEmbedding {len(summaries)} summaries ...")
    vecs = embed_texts(summaries)

    print("Writing Postgres ...")
    with connect() as c, c.cursor() as cur:
        for (s, t) in tagged:
            cur.execute(
                """
                update sessions set
                    industry = %s,
                    secondary_industries = %s,
                    industry_evidence = %s,
                    revenue_band = %s,
                    attendee_gender = %s,
                    topics = %s,
                    conversation_summary = %s
                where id = %s
                """,
                (
                    t.primary_industry,
                    t.secondary_industries,
                    json.dumps(_evidence_payload(t)),
                    t.revenue_band,
                    t.gender,
                    t.topics,
                    t.conversation_summary,
                    s["id"],
                ),
            )
        c.commit()

    print("Replacing Qdrant points ...")
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
                    "industry": t.primary_industry,
                    "secondary_industries": t.secondary_industries,
                    "revenue_band": t.revenue_band,
                    "attendee_gender": t.gender,
                    "topics": t.topics,
                    "conversation_summary": t.conversation_summary,
                },
            )
        )
    qc.upsert(collection_name=QDRANT_COLLECTION_SESSIONS, points=points)
    print(f"Upserted {len(points)} points. Done.")


if __name__ == "__main__":
    retag_all()
