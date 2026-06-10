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
# Calibrated against workshop audio: same-speaker clusters score ~0.70–0.90,
# different speakers ~0.45–0.65, so 0.60 is a conservative separator.
VOICE_MATCH_FLOOR = 0.60
# How far below the top-scoring cluster we still accept as "also Alex".
# Deepgram routinely splits Alex into 2-3 clusters when his mic level shifts
# (pacing the stage, raised voice on a punchline). A 0.15 band absorbs that
# spread without folding in a similar-voiced attendee.
VOICE_MATCH_MARGIN = 0.15


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
) -> set[int] | None:
    """Return every speaker_id whose voice matches the reference clip.

    Deepgram frequently splits a single speaker across multiple clusters when
    levels or mic position shifts (Alex pacing the stage, etc). Picking only
    the single best match collapses Alex to a sliver of his real turns, so
    we accept any cluster within a small margin of the top similarity that
    also exceeds VOICE_MATCH_FLOOR. None signals "inconclusive — fall back".
    """
    try:
        from resemblyzer import VoiceEncoder, preprocess_wav
    except ImportError:
        return None

    audio, sr = _load_audio_mono(audio_path)
    encoder = VoiceEncoder(verbose=False)

    ref_wav = preprocess_wav(ref_path)
    ref_emb = encoder.embed_utterance(ref_wav)

    speaker_ids = sorted({t.speaker_id for t in raw_turns})
    sims: dict[int, float] = {}
    durations: dict[int, float] = {}
    for sid in speaker_ids:
        clip = _cluster_audio(audio, sr, raw_turns, sid)
        dur = float(clip.size) / float(sr)
        durations[sid] = dur
        if dur < MIN_CLUSTER_AUDIO_S:
            continue
        wav = preprocess_wav(clip, source_sr=sr)
        emb = encoder.embed_utterance(wav)
        sim = float(np.dot(ref_emb, emb) / (np.linalg.norm(ref_emb) * np.linalg.norm(emb) + 1e-9))
        sims[sid] = sim

    if sims:
        score_lines = ", ".join(
            f"sid={sid} dur={durations.get(sid, 0):.1f}s sim={sim:.3f}"
            for sid, sim in sorted(sims.items())
        )
        print(f"    voice-fingerprint scores: {score_lines}", flush=True)

    if not sims:
        return None
    best_sim = max(sims.values())
    if best_sim < VOICE_MATCH_FLOOR:
        return None
    threshold = max(VOICE_MATCH_FLOOR, best_sim - VOICE_MATCH_MARGIN)
    return {sid for sid, s in sims.items() if s >= threshold}


def _resolve_alex_via_llm(raw_turns: list[_RawTurn]) -> set[int] | None:
    """Fallback: feed the first few hundred chars of each cluster's text to
    a small LLM and ask which one is Alex Hormozi."""
    speaker_ids = sorted({t.speaker_id for t in raw_turns})
    if len(speaker_ids) < 2:
        return {speaker_ids[0]} if speaker_ids else None

    samples: dict[int, str] = {}
    for sid in speaker_ids:
        joined = " ".join(t.text for t in raw_turns if t.speaker_id == sid)
        samples[sid] = joined[:1200]

    system = (
        "You are looking at an Alex Hormozi workshop transcript already "
        "split by speaker cluster. Identify EVERY cluster that is Alex — "
        "diarization may split him across multiple clusters when mic "
        "position changes. Alex asks diagnostic questions ('what's stopping "
        "you?', 'how much are you doing?'), gives direct advice using "
        "business frameworks, and references his own companies. Attendees "
        "describe their business: industry, revenue, problem.\n\n"
        'Output JSON only: {"alex_speaker_ids": [<int>, ...]}'
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
            max_tokens=80,
        )
        data = json.loads(resp.choices[0].message.content or "{}")
        sids_raw = data.get("alex_speaker_ids") or []
        sids = {s for s in sids_raw if isinstance(s, int) and s in speaker_ids}
        return sids or None
    except Exception:
        return None


def _resolve_alex(raw_turns: list[_RawTurn], audio_path: Path) -> set[int]:
    """Decide which speaker_ids belong to Alex. Empty set means undecidable."""
    speaker_ids = sorted({t.speaker_id for t in raw_turns})
    if len(speaker_ids) == 0:
        return set()
    if len(speaker_ids) == 1:
        # Single cluster — voice match would be circular, just call it Alex.
        return {speaker_ids[0]}

    if ALEX_REFERENCE_AUDIO:
        ref = Path(ALEX_REFERENCE_AUDIO)
        if ref.exists():
            voice = _resolve_alex_via_voice(raw_turns, audio_path, ref)
            if voice:
                return voice
    return _resolve_alex_via_llm(raw_turns) or set()


def diarize(trans: TranscriptResult, audio_path: Path) -> list[Turn]:
    """Group word-level transcript into speaker-labeled turns."""
    if not trans.words:
        return []
    raw_turns = _group_words(trans.words)
    if not raw_turns:
        return []

    alex_ids = _resolve_alex(raw_turns, audio_path)
    print(f"    alex cluster ids: {sorted(alex_ids) or '(none — defaulting all to attendee)'}", flush=True)
    out: list[Turn] = []
    for t in raw_turns:
        speaker: Speaker = "alex" if t.speaker_id in alex_ids else "attendee"
        out.append(
            Turn(
                speaker=speaker,
                start_s=t.start_s,
                end_s=t.end_s,
                text=t.text,
            )
        )
    return out
