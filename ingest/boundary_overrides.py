"""Hand-verified attendee boundaries for the 4 long workshop videos.

The automatic speaker-cluster segmenter is reliable on the 45 short videos
(one attendee each) but is fragile on the 4 long videos where Deepgram
diarization splits the same person across multiple cluster IDs and the
cluster transitions don't line up with content boundaries. For this demo
corpus we override the segmentation manually using timestamps verified
against the actual transcripts.

Format: { video_id: [(start_s, label), ...] } in chronological order.
The end_s of each session is computed automatically as the start_s of
the next attendee, with the last attendee bounded by the video's outro
CTA or end of video.
"""
from __future__ import annotations

BOUNDARY_OVERRIDES: dict[str, list[tuple[int, str]]] = {
    # Helping 6 Business Owners Scale (33 min)
    "0EqJD2o-Mnk": [
        (24,   "Thomas — roofing & exterior remodeling, $6M, wants $100M"),
        (451,  "Corey — electrical contractor, $1.6M, wants $5M"),
        (791,  "Tanner Jarrett — HVAC, Bozeman MT, $1.5M, Yellowstone Club clients"),
        (1118, "Trenton — roofing, $3M, transitioning from door-to-door"),
        (1452, "Art — junk removal & demolition to commercial PMs, $1M"),
        (1711, "Adrian — commercial construction $11M + elevator company $3M"),
    ],

    # Helping 4 Educational Business Owners Build a $1M Business (25 min)
    "BYpTRiRqS1Y": [
        (19,   "Fayetteville coach — house flipping → coaching ecosystem, $4M"),
        (421,  "Motocross trainer — 5-day camps + single-day tours"),
        (764,  "Real estate agent coach — $2.5M, wants to double"),
        (1100, "Sales coaching for financial advisors — $6.6M, wants $20M+"),
    ],

    # Helping E-Commerce Business Owners Scale (41 min)
    "8C_6qojTA78": [
        (22,   "Max — Elevate Customs, luxury gaming tables, $2.5M"),
        (486,  "Ethan — direct response e-commerce, $3M run rate"),
        (1128, "Samantha Harrison — Australian hair extensions (salon $900K + wholesale $2.6M)"),
        (1722, "Sasha — designer bags + sunglasses on Whatnot livestreams, $6M"),
    ],

    # Watch This If You Have a Service Business (45 min)
    # NOTE: attendee #5 (Thomas) is the SAME conversation as 0EqJD2o-Mnk #1.
    # The cross-video dedup pass (dedupe_sessions.py) should collapse them.
    "jqo0lVveh98": [
        (21,   "Chiropractor — Wyoming, $2.4M stuck for 5 years"),
        (431,  "Australian digital marketing agency — SMBs, $500K, 4 months old"),
        (757,  "WaaS (Website as a Service) — $20M, AI disruption fear"),
        (1091, "CFO advisory — $2.9M, has books Fire My CPA + Tax Free Millionaire"),
        (1582, "Thomas — roofing & exterior remodeling, $6M (duplicate of 0EqJD2o-Mnk #1)"),
        (2095, "Residential fence company — family-owned (daughter + dad), $20M"),
    ],
}


def has_override(video_id: str) -> bool:
    return video_id in BOUNDARY_OVERRIDES


def override_starts(video_id: str) -> list[int]:
    return [s for s, _ in BOUNDARY_OVERRIDES.get(video_id, [])]
