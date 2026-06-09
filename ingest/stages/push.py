"""Persist video, segments, frames, and Q→A moments to Neon + Qdrant."""
from __future__ import annotations

import uuid
from dataclasses import dataclass

import numpy as np
from qdrant_client.models import PointStruct

from config import (
    QDRANT_COLLECTION_FRAMES,
    QDRANT_COLLECTION_MOMENTS,
    QDRANT_COLLECTION_SEGMENTS,
)
from db import connect
from stages.audio_features import MomentAudio
from stages.context import AttendeeContext
from stages.pair import Moment
from stages.segment import Segment
from vectors import client as qdrant_client


@dataclass
class VideoRecord:
    id: str
    url: str
    title: str
    channel: str
    duration_s: float


@dataclass
class FrameRecord:
    t_s: float
    blob_url: str


def upsert_video(video: VideoRecord) -> None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            insert into videos (id, url, title, channel, duration_s, last_indexed_at)
            values (%s, %s, %s, %s, %s, now())
            on conflict (id) do update set
                url = excluded.url,
                title = excluded.title,
                channel = excluded.channel,
                duration_s = excluded.duration_s,
                last_indexed_at = now()
            """,
            (video.id, video.url, video.title, video.channel, video.duration_s),
        )
        conn.commit()


def video_exists(video_id: str) -> bool:
    with connect() as conn, conn.cursor() as cur:
        cur.execute("select 1 from videos where id = %s", (video_id,))
        return cur.fetchone() is not None


def replace_segments(video_id: str, segments: list[Segment], vectors: np.ndarray) -> int:
    assert len(segments) == vectors.shape[0]
    q = qdrant_client()
    point_ids = [uuid.uuid4() for _ in segments]

    with connect() as conn, conn.cursor() as cur:
        cur.execute("delete from segments where video_id = %s", (video_id,))
        for seg, pid in zip(segments, point_ids):
            cur.execute(
                "insert into segments (video_id, start_s, end_s, text, qdrant_point_id) "
                "values (%s, %s, %s, %s, %s)",
                (video_id, seg.start_s, seg.end_s, seg.text, str(pid)),
            )
        conn.commit()

    # Delete any prior points for this video before re-upserting.
    from qdrant_client.models import FieldCondition, Filter, MatchValue, FilterSelector

    q.delete(
        collection_name=QDRANT_COLLECTION_SEGMENTS,
        points_selector=FilterSelector(
            filter=Filter(must=[FieldCondition(key="video_id", match=MatchValue(value=video_id))])
        ),
    )

    points = [
        PointStruct(
            id=str(pid),
            vector=vec.tolist(),
            payload={"video_id": video_id, "start_s": seg.start_s, "end_s": seg.end_s},
        )
        for seg, vec, pid in zip(segments, vectors, point_ids)
    ]
    q.upsert(collection_name=QDRANT_COLLECTION_SEGMENTS, points=points)
    return len(points)


def replace_frames(video_id: str, frames: list[FrameRecord], vectors: np.ndarray) -> int:
    assert len(frames) == vectors.shape[0]
    q = qdrant_client()
    point_ids = [uuid.uuid4() for _ in frames]

    with connect() as conn, conn.cursor() as cur:
        cur.execute("delete from frames where video_id = %s", (video_id,))
        for fr, pid in zip(frames, point_ids):
            cur.execute(
                "insert into frames (video_id, t_s, blob_url, qdrant_point_id) "
                "values (%s, %s, %s, %s)",
                (video_id, fr.t_s, fr.blob_url, str(pid)),
            )
        conn.commit()

    from qdrant_client.models import FieldCondition, Filter, MatchValue, FilterSelector

    q.delete(
        collection_name=QDRANT_COLLECTION_FRAMES,
        points_selector=FilterSelector(
            filter=Filter(must=[FieldCondition(key="video_id", match=MatchValue(value=video_id))])
        ),
    )

    points = [
        PointStruct(
            id=str(pid),
            vector=vec.tolist(),
            payload={"video_id": video_id, "t_s": fr.t_s},
        )
        for fr, vec, pid in zip(frames, vectors, point_ids)
    ]
    q.upsert(collection_name=QDRANT_COLLECTION_FRAMES, points=points)
    return len(points)


def replace_moments(
    video_id: str,
    moments: list[Moment],
    contexts: list[AttendeeContext],
    audios: list[MomentAudio],
    clip_scores: list[float],
    answer_vectors: np.ndarray,
    question_vectors: np.ndarray,
) -> int:
    """Replace all Q→A moments for a video. One Qdrant point per question and
    per answer (same collection, distinguished by payload `kind`)."""
    n = len(moments)
    assert (
        n == len(contexts) == len(audios) == len(clip_scores)
        == answer_vectors.shape[0] == question_vectors.shape[0]
    )
    q = qdrant_client()
    a_point_ids = [uuid.uuid4() for _ in moments]
    q_point_ids = [uuid.uuid4() for _ in moments]

    with connect() as conn, conn.cursor() as cur:
        cur.execute("delete from moments where video_id = %s", (video_id,))
        for m, ctx, au, cs, a_pid, q_pid in zip(
            moments, contexts, audios, clip_scores, a_point_ids, q_point_ids
        ):
            cur.execute(
                """
                insert into moments (
                    video_id, q_start_s, q_end_s, q_text,
                    a_start_s, a_end_s, a_text,
                    industry, revenue_band, problems,
                    audio_quality, energy_peak, clip_score,
                    a_qdrant_point_id, q_qdrant_point_id
                ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    video_id, m.q_start_s, m.q_end_s, m.q_text,
                    m.a_start_s, m.a_end_s, m.a_text,
                    ctx.industry, ctx.revenue_band, ctx.problems,
                    au.audio_quality, au.energy_peak, cs,
                    str(a_pid), str(q_pid),
                ),
            )
        conn.commit()

    from qdrant_client.models import FieldCondition, Filter, MatchValue, FilterSelector

    q.delete(
        collection_name=QDRANT_COLLECTION_MOMENTS,
        points_selector=FilterSelector(
            filter=Filter(must=[FieldCondition(key="video_id", match=MatchValue(value=video_id))])
        ),
    )

    points: list[PointStruct] = []
    for m, ctx, au, cs, a_pid, q_pid, a_vec, q_vec in zip(
        moments, contexts, audios, clip_scores,
        a_point_ids, q_point_ids, answer_vectors, question_vectors,
    ):
        payload_common = {
            "video_id": video_id,
            "industry": ctx.industry,
            "revenue_band": ctx.revenue_band,
            "problems": ctx.problems,
            "audio_quality": au.audio_quality,
            "energy_peak": au.energy_peak,
            "clip_score": cs,
        }
        points.append(
            PointStruct(
                id=str(a_pid),
                vector=a_vec.tolist(),
                payload={
                    **payload_common,
                    "kind": "answer",
                    "start_s": m.a_start_s,
                    "end_s": m.a_end_s,
                    "pair_qdrant_id": str(q_pid),
                },
            )
        )
        points.append(
            PointStruct(
                id=str(q_pid),
                vector=q_vec.tolist(),
                payload={
                    **payload_common,
                    "kind": "question",
                    "start_s": m.q_start_s,
                    "end_s": m.q_end_s,
                    "pair_qdrant_id": str(a_pid),
                },
            )
        )
    q.upsert(collection_name=QDRANT_COLLECTION_MOMENTS, points=points)
    return n
