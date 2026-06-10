"""Map Deepgram speaker clusters onto attendee / alex roles.

Deepgram tags each word with an anonymous speaker integer. We:
  1. Collapse consecutive same-speaker words into raw turns.
  2. Decide which integer is Alex by comparing each cluster's audio
     against a reference clip of Alex (Resemblyzer voice embedding).
     If no reference clip is configured we fall back to a single LLM
     call that reads each cluster's concatenated text.
  3. Emit Turn objects keyed by `attendee` / `alex` (every non-Alex
     speaker becomes `attendee` — works for the workshop Q&A format
     even when several different attendees ask questions in one video).

The downstream `pair` stage consumes the resulting Turn list unchanged.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import librosa
import numpy as np
from openai import OpenAI

from config import ALEX_REFERENCE_AUDIO, CHAT_MODEL, OPENAI_API_KEY
from stages.transcribe import TranscriptResult, Word

Speaker = Literal["attendee", "alex"]

# Resemblyzer wants 16 kHz mono. Our pipeline already downloads audio at 16 kHz mono.
TARGET_SR = 16_000
# A cluster needs at least this much voiced audio to get a reliable embedding.
MIN_CLUSTER_AUDIO_S = 5.0
# Cosine-similarity floor for the "this cluster is Alex" decision. Below this
# we treat the voice match as inconclusive and fall back to the LLM heuristic.
VOICE_MATCH_FLOOR = 0.55


@dataclass
class Turn:
    speaker: Speaker
    start_s: float
    end_s: float
    text: str


@dataclass
class _RawTurn:
    speaker_id: int
    start_s: float
    end_s: float
    words: list[Word]

    @property
    def text(self) -> str:
        return _stitch(self.words)

    @property
    def duration_s(self) -> float:
        return max(0.0, self.end_s - self.start_s)


def _stitch(words: list[Word]) -> str:
    """Join punctuated word tokens with spaces, but don't pad before
    closing punctuation that Deepgram smart-formatted onto the word itself."""
    parts: list[str] = []
    for w in words:
        if not w.word:
            continue
        if parts and re.match(r"^[.,!?;:%')\]}]", w.word):
            parts[-1] = parts[-1] + w.word
        else:
            parts.append(w.word)
    return " ".join(parts).strip()


def _group_words(words: list[Word]) -> list[_RawTurn]:
    turns: list[_RawTurn] = []
    cur: _RawTurn | None = None
    for w in words:
        if cur is None or w.speaker != cur.speaker_id:
            if cur is not None:
                turns.append(cur)
            cur = _RawTurn(speaker_id=w.speaker, start_s=w.start, end_s=w.end, words=[w])
        else:
            cur.end_s = w.end
            cur.words.append(w)
    if cur is not None:
        turns.append(cur)
    return turns


def _load_audio_mono(path: Path) -> tuple[np.ndarray, int]:
    audio, sr = librosa.load(path, sr=TARGET_SR, mono=True)
    return audio.astype(np.float32), sr


def _cluster_audio(audio: np.ndarray, sr: int, turns: list[_RawTurn], speaker_id: int) -> np.ndarray:
    chunks: list[np.ndarray] = []
    total_s = 0.0
    for t in turns:
        if t.speaker_id != speaker_id:
            continue
        i0 = max(0, int(t.start_s * sr))
        i1 = min(len(audio), int(t.end_s * sr))
        if i1 <= i0:
            continue
        chunks.append(audio[i0:i1])
        total_s += (i1 - i0) / sr
        if total_s >= 60.0:
            # Plenty of speech for a stable embedding; stop accumulating.
            break
    if not chunks:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(chunks)


def _resolve_alex_via_voice(
    raw_turns: list[_RawTurn], audio_path: Path, ref_path: Path
) -> int | None:
    """Return the speaker_id whose voice best matches the reference clip,
    or None if Resemblyzer can't decide (inconclusive similarity or missing
    audio for every cluster)."""
    try:
        from resemblyzer import VoiceEncoder, preprocess_wav
    except ImportError:
        return None

    audio, sr = _load_audio_mono(audio_path)
    encoder = VoiceEncoder(verbose=False)

    ref_wav = preprocess_wav(ref_path)
    ref_emb = encoder.embed_utterance(ref_wav)

    speaker_ids = sorted({t.speaker_id for t in raw_turns})
    best_id: int | None = None
    best_sim = -1.0
    for sid in speaker_ids:
        clip = _cluster_audio(audio, sr, raw_turns, sid)
        if clip.size / sr < MIN_CLUSTER_AUDIO_S:
            continue
        wav = preprocess_wav(clip, source_sr=sr)
        emb = encoder.embed_utterance(wav)
        sim = float(np.dot(ref_emb, emb) / (np.linalg.norm(ref_emb) * np.linalg.norm(emb) + 1e-9))
        if sim > best_sim:
            best_sim = sim
            best_id = sid
    if best_id is None or best_sim < VOICE_MATCH_FLOOR:
        return None
    return best_id


def _resolve_alex_via_llm(raw_turns: list[_RawTurn]) -> int | None:
    """Fallback: feed the first few hundred chars of each cluster's text to
    a small LLM and ask which one is Alex Hormozi."""
    speaker_ids = sorted({t.speaker_id for t in raw_turns})
    if len(speaker_ids) < 2:
        return speaker_ids[0] if speaker_ids else None

    samples: dict[int, str] = {}
    for sid in speaker_ids:
        joined = " ".join(t.text for t in raw_turns if t.speaker_id == sid)
        samples[sid] = joined[:1200]

    system = (
        "You are looking at an Alex Hormozi workshop transcript already "
        "split by speaker cluster. Identify which cluster is Alex. "
        "Alex tends to ask diagnostic questions ('what's stopping you?', "
        "'how much are you doing?'), give direct advice using business "
        "frameworks, and reference his own companies. Attendees describe "
        "their business: industry, revenue, problem.\n\n"
        'Output JSON only: {"alex_speaker_id": <int>}'
    )
    user_lines = [f"speaker {sid}:\n{txt}\n" for sid, txt in samples.items()]
    user = "\n".join(user_lines)
    try:
        client = OpenAI(api_key=OPENAI_API_KEY)
        resp = client.chat.completions.create(
            model=CHAT_MODEL,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            response_format={"type": "json_object"},
            temperature=0.0,
            max_tokens=40,
        )
        data = json.loads(resp.choices[0].message.content or "{}")
        sid = data.get("alex_speaker_id")
        if isinstance(sid, int) and sid in speaker_ids:
            return sid
    except Exception:
        return None
    return None


def _resolve_alex(raw_turns: list[_RawTurn], audio_path: Path) -> int | None:
    """Decide which speaker_id is Alex. Returns None if undecidable."""
    speaker_ids = sorted({t.speaker_id for t in raw_turns})
    if len(speaker_ids) == 0:
        return None
    if len(speaker_ids) == 1:
        # Single cluster — voice match would be circular, just call it Alex.
        return speaker_ids[0]

    if ALEX_REFERENCE_AUDIO:
        ref = Path(ALEX_REFERENCE_AUDIO)
        if ref.exists():
            voice_id = _resolve_alex_via_voice(raw_turns, audio_path, ref)
            if voice_id is not None:
                return voice_id
    return _resolve_alex_via_llm(raw_turns)


def diarize(trans: TranscriptResult, audio_path: Path) -> list[Turn]:
    """Group word-level transcript into speaker-labeled turns."""
    if not trans.words:
        return []
    raw_turns = _group_words(trans.words)
    if not raw_turns:
        return []

    alex_id = _resolve_alex(raw_turns, audio_path)
    out: list[Turn] = []
    for t in raw_turns:
        speaker: Speaker = "alex" if t.speaker_id == alex_id else "attendee"
        out.append(
            Turn(
                speaker=speaker,
                start_s=t.start_s,
                end_s=t.end_s,
                text=t.text,
            )
        )
    return out
