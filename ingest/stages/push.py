"""Persist video, segments, and frames to Neon + Qdrant."""
from __future__ import annotations

import uuid
from dataclasses import dataclass

import numpy as np
from qdrant_client.models import PointStruct

from config import (
    QDRANT_COLLECTION_FRAMES,
    QDRANT_COLLECTION_SEGMENTS,
)
from db import connect
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
