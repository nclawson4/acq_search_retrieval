"""Segment a video into attendee sessions.

A session = one contiguous block where a single attendee (Deepgram speaker
cluster) is on camera with Alex. The block spans from the attendee's first
moment of involvement through Alex's last response to them, ending at the
next attendee's first word or the CTA boilerplate, whichever comes first.

Rules:
  * Shorts (1 attendee cluster):  start = 0.0, end = CTA-start OR video end.
  * Long videos (>=2 attendees):  start = previous attendee's end OR 0.0 for
                                  the first; end = next attendee's first word
                                  OR CTA-start (whichever earlier).
  * Both: snap boundaries to nearest sentence terminator within ±2s using
    Deepgram punctuated words.

The downstream LLM tagger reads the full attendee+alex text inside the
session, so boundary accuracy only has to be tight enough that the played
clip starts and ends on the right speaker / sentence.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from boundary_overrides import BOUNDARY_OVERRIDES, has_override
from stages.diarize import _group_words, _resolve_alex, _stitch
from stages.transcribe import Word, cached_response

# Phrases that mark the START of an Alex CTA segment. Specific enough that they
# only appear inside a CTA, not mid-content. Normalized to lowercase + straight
# quotes. Order doesn't matter; we take the earliest in-window match.
CTA_PHRASES: tuple[str, ...] = (
    # "free gift" outro on shorts
    "if you're a business owner and you are not growing",
    "if you're a business owner and you're not growing",
    "if you were a business owner and you were not growing",
    "growing as fast as you'd like",
    "growing as fast as you would like",
    "scaling roadmap",
    "100 million scaling",
    "100,000,000 scaling",
    # "Vegas invite" outro (long videos / workshops)
    "if you're a business owner, i'd like to invite you",
    "i'd like to invite you out to",
    "invite you out to vegas",
    "invite you out to come to our headquarters",
    "we'll invite you out to vegas",
    "we will invite you out to vegas",
    "in person live",
)

_CURLY_MAP = str.maketrans({
    "\u2019": "'", "\u2018": "'",
    "\u201c": '"', "\u201d": '"',
})


def _normalize(text: str) -> str:
    """Lowercase + straight quotes. Preserves apostrophes inside words."""
    return text.lower().translate(_CURLY_MAP)


def _normalize_for_match(text: str) -> str:
    """Lowercase, straight quotes, strip trailing punctuation. For CTA matching
    where Deepgram smart_format glues commas/periods onto words."""
    n = _normalize(text)
    return n.rstrip(".,!?;:")

# How far we'll snap a boundary to land on a sentence terminator.
SNAP_WINDOW_S = 2.0

SENTENCE_END_RE = re.compile(r"[.!?](['\")\]]*)$")


@dataclass
class Session:
    video_id: str
    start_s: float
    end_s: float
    attendee_cluster_id: int | None
    full_text: str           # all turns (attendee + alex) inside the session
    play_start_s: float = 0.0  # YouTube ?t= target (start_s minus preroll)


# How many seconds before the attendee's first word the YouTube URL should
# target, to give YouTube's keyframe seek room to land before they speak.
PLAY_PREROLL_S = 1.0


def _is_sentence_end(token: str) -> bool:
    return bool(SENTENCE_END_RE.search(token))


def _snap_start_forward(words: list[Word], target_s: float, max_delta_s: float) -> float:
    """Move forward to the first word AFTER a sentence terminator near target_s.

    Prevents 'starts mid-thought'. If no terminator is found within the window,
    return target_s unchanged.
    """
    candidates = [w for w in words if target_s <= w.start <= target_s + max_delta_s]
    for i, w in enumerate(candidates):
        if i == 0:
            continue
        if _is_sentence_end(candidates[i - 1].word):
            return float(w.start)
    return target_s


def _snap_end_backward(words: list[Word], target_s: float, max_delta_s: float) -> float:
    """Move backward to the end of the last completed sentence near target_s.

    Prevents 'ends mid-thought'. If no terminator is found, return target_s.
    """
    candidates = [w for w in words if target_s - max_delta_s <= w.end <= target_s]
    for w in reversed(candidates):
        if _is_sentence_end(w.word):
            return float(w.end)
    return target_s


def _words_from_response(data: dict) -> list[Word]:
    try:
        alt = data["results"]["channels"][0]["alternatives"][0]
    except (KeyError, IndexError):
        return []
    raw = alt.get("words") or []
    out: list[Word] = []
    for w in raw:
        token = w.get("punctuated_word") or w.get("word") or ""
        if not token:
            continue
        speaker = w.get("speaker")
        out.append(
            Word(
                word=token,
                start=float(w["start"]),
                end=float(w["end"]),
                speaker=int(speaker) if speaker is not None else 0,
            )
        )
    return out


def _find_cta_start_s(alex_words: list[Word], after_s: float = 0.0) -> float | None:
    """Find the earliest CTA phrase in Alex's words at or after `after_s`.

    Returns the start_s of the FIRST word in the matched span. Use per-session
    by passing the attendee's last word time as `after_s` — that way each
    long-video session can cut its own mini-CTA before the next attendee.
    """
    filtered = [w for w in alex_words if w.start >= after_s]
    if not filtered:
        return None
    parts: list[str] = []
    offsets: list[int] = []
    cursor = 0
    for w in filtered:
        norm = _normalize_for_match(w.word)
        offsets.append(cursor)
        parts.append(norm)
        cursor += len(norm) + 1
    joined = " ".join(parts)

    earliest_char: int | None = None
    for phrase in CTA_PHRASES:
        idx = joined.find(phrase)
        if idx >= 0 and (earliest_char is None or idx < earliest_char):
            earliest_char = idx
    if earliest_char is None:
        return None
    word_idx = 0
    for i, off in enumerate(offsets):
        if off > earliest_char:
            break
        word_idx = i
    return float(filtered[word_idx].start)


def _alex_ids_with_fallback(words: list[Word], audio_path: Path) -> set[int]:
    """Resolve which clusters are Alex, with a safeguard against the diarizer
    tagging every cluster as Alex (happens on shorts where the attendee's
    voice timber is close to Alex's). When that happens we keep only the
    cluster with the most total speaking time — Alex always speaks more than
    any single attendee inside an Alex Hormozi Q&A clip.
    """
    raw_turns = _group_words(words)
    if not raw_turns:
        return set()
    all_clusters = {t.speaker_id for t in raw_turns}
    alex_ids = _resolve_alex(raw_turns, audio_path) or set()
    if alex_ids and alex_ids >= all_clusters and len(all_clusters) >= 2:
        # Diarizer over-included. Demote everyone except the highest-volume cluster.
        duration_by_cluster: dict[int, float] = {}
        for w in words:
            duration_by_cluster[w.speaker] = duration_by_cluster.get(w.speaker, 0.0) + (w.end - w.start)
        biggest = max(duration_by_cluster, key=duration_by_cluster.get)
        alex_ids = {biggest}
    return alex_ids


def _merge_neighbor_same_cluster(
    blocks: list[tuple[int, float, float]],
    max_gap_s: float = 10.0,
) -> list[tuple[int, float, float]]:
    """Merge adjacent blocks of the same cluster separated by < max_gap_s.
    Deepgram occasionally splits a single attendee's stretch into two blocks
    when a brief same-cluster mis-tag interrupts.
    """
    if not blocks:
        return []
    out: list[tuple[int, float, float]] = [blocks[0]]
    for cid, s, e in blocks[1:]:
        pcid, ps, pe = out[-1]
        if cid == pcid and s - pe <= max_gap_s:
            out[-1] = (pcid, ps, e)
        else:
            out.append((cid, s, e))
    return out


def _sessions_from_overrides(
    video_id: str,
    words: list[Word],
    alex_words: list[Word],
    video_duration_s: float,
) -> list[Session]:
    """Build sessions directly from manually-verified attendee start timestamps.

    Used for the 4 long workshop videos where automatic diarization is
    unreliable. The cluster_id is replaced with a synthetic index (0, 1, 2…)
    so the per-video same-cluster collapse never merges distinct attendees.
    """
    starts = [s for s, _ in BOUNDARY_OVERRIDES[video_id]]
    sessions: list[Session] = []
    for i, start_s in enumerate(starts):
        # End boundary: next attendee's start, or for the last attendee, the
        # outro CTA (or the end of the video if no CTA found in their tail).
        if i + 1 < len(starts):
            raw_end_s = float(starts[i + 1])
        else:
            cta = _find_cta_start_s(alex_words, after_s=float(start_s))
            raw_end_s = float(cta) if cta is not None else float(video_duration_s)

        # Snap to natural punctuation so the clip doesn't end mid-thought.
        snapped_start = _snap_start_forward(words, float(start_s), SNAP_WINDOW_S)
        snapped_end = _snap_end_backward(words, raw_end_s, SNAP_WINDOW_S)
        if snapped_end - snapped_start < 30.0:
            continue

        text_tokens = [w for w in words if w.start >= snapped_start and w.end <= snapped_end]
        full_text = _stitch(text_tokens)
        if not full_text:
            continue

        play_start_s = max(0.0, snapped_start - PLAY_PREROLL_S)
        sessions.append(
            Session(
                video_id=video_id,
                start_s=float(snapped_start),
                end_s=float(snapped_end),
                attendee_cluster_id=i,
                full_text=full_text,
                play_start_s=float(play_start_s),
            )
        )
    return sessions


def segment_sessions(video_id: str, audio_path: Path, video_duration_s: float) -> list[Session]:
    """Produce the list of attendee sessions for one video.

    Reads cached Deepgram response; raises if cache is missing. Caller is
    responsible for ensuring the audio has been transcribed.

    Long workshop videos with hand-verified boundaries skip the automatic
    diarization pipeline and use the override list instead.
    """
    data = cached_response(audio_path)
    if data is None:
        raise FileNotFoundError(f"Deepgram cache missing for {audio_path.name}")
    words = _words_from_response(data)
    if not words:
        return []

    if has_override(video_id):
        alex_ids = _alex_ids_with_fallback(words, audio_path)
        alex_words = [w for w in words if w.speaker in alex_ids]
        return _sessions_from_overrides(video_id, words, alex_words, video_duration_s)

    alex_ids = _alex_ids_with_fallback(words, audio_path)
    attendee_word_clusters = {w.speaker for w in words if w.speaker not in alex_ids}

    # Find each attendee cluster's first-word and last-word timestamps so we can
    # walk session-by-session in chronological order.
    if not attendee_word_clusters:
        return []

    alex_words = [w for w in words if w.speaker in alex_ids]

    # Identify "attendee blocks" by walking words. A block ends when we see an
    # attendee word from a different cluster than the current block's cluster.
    # We track the attendee's last word separately from Alex's last word so the
    # downstream CTA cut can search Alex turns AFTER the attendee stops.
    Block = tuple[int, float, float, float]  # (cluster, attendee_first, attendee_last, alex_extend_last)
    blocks: list[Block] = []
    current_cluster: int | None = None
    block_start: float = 0.0
    attendee_last: float = 0.0
    alex_extend_last: float = 0.0
    for w in words:
        if w.speaker in alex_ids:
            if current_cluster is not None:
                alex_extend_last = w.end
            continue
        if current_cluster is None:
            current_cluster = w.speaker
            block_start = w.start
            attendee_last = w.end
            alex_extend_last = w.end
        elif w.speaker != current_cluster:
            blocks.append((current_cluster, block_start, attendee_last, alex_extend_last))
            current_cluster = w.speaker
            block_start = w.start
            attendee_last = w.end
            alex_extend_last = w.end
        else:
            attendee_last = w.end
            alex_extend_last = w.end
    if current_cluster is not None:
        blocks.append((current_cluster, block_start, attendee_last, alex_extend_last))

    # Pass 1: merge adjacent same-cluster blocks separated by ≤ 10s.
    merged: list[Block] = []
    for b in blocks:
        if merged and merged[-1][0] == b[0] and b[1] - merged[-1][3] <= 10.0:
            cid, s, _, _ = merged[-1]
            merged[-1] = (cid, s, b[2], b[3])
        else:
            merged.append(b)
    blocks = merged

    # Pass 2: resolve same-cluster sandwiches.
    #
    # Two patterns can show up at the start of a new attendee turn:
    #
    #   3-block [A][B][A]: a short different-cluster block sandwiched between
    #     two same-cluster blocks. Almost always a Deepgram mistag of a single
    #     attendee's word into another cluster. Absorb B if it's < 60s.
    #
    #   4-block [A][B][A][B]: alternating clusters at a real cluster transition.
    #     The new attendee starts (B), Deepgram briefly emits a stray same-as-A
    #     word (a 1-2s "No. Okay." reaction), then the new attendee continues
    #     (B). The OLD code saw [A][B][A] first and absorbed B into A — losing
    #     the first 10-30 seconds of the new attendee's session.
    #     New rule: when a 4-block alternating XYXY window exists, identify the
    #     SHORTER of the two middle blocks and absorb that one — not whichever
    #     we happened to see first.
    absorbed: list[Block] = []
    i = 0
    while i < len(blocks):
        # 4-block alternating XYXY check (looking at positions i .. i+3).
        # Only fires when BOTH middle blocks are short — that's the signature
        # of a real cluster transition next to brief noise. When one middle
        # block is long, it's an attendee's normal back-and-forth and falls
        # through to the iterative 3-block absorber below.
        four_block_window = (
            i + 3 < len(blocks)
            and blocks[i][0] == blocks[i + 2][0]       # X
            and blocks[i + 1][0] == blocks[i + 3][0]   # Y
            and blocks[i][0] != blocks[i + 1][0]       # X != Y
        )
        if four_block_window:
            x_a, y_b, x_c, y_d = blocks[i], blocks[i + 1], blocks[i + 2], blocks[i + 3]
            b_dur = y_b[3] - y_b[1]
            c_dur = x_c[3] - x_c[1]
            BOTH_MIDDLE_SHORT_S = 30.0
            if b_dur < BOTH_MIDDLE_SHORT_S and c_dur < BOTH_MIDDLE_SHORT_S:
                # Real cluster transition right next to brief noise. Absorb
                # the SHORTER of the two middle blocks into the surrounding
                # same-cluster flow.
                if c_dur < b_dur:
                    absorbed.append(x_a)
                    absorbed.append((y_b[0], y_b[1], y_d[2], y_d[3]))
                else:
                    absorbed.append((x_a[0], x_a[1], x_c[2], x_c[3]))
                    absorbed.append(y_d)
                i += 4
                continue
            # else: fall through to 3-block absorption

        # Fall back to 3-block [A][B][A] check
        if (
            absorbed
            and i + 1 < len(blocks)
            and blocks[i + 1][0] == absorbed[-1][0]
            and blocks[i][0] != absorbed[-1][0]
            and blocks[i][3] - blocks[i][1] < 60.0
        ):
            cid, s, _, _ = absorbed[-1]
            absorbed[-1] = (cid, s, blocks[i + 1][2], blocks[i + 1][3])
            i += 2
            continue

        absorbed.append(blocks[i])
        i += 1
    blocks = absorbed

    n_clusters = len({b[0] for b in blocks})
    sessions: list[Session] = []
    for i, (cluster_id, first_s, attendee_last_s, _alex_last_s) in enumerate(blocks):
        # Boundary for the editor's displayed clip range:
        #   - Shorts (1 attendee cluster): start at 0:00. Most shorts open
        #     with the attendee speaking, and the user wants 0:00 to be the
        #     canonical clip start.
        #   - Long videos: start where the attendee starts. Alex's workshop
        #     intro and the previous attendee's wrap-up are NOT part of this
        #     person's clip.
        if n_clusters == 1:
            start_s = 0.0
        else:
            # `first_s` is already the first attendee word of this cluster
            # in this block. That's the right place to land.
            start_s = first_s

        if i + 1 < len(blocks):
            next_block_first = blocks[i + 1][1]
        else:
            next_block_first = float(video_duration_s)
        # CTA cut: scan Alex's words after the attendee finished speaking. This
        # catches per-attendee mini-CTAs in long videos AND the outro CTA on shorts.
        cta_in_block = _find_cta_start_s(alex_words, after_s=attendee_last_s)
        candidates = [next_block_first, float(video_duration_s)]
        if cta_in_block is not None:
            candidates.append(cta_in_block)
        end_s = min(candidates)

        start_s = _snap_start_forward(words, start_s, SNAP_WINDOW_S)
        end_s = _snap_end_backward(words, end_s, SNAP_WINDOW_S)
        if end_s - start_s < 30.0:
            # Likely a misclustered fragment; not a real session.
            continue

        text_tokens = [w for w in words if w.start >= start_s and w.end <= end_s]
        full_text = _stitch(text_tokens)
        if not full_text:
            continue
        # Skip sessions whose OPENING text is Alex's CTA — those are mid-video
        # CTA leaks that the diarizer split into their own block.
        opening = _normalize(full_text[:300])
        if any(p in opening for p in CTA_PHRASES):
            continue

        # play_start_s: where the YouTube URL drops the player. Subtract a
        # 3s preroll so YouTube's forward-only keyframe seek still lands
        # before the attendee's first word.
        play_start_s = max(0.0, start_s - PLAY_PREROLL_S)

        sessions.append(
            Session(
                video_id=video_id,
                start_s=float(start_s),
                end_s=float(end_s),
                attendee_cluster_id=int(cluster_id) if n_clusters > 1 else None,
                full_text=full_text,
                play_start_s=float(play_start_s),
            )
        )

    # Final consolidation: merge directly-consecutive same-cluster sessions
    # with small gaps. Catches cases where one attendee's stretch was split
    # by a 60s+ outlier that the 3-block absorber couldn't reach across.
    if len(sessions) > 1:
        merged_sessions: list[Session] = [sessions[0]]
        for s in sessions[1:]:
            prev = merged_sessions[-1]
            same_cluster = (
                s.attendee_cluster_id is not None
                and s.attendee_cluster_id == prev.attendee_cluster_id
            )
            close_gap = (s.start_s - prev.end_s) < 30.0
            if same_cluster and close_gap:
                new_end = max(prev.end_s, s.end_s)
                new_tokens = [w for w in words if w.start >= prev.start_s and w.end <= new_end]
                merged_sessions[-1] = Session(
                    video_id=prev.video_id,
                    start_s=prev.start_s,
                    end_s=new_end,
                    attendee_cluster_id=prev.attendee_cluster_id,
                    full_text=_stitch(new_tokens),
                    play_start_s=prev.play_start_s,
                )
            else:
                merged_sessions.append(s)
        sessions = merged_sessions
    return sessions
