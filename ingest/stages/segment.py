"""Window word-level transcripts into search segments.

Targets ~30 s windows with 5 s overlap, snapped to nearest sentence boundary
(. ? !) within ±5 s of the target end. Returns text + start/end seconds.
"""
from __future__ import annotations

from dataclasses import dataclass

from stages.transcribe import Word

WINDOW_S = 30.0
OVERLAP_S = 5.0
BOUNDARY_TOLERANCE_S = 5.0
SENTENCE_END_CHARS = ".?!"


@dataclass
class Segment:
    start_s: float
    end_s: float
    text: str


def _is_sentence_end(token: str) -> bool:
    if not token:
        return False
    last_char = token.strip()[-1:] if token.strip() else ""
    return last_char in SENTENCE_END_CHARS


def segment_words(words: list[Word]) -> list[Segment]:
    if not words:
        return []

    segments: list[Segment] = []
    i = 0
    n = len(words)
    while i < n:
        start = words[i].start
        target_end = start + WINDOW_S

        # Find the index range whose words fall within target_end + tolerance.
        j = i
        while j < n and words[j].end <= target_end + BOUNDARY_TOLERANCE_S:
            j += 1
        # j is one past the last candidate. Walk backwards from j-1 looking for a sentence end
        # within [target_end - tol, target_end + tol]. Fall back to nearest word to target_end.
        end_idx = min(j - 1, n - 1)
        best_idx = None
        for k in range(end_idx, i - 1, -1):
            if _is_sentence_end(words[k].word) and abs(words[k].end - target_end) <= BOUNDARY_TOLERANCE_S:
                best_idx = k
                break
        if best_idx is None:
            best_idx = end_idx

        chunk = words[i : best_idx + 1]
        if not chunk:
            i = best_idx + 1
            continue

        text = " ".join(w.word.strip() for w in chunk if w.word.strip())
        segments.append(Segment(start_s=chunk[0].start, end_s=chunk[-1].end, text=text))

        # Step to next start: end - OVERLAP_S, then find the first word at or after that time.
        next_start_time = chunk[-1].end - OVERLAP_S
        next_i = best_idx + 1
        for k in range(best_idx, n):
            if words[k].start >= next_start_time:
                next_i = k
                break
        if next_i <= i:  # safety: always advance
            next_i = best_idx + 1
        i = next_i

    return segments
