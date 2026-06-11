"""Cluster sessions by conversation identity using BOTH semantic and lexical signals.

The Junk Drawer failure mode shows that summary embeddings alone don't
discriminate well between "same topic" and "same conversation." Different LLM
summaries of the same conversation can score only ~0.77, while different
conversations on similar topics can score 0.90+.

Signal:
  semantic = cosine of OpenAI embedding over the first ~3000 chars of full_text
             (the attendee's intro + business context, where conversation
             identity lives)
  lexical  = 3-gram Jaccard over cleaned tokens of full_text

Dedup rule:
  (semantic >= 0.70 AND lexical >= 0.08) — both signals must agree

Calibrated against:
  - Tk0e0z8h64Y ↔ lPZOkIvVxPc (exact duplicate upload)
  - 5rk7GElwf6M ↔ jqo0lVveh98 (clipped from long video)
  - fNPlt_C54KM ↔ 8C_6qojTA78 (Junk Drawer in 8C_6qojTA78)

Idempotent: re-running fully recomputes group ids.
"""
from __future__ import annotations

import math
import re
import sys
from collections import Counter
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from db import connect
from stages.embed import embed_texts

SEMANTIC_THRESHOLD = 0.70
LEXICAL_THRESHOLD = 0.08
INTRO_CHARS = 3000  # first ~3000 chars = the attendee's setup + Alex's first answer

STOP = set(
    "the a an and or but of in on at to for with from by as is are was were be "
    "been being have has had do does did will would can could should may might "
    "must i im you your youre were dont didnt wont cant it that this these those "
    "there their they them him her his hers its our we us so just like really "
    "some any all what who whom whose which where when how why if then than "
    "because too very much many more most less also even still always never "
    "ever something anything nothing everything someone anyone everyone people "
    "thing things stuff yeah okay ok well right now well alright".split()
)


def _clean_tokens(text: str) -> list[str]:
    raw = re.findall(r"[A-Za-z]+", text.lower())
    return [w for w in raw if len(w) >= 3 and w not in STOP]


def _ngrams(tokens: list[str], n: int = 3) -> Counter:
    return Counter(tuple(tokens[i : i + n]) for i in range(len(tokens) - n + 1))


def _jaccard(a: Counter, b: Counter) -> float:
    if not a or not b:
        return 0.0
    inter = sum((a & b).values())
    union = sum((a | b).values())
    return inter / union if union else 0.0


def _union_find_pairs(n: int, pairs: list[tuple[int, int]]) -> list[int]:
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a, b in pairs:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
    return [find(i) for i in range(n)]


def cluster_and_write() -> None:
    with connect() as c, c.cursor() as cur:
        cur.execute(
            "select id, video_id, end_s - start_s as dur_s, full_text "
            "from sessions order by id"
        )
        rows = cur.fetchall()
    if not rows:
        print("No sessions.")
        return

    n = len(rows)
    session_ids = [r[0] for r in rows]
    video_ids = [r[1] for r in rows]
    durations = [float(r[2]) for r in rows]
    intros = [str(r[3])[:INTRO_CHARS] for r in rows]
    print(f"{n} sessions to compare.")

    # Embed intros in a single batch.
    print("Embedding intros ...")
    vecs = embed_texts(intros)
    norms = np.linalg.norm(vecs, axis=1, keepdims=True)
    norms[norms == 0] = 1
    vn = vecs / norms

    # 3-gram counters per session.
    ng = [_ngrams(_clean_tokens(t), 3) for t in intros]

    sims = vn @ vn.T
    pairs: list[tuple[int, int]] = []
    for i in range(n):
        for j in range(i + 1, n):
            if video_ids[i] == video_ids[j]:
                # Different attendees in the same video are different conversations
                # by construction in our segmenter.
                continue
            sem = float(sims[i, j])
            if sem < SEMANTIC_THRESHOLD:
                continue
            lex = _jaccard(ng[i], ng[j])
            if lex < LEXICAL_THRESHOLD:
                continue
            pairs.append((i, j))
            print(
                f"  dup: s{session_ids[i]} ({video_ids[i]}, {durations[i]:.0f}s)  <-->  "
                f"s{session_ids[j]} ({video_ids[j]}, {durations[j]:.0f}s)  "
                f"sem={sem:.3f} lex={lex:.3f}"
            )

    # Always clear stale group ids.
    with connect() as c, c.cursor() as cur:
        cur.execute("update sessions set dup_group_id = null")
        c.commit()

    if not pairs:
        print(
            f"No duplicate sessions detected at sem>={SEMANTIC_THRESHOLD} AND "
            f"lex>={LEXICAL_THRESHOLD}"
        )
        return

    roots = _union_find_pairs(n, pairs)
    root_counts = Counter(roots)
    next_gid = 1
    root_to_gid: dict[int, int] = {}
    session_to_gid: dict[int, int | None] = {}
    for sid, root in zip(session_ids, roots):
        if root_counts[root] < 2:
            session_to_gid[sid] = None
            continue
        if root not in root_to_gid:
            root_to_gid[root] = next_gid
            next_gid += 1
        session_to_gid[sid] = root_to_gid[root]

    with connect() as c, c.cursor() as cur:
        for sid, gid in session_to_gid.items():
            if gid is None:
                continue
            cur.execute("update sessions set dup_group_id = %s where id = %s", (gid, sid))
        c.commit()

    n_grouped = sum(1 for g in session_to_gid.values() if g is not None)
    print(f"\nAssigned {n_grouped} sessions to {next_gid - 1} duplicate groups.")


if __name__ == "__main__":
    cluster_and_write()
