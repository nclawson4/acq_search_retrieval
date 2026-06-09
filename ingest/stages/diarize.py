"""LLM diarization of a workshop Q&A transcript.

The corpus is consistent: an attendee asks Alex Hormozi a question at a
workshop and Alex answers. We don't need a full diarization model; one
LLM pass labels each sentence as `attendee` or `alex` reliably for this
two-speaker format.

Output is a list of Turn objects (consecutive same-speaker sentences
merged into one turn) with start/end times pulled from the word stream.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Literal

from openai import OpenAI

from config import CHAT_MODEL, OPENAI_API_KEY
from stages.transcribe import TranscriptResult, Word

Speaker = Literal["attendee", "alex"]


@dataclass
class Turn:
    speaker: Speaker
    start_s: float
    end_s: float
    text: str


@dataclass
class _Sentence:
    start_s: float
    end_s: float
    text: str


SENTENCE_END = re.compile(r"[.?!](?:\s|$)")
SYSTEM = (
    "You label sentences from a transcript of an Alex Hormozi business "
    "workshop. The format is always two speakers: an audience attendee at a "
    "microphone asks a question (often sharing their business context — "
    "industry, revenue, problem), then Alex Hormozi answers. Label each "
    'sentence with one of two values: "attendee" or "alex". When Alex '
    'briefly interjects a clarifying question, label that as "alex".\n\n'
    "INPUT: A numbered list of N sentences.\n"
    'OUTPUT: Compact JSON only: {"labels":["attendee","alex",...]}\n'
    "The labels array MUST have exactly N elements in the same order as the "
    "input. Do NOT echo the sentences. Do NOT include any other keys. Do NOT "
    "wrap in markdown."
)
SENTENCE_CHUNK = 40  # diarize this many sentences per LLM call


def _build_sentences(text: str, words: list[Word]) -> list[_Sentence]:
    """Whisper's per-word output has no punctuation; only `text` does. Split the
    punctuated text into sentences, then re-attach timestamps by walking the
    word stream and consuming N words per sentence (where N = word count in
    that sentence's text). Robust to minor token mismatch between the two.
    """
    if not text.strip() or not words:
        return []
    raw_sentences = [s.strip() for s in re.split(r"(?<=[.?!])\s+", text.strip()) if s.strip()]
    sentences: list[_Sentence] = []
    idx = 0
    for raw in raw_sentences:
        n = len(raw.split())
        if idx >= len(words) or n <= 0:
            break
        end_idx = min(len(words), idx + n)
        chunk = words[idx:end_idx]
        if not chunk:
            break
        sentences.append(_Sentence(start_s=chunk[0].start, end_s=chunk[-1].end, text=raw))
        idx = end_idx
    # If words remained (rare), attach them to the last sentence.
    if sentences and idx < len(words):
        last = sentences[-1]
        sentences[-1] = _Sentence(start_s=last.start_s, end_s=words[-1].end, text=last.text)
    return sentences


def _label_chunk(client: OpenAI, sentences: list[_Sentence]) -> list[Speaker]:
    """One LLM call labeling up to SENTENCE_CHUNK sentences."""
    if not sentences:
        return []
    numbered = "\n".join(f"{i + 1}. {s.text}" for i, s in enumerate(sentences))
    user = f"Label exactly {len(sentences)} sentences.\n\n{numbered}"
    # Conservative cap: each label is ~12 chars wire, +JSON overhead. 30 tokens/label is generous.
    resp = client.chat.completions.create(
        model=CHAT_MODEL,
        messages=[
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": user},
        ],
        response_format={"type": "json_object"},
        temperature=0.0,
        max_tokens=max(200, len(sentences) * 8 + 100),
    )
    raw = resp.choices[0].message.content or "{}"
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        # Model went off the rails — return all "alex" so this chunk produces no
        # Q→A pairs, rather than failing the whole video.
        return ["alex"] * len(sentences)
    labels = data.get("labels") or []
    out: list[Speaker] = []
    for lbl in labels[: len(sentences)]:
        s = str(lbl).strip().lower()
        out.append("attendee" if s.startswith("att") else "alex")
    # Pad if short.
    while len(out) < len(sentences):
        out.append("alex")
    return out


def _label_sentences(sentences: list[_Sentence]) -> list[Speaker]:
    """Chunked LLM calls. Smaller chunks keep the output bounded and reliable."""
    if not sentences:
        return []
    client = OpenAI(api_key=OPENAI_API_KEY)
    out: list[Speaker] = []
    for i in range(0, len(sentences), SENTENCE_CHUNK):
        chunk = sentences[i : i + SENTENCE_CHUNK]
        out.extend(_label_chunk(client, chunk))
    return out


def diarize(trans: TranscriptResult) -> list[Turn]:
    """Group word-level transcript into speaker-labeled turns."""
    sentences = _build_sentences(trans.text, trans.words)
    if not sentences:
        return []
    labels = _label_sentences(sentences)

    turns: list[Turn] = []
    cur_speaker: Speaker | None = None
    cur_start = 0.0
    cur_end = 0.0
    cur_parts: list[str] = []
    for s, lbl in zip(sentences, labels):
        if lbl == cur_speaker:
            cur_end = s.end_s
            cur_parts.append(s.text)
        else:
            if cur_speaker is not None and cur_parts:
                turns.append(
                    Turn(
                        speaker=cur_speaker,
                        start_s=cur_start,
                        end_s=cur_end,
                        text=" ".join(cur_parts),
                    )
                )
            cur_speaker = lbl
            cur_start = s.start_s
            cur_end = s.end_s
            cur_parts = [s.text]
    if cur_speaker is not None and cur_parts:
        turns.append(
            Turn(
                speaker=cur_speaker,
                start_s=cur_start,
                end_s=cur_end,
                text=" ".join(cur_parts),
            )
        )
    return turns
