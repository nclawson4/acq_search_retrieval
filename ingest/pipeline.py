"""Orchestrator: run all ingest stages for one or more YouTube URLs.

Usage:
    python -m pipeline <url-or-file>
    python -m pipeline ../urls.txt
    python -m pipeline https://www.youtube.com/watch?v=...

Idempotent: existing video_ids are skipped unless --force is passed.
"""
from __future__ import annotations

import argparse
import sys
import time
import traceback
from pathlib import Path

from config import CACHE_DIR, FRAMES_DIR, MEDIA_DIR
from stages.blob import upload_file
from stages.download import download
from stages.embed import embed_images, embed_texts
from stages.push import FrameRecord, VideoRecord, replace_frames, replace_segments, upsert_video, video_exists
from stages.scenes import extract_keyframes
from stages.segment import segment_words
from stages.transcribe import transcribe


def _read_urls(arg: str) -> list[str]:
    p = Path(arg)
    if p.exists() and p.is_file():
        return [line.strip() for line in p.read_text().splitlines() if line.strip() and not line.startswith("#")]
    return [arg]


def _log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def ingest_one(url: str, force: bool = False) -> dict:
    _log(f"== {url} ==")
    out_dir = MEDIA_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

    d = download(url, out_dir)
    _log(f"  downloaded {d.video_id}: {d.title!r} ({d.duration_s:.0f}s)")

    if not force and video_exists(d.video_id):
        _log(f"  SKIP {d.video_id} — already indexed (pass --force to re-ingest)")
        return {"video_id": d.video_id, "skipped": True}

    upsert_video(
        VideoRecord(
            id=d.video_id,
            url=d.url,
            title=d.title,
            channel=d.channel,
            duration_s=d.duration_s,
        )
    )

    _log("  transcribing ...")
    trans = transcribe(d.audio_path)
    _log(f"    {len(trans.words)} words")

    segs = segment_words(trans.words)
    _log(f"    {len(segs)} segments")

    _log("  embedding text ...")
    seg_vecs = embed_texts([s.text for s in segs])
    n_seg = replace_segments(d.video_id, segs, seg_vecs)
    _log(f"    pushed {n_seg} segments")

    _log("  detecting scenes + extracting keyframes ...")
    frames_dir = FRAMES_DIR / d.video_id
    keyframes = extract_keyframes(d.video_path, frames_dir)
    _log(f"    {len(keyframes)} keyframes")

    _log("  embedding frames ...")
    frame_vecs = embed_images([kf.path for kf in keyframes])

    _log("  uploading frames to Blob ...")
    records: list[FrameRecord] = []
    for kf in keyframes:
        remote = f"frames/{d.video_id}/{kf.path.name}"
        url_blob = upload_file(kf.path, remote)
        records.append(FrameRecord(t_s=kf.t_s, blob_url=url_blob))

    n_fr = replace_frames(d.video_id, records, frame_vecs)
    _log(f"    pushed {n_fr} frames")

    return {"video_id": d.video_id, "segments": n_seg, "frames": n_fr}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("input", help="A YouTube URL or a file containing URLs (one per line)")
    ap.add_argument("--force", action="store_true", help="Re-ingest even if video_id already exists")
    args = ap.parse_args(argv)

    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    urls = _read_urls(args.input)
    _log(f"Ingesting {len(urls)} URL(s)")

    results: list[dict] = []
    for url in urls:
        try:
            results.append(ingest_one(url, force=args.force))
        except Exception as exc:  # noqa: BLE001
            _log(f"  ERROR on {url}: {exc!r}")
            traceback.print_exc()
            results.append({"url": url, "error": repr(exc)})

    ok = sum(1 for r in results if r.get("segments") is not None or r.get("skipped"))
    _log(f"Done — {ok}/{len(results)} succeeded or skipped")
    return 0 if ok == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
