"""Group diarized turns into Q→A moments.

A moment = one attendee turn (the question, with their business context)
immediately followed by one alex turn (the answer). When Alex briefly
interjects mid-question and the attendee resumes, we extend the question
turn through the resumption. When Alex's answer is broken by a short
follow-up question from the attendee and Alex resumes, we extend the
answer turn similarly. Anything before the first attendee turn or after
the last alex turn is ignored.
"""
from __future__ import annotations

from dataclasses import dataclass

from stages.diarize import Turn

MAX_INTERJECTION_S = 6.0  # short interjections within a turn don't break it


@dataclass
class Moment:
    q_start_s: float
    q_end_s: float
    q_text: str
    a_start_s: float
    a_end_s: float
    a_text: str


def _merge_short_interjections(turns: list[Turn]) -> list[Turn]:
    """Drop any same-speaker turn separated by a very short opposite turn."""
    if not turns:
        return []
    out: list[Turn] = [turns[0]]
    i = 1
    while i < len(turns):
        prev = out[-1]
        cur = turns[i]
        nxt = turns[i + 1] if i + 1 < len(turns) else None
        if (
            nxt is not None
            and cur.speaker != prev.speaker
            and nxt.speaker == prev.speaker
            and (cur.end_s - cur.start_s) <= MAX_INTERJECTION_S
        ):
            # Merge prev + nxt; drop cur.
            out[-1] = Turn(
                speaker=prev.speaker,
                start_s=prev.start_s,
                end_s=nxt.end_s,
                text=f"{prev.text} {nxt.text}".strip(),
            )
            i += 2
        else:
            out.append(cur)
            i += 1
    return out


def pair_turns(turns: list[Turn]) -> list[Moment]:
    """Walk speaker-labeled turns and emit one Moment per attendee→alex pair."""
    merged = _merge_short_interjections(turns)
    moments: list[Moment] = []
    i = 0
    while i < len(merged) - 1:
        cur = merged[i]
        nxt = merged[i + 1]
        if cur.speaker == "attendee" and nxt.speaker == "alex":
            moments.append(
                Moment(
                    q_start_s=cur.start_s,
                    q_end_s=cur.end_s,
                    q_text=cur.text.strip(),
                    a_start_s=nxt.start_s,
                    a_end_s=nxt.end_s,
                    a_text=nxt.text.strip(),
                )
            )
            i += 2
        else:
            i += 1
    return moments
