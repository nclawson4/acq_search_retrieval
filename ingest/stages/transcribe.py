"""Transcription + diarization stage: Deepgram nova-3.

One REST call gives us both word-level timestamps and a per-word speaker
cluster id. Deepgram pre-recorded accepts files up to 2 GB, so we don't
need to chunk like we did under Whisper.

The speaker ids here are anonymous integers (0, 1, ...). The downstream
`diarize` stage is responsible for resolving which integer is Alex.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import httpx

from config import DEEPGRAM_API_KEY

DEEPGRAM_URL = "https://api.deepgram.com/v1/listen"
DEEPGRAM_PARAMS = {
    "model": "nova-3",
    "smart_format": "true",
    "punctuate": "true",
    "diarize": "true",
    "language": "en",
    "filler_words": "false",
}
# Deepgram pre-recorded responses can take a few minutes for long audio.
REQUEST_TIMEOUT_S = 600.0


@dataclass
class Word:
    word: str
    start: float
    end: float
    speaker: int  # raw Deepgram cluster id


@dataclass
class TranscriptResult:
    text: str
    words: list[Word]


def _content_type(path: Path) -> str:
    ext = path.suffix.lower().lstrip(".")
    return {
        "mp3": "audio/mpeg",
        "m4a": "audio/mp4",
        "mp4": "audio/mp4",
        "wav": "audio/wav",
        "ogg": "audio/ogg",
        "opus": "audio/ogg",
        "webm": "audio/webm",
        "flac": "audio/flac",
    }.get(ext, "application/octet-stream")


def _call_deepgram(audio_path: Path) -> dict:
    headers = {
        "Authorization": f"Token {DEEPGRAM_API_KEY}",
        "Content-Type": _content_type(audio_path),
    }
    with audio_path.open("rb") as f:
        resp = httpx.post(
            DEEPGRAM_URL,
            params=DEEPGRAM_PARAMS,
            headers=headers,
            content=f.read(),
            timeout=REQUEST_TIMEOUT_S,
        )
    if resp.status_code != 200:
        raise RuntimeError(
            f"Deepgram returned {resp.status_code}: {resp.text[:500]}"
        )
    return resp.json()


def transcribe(audio_path: Path) -> TranscriptResult:
    """Transcribe + diarize a single audio file via Deepgram."""
    if not audio_path.exists():
        raise FileNotFoundError(audio_path)
    data = _call_deepgram(audio_path)
    try:
        alt = data["results"]["channels"][0]["alternatives"][0]
    except (KeyError, IndexError) as e:
        raise RuntimeError(f"unexpected Deepgram response shape: {e}") from e

    raw_words = alt.get("words") or []
    text = alt.get("transcript") or ""

    words: list[Word] = []
    for w in raw_words:
        # `punctuated_word` preserves capitalization/punctuation when smart_format
        # is on. Fall back to `word` if missing.
        token = w.get("punctuated_word") or w.get("word") or ""
        if not token:
            continue
        speaker = w.get("speaker")
        words.append(
            Word(
                word=token,
                start=float(w["start"]),
                end=float(w["end"]),
                speaker=int(speaker) if speaker is not None else 0,
            )
        )

    return TranscriptResult(text=text, words=words)


def dump_raw_response(audio_path: Path, out_path: Path) -> None:
    """Debug helper: write the raw Deepgram JSON next to the audio."""
    data = _call_deepgram(audio_path)
    out_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
