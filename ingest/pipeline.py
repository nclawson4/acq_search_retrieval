"""Orchestrator: run all ingest stages for one or more YouTube URLs.

Usage:
    python -m pipeline <url-or-file>
    python -m pipeline ../urls.txt
    python -m pipeline https://www.youtube.com/watch?v=...

Idempotent: existing video_ids are skipped unless --force is passed.

Pipeline:
    1. download (yt-dlp)
    2. transcribe (Whisper, word timestamps)
    3. diarize (LLM splits transcript into attendee/alex turns)
    4. pair (group attendee→alex turns into Q->A moments)
    5. extract attendee context per question (industry, revenue, problems)
    6. audio features per moment (quality + energy peak)
    7. embed question text and answer text
    8. extract keyframes + embed (visual modality, still kept)
    9. push everything to Neon + Qdrant
"""
from __future__ import annotations

import argparse
import sys
import time
import traceback
from pathlib import Path

import numpy as np

from config import CACHE_DIR, FRAMES_DIR, MEDIA_DIR
from stages.audio_features import load_audio, moment_features, video_baseline_rms
from stages.blob import upload_file
from stages.context import extract_context
from stages.diarize import diarize
from stages.download import download
from stages.embed import embed_images, embed_texts
from stages.pair import pair_turns
from stages.push import (
    FrameRecord,
    VideoRecord,
    replace_frames,
    replace_moments,
    upsert_video,
    video_exists,
)
from stages.scenes import extract_keyframes
from stages.transcribe import transcribe


def _read_urls(arg: str) -> list[str]:
    p = Path(arg)
    if p.exists() and p.is_file():
        return [line.strip() for line in p.read_text().splitlines() if line.strip() and not line.startswith("#")]
    return [arg]


def _log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def _clip_score(answer_text: str, audio_quality: float, energy_peak: float) -> float:
    """Heuristic 0-1 score: 'how clip-worthy is this answer?'

    Components:
    - Audio quality: must-have. Low quality kills the clip regardless.
    - Energy peak: emphasis in the answer correlates with quotable moments.
    - Specificity: density of digits + dollar signs + concrete operator phrases.
    - Length sanity: heavily penalize answers too short to land or too long
      to crop into a short.
    """
    text = answer_text.lower()
    n_words = max(1, len(text.split()))

    digits = sum(c.isdigit() for c in text)
    money = text.count("$") + text.count("%")
    specifics = digits + money * 3
    specificity = float(min(1.0, specifics / 40.0))

    # Length sweet spot: ~100-400 words for a short.
    if n_words < 30:
        length = n_words / 30.0
    elif n_words <= 500:
        length = 1.0
    else:
        length = max(0.2, 500.0 / n_words)

    return float(
        0.35 * audio_quality
        + 0.20 * energy_peak
        + 0.25 * specificity
        + 0.20 * length
    )


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

    _log("  transcribing + diarizing (Deepgram nova-3) ...")
    trans = transcribe(d.audio_path)
    n_speakers = len({w.speaker for w in trans.words}) if trans.words else 0
    _log(f"    {len(trans.words)} words across {n_speakers} speaker cluster(s)")

    _log("  resolving Alex speaker (voice fingerprint or LLM fallback) ...")
    turns = diarize(trans, d.audio_path)
    n_alex = sum(1 for t in turns if t.speaker == "alex")
    n_att = sum(1 for t in turns if t.speaker == "attendee")
    _log(f"    {len(turns)} turns ({n_alex} alex / {n_att} attendee)")

    moments = pair_turns(turns)
    _log(f"    {len(moments)} Q->A moments")

    if not moments:
        _log("  no Q->A moments found — skipping moment embed/push")
    else:
        _log("  extracting attendee context per question ...")
        contexts = [extract_context(m.q_text) for m in moments]

        _log("  loading audio for per-moment features ...")
        y, sr = load_audio(d.audio_path)
        baseline = video_baseline_rms(y, sr)
        audios = [
            moment_features(y, sr, baseline, m.q_start_s, m.q_end_s, m.a_start_s, m.a_end_s)
            for m in moments
        ]

        clip_scores = [
            _clip_score(m.a_text, au.audio_quality, au.energy_peak)
            for m, au in zip(moments, audios)
        ]

        _log("  embedding answers + questions ...")
        a_vecs = embed_texts([m.a_text for m in moments])
        q_vecs = embed_texts([m.q_text for m in moments])

        n_mom = replace_moments(
            d.video_id, moments, contexts, audios, clip_scores, a_vecs, q_vecs
        )
        _log(f"    pushed {n_mom} moments")

    _log("  detecting scenes + extracting keyframes ...")
    frames_dir = FRAMES_DIR / d.video_id
    keyframes = extract_keyframes(d.video_path, frames_dir)
    _log(f"    {len(keyframes)} keyframes")

    if keyframes:
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
    else:
        n_fr = 0

    return {
        "video_id": d.video_id,
        "moments": len(moments),
        "frames": n_fr,
    }


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

    ok = sum(1 for r in results if r.get("moments") is not None or r.get("skipped"))
    _log(f"Done — {ok}/{len(results)} succeeded or skipped")
    return 0 if ok == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
