"""Transcription stage: OpenAI Whisper with word timestamps.

Whisper API has a 25 MB upload limit. For longer audio, we split into
~20-minute chunks with no overlap and stitch the word lists back together
by applying a time offset per chunk.
"""
from __future__ import annotations

import math
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from openai import OpenAI

from config import OPENAI_API_KEY

MAX_BYTES = 24 * 1024 * 1024  # leave headroom under Whisper's 25 MB limit
CHUNK_SECONDS = 20 * 60


@dataclass
class Word:
    word: str
    start: float
    end: float


@dataclass
class TranscriptResult:
    text: str
    words: list[Word]


def _ffprobe_duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    return float(out)


def _slice_audio(src: Path, start_s: float, end_s: float, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    duration = end_s - start_s
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-ss", f"{start_s:.3f}", "-i", str(src), "-t", f"{duration:.3f}",
            "-acodec", "copy", str(dst),
        ],
        check=True,
    )


def _transcribe_single(client: OpenAI, path: Path, offset_s: float) -> tuple[str, list[Word]]:
    with path.open("rb") as f:
        resp = client.audio.transcriptions.create(
            model="whisper-1",
            file=f,
            response_format="verbose_json",
            timestamp_granularities=["word"],
        )
    text = resp.text or ""
    words: list[Word] = []
    for w in (resp.words or []):
        # Pydantic model: w.word, w.start, w.end
        words.append(Word(word=w.word, start=float(w.start) + offset_s, end=float(w.end) + offset_s))
    return text, words


def transcribe(audio_path: Path) -> TranscriptResult:
    client = OpenAI(api_key=OPENAI_API_KEY)
    size = audio_path.stat().st_size

    if size <= MAX_BYTES:
        text, words = _transcribe_single(client, audio_path, offset_s=0.0)
        return TranscriptResult(text=text, words=words)

    duration = _ffprobe_duration(audio_path)
    n_chunks = math.ceil(duration / CHUNK_SECONDS)

    full_text_parts: list[str] = []
    all_words: list[Word] = []
    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)
        for i in range(n_chunks):
            start_s = i * CHUNK_SECONDS
            end_s = min(duration, (i + 1) * CHUNK_SECONDS)
            chunk_path = td_path / f"chunk_{i:03d}.mp3"
            _slice_audio(audio_path, start_s, end_s, chunk_path)
            text, words = _transcribe_single(client, chunk_path, offset_s=start_s)
            full_text_parts.append(text)
            all_words.extend(words)

    return TranscriptResult(text=" ".join(full_text_parts), words=all_words)
