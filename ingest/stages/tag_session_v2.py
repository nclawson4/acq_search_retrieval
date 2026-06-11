"""Verification-gated multi-industry tagger.

The single-tag baseline failed on attendees with multiple business lines
(salon + e-commerce wholesale, agency + SaaS product, etc.). This module
runs three layered checks before a secondary industry survives:

  Stage 1 — Tagger (single Claude call, prompt-cached):
    Emits primary industry + 0..2 secondary industries. Each tag includes:
      - confidence (0..1)
      - verbatim evidence quote drawn from full_text
      - actively_discussed flag (was the attendee asking Alex about this
        line of business, or is it just mentioned in passing?)

  Stage 2 — Verbatim validation (local):
    Each evidence quote must appear as a substring of full_text after
    whitespace normalization. Rejects model-invented quotes.

  Stage 3 — Audit (separate Claude call, evidence-only context):
    Reviews the {industry, evidence} pair WITHOUT seeing the original
    transcript or the primary tag, and answers: "is this attendee
    genuinely operating in this industry as a meaningful revenue line?"
    A `no` rejects the secondary tag.

The audit pass is the structural gate that prevents the model from
collapsing to "tag everything to be safe" — it has no memory of how the
primary was picked and must justify each secondary in isolation.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Optional

from anthropic import Anthropic

from config import ANTHROPIC_API_KEY, CLAUDE_MODEL
from topics import GENDERS, INDUSTRIES, REVENUE_BANDS, TOPICS

# Minimum confidence for a tag to be kept after the verbatim+audit gates.
PRIMARY_CONFIDENCE_FLOOR = 0.50
SECONDARY_CONFIDENCE_FLOOR = 0.70

# How long an evidence quote may be. Keeps the model from quoting whole
# paragraphs to bias the verbatim match.
MAX_EVIDENCE_CHARS = 240


@dataclass
class IndustryTag:
    industry: str
    confidence: float
    evidence: str
    actively_discussed: bool
    audit_passed: bool = False
    audit_reason: str = ""
    quote_verified: bool = False


@dataclass
class SessionTagsV2:
    primary_industry: str
    primary_tag: IndustryTag
    secondary_industries: list[str] = field(default_factory=list)
    secondary_tags: list[IndustryTag] = field(default_factory=list)
    revenue_band: str = "unknown"
    gender: str = "unknown"
    topics: list[str] = field(default_factory=list)
    conversation_summary: str = ""
    # Every industry the tagger considered (kept + rejected) for audit logging.
    all_candidates: list[IndustryTag] = field(default_factory=list)


_client: Optional[Anthropic] = None


def _anthropic() -> Anthropic:
    global _client
    if _client is None:
        if not ANTHROPIC_API_KEY:
            raise RuntimeError(
                "ANTHROPIC_API_KEY is not set. Add it to .env to run the "
                "multi-industry tagger."
            )
        _client = Anthropic(api_key=ANTHROPIC_API_KEY)
    return _client


# ---------------------------------------------------------------------------
# Stage 1: tagger
# ---------------------------------------------------------------------------

TAGGER_SYSTEM = """You are tagging a Q&A workshop session for a media editor's
search library. Each session has ONE attendee describing their business and
Alex Hormozi answering. Your job is to produce structured tags an editor can
filter against to find specific people for compilation clips.

You will be given the full session transcript inside <transcript> tags.

Output JSON matching the provided schema. NO PROSE, JSON ONLY.

PRIMARY INDUSTRY (`primary_industry` + `primary_confidence` + `primary_evidence`):

Pick the SINGLE industry that best identifies WHO this attendee IS to a
media editor — the line they are most identified with from a revenue and
operations perspective. Decision priority:

  1. If the attendee runs multiple businesses, pick the one driving the
     HIGHEST current revenue. (A $2.6M wholesale + $900K salon -> the
     industry of the wholesale, not the salon.)
  2. If revenue is comparable across lines, pick the one they've operated
     LONGEST or describe as their "main" business.
  3. Only after the above: consider what they are asking Alex about.

Do NOT use 'other' if a specific industry fits, even loosely.

SECONDARY INDUSTRIES (`secondary_tags`, 0-2):

Emit a secondary when the attendee actively operates in another industry,
sells through another industry's channel, or runs a real revenue line in
another category. Smaller revenue lines count as long as they're real
operating businesses today (a $900K salon alongside a $2.6M wholesale
business is a valid secondary).

For each secondary:

  - `confidence` 0.0-1.0
  - `evidence` — a verbatim quote (see VERBATIM QUOTE RULES below)
  - `actively_discussed` — true when all three are true:
       (a) the attendee currently operates this line / sells through it,
       (b) it's a real business with revenue, employees, or service
           delivery (not a passing mention),
       (c) it's not a previous business they exited, and not an aspiration.

Concrete examples:
  - Hair salon ($900K) + wholesale e-commerce ($2.6M): primary
    e_commerce, secondary health_and_wellness or retail_and_brick_mortar.
  - Custom gaming-table manufacturer who sells via Google Ads to consumers:
    primary manufacturing OR e_commerce, secondary the other one — the
    sales channel is also an industry.
  - Construction company ($11M) + elevator company ($3M): two distinct
    revenue lines, secondary for the smaller one.
  - "I also have a trunk removal business" with revenue context: YES.
  - "I also have a podcast" with NO revenue context: NO.
  - "I used to run a gym": NO (exited).
  - "I'm thinking about starting an agency": NO (aspiration).
  - "I have some real estate investments" described as passive: NO unless
    the attendee operates a real estate BUSINESS (managing, flipping,
    brokering).

EMITTING ZERO SECONDARIES is correct when the attendee genuinely runs
one business. But when they describe multiple operating lines or sell
through multiple channels, surface the secondaries — they're how
editors find people who fit two compilation themes.

VERBATIM QUOTE RULES (apply to primary_evidence and every secondary evidence):

  - Must appear WORD-FOR-WORD in the transcript above.
  - Must be a SINGLE CONTIGUOUS span. Pick one sentence (or part of one).
  - NO ELLIPSES ('...'). No joining of separate sentences.
  - Max 240 characters. Prefer 50-150 characters.
  - Do not paraphrase. Do not normalize spelling. Do not fix transcription
    errors. Copy bytes exactly.

If you cannot find a real, contiguous quote in the transcript that proves
the tag, DO NOT EMIT THE TAG. A high-confidence guess without evidence is
worse than no tag at all.

revenue_band:
  - under $1M -> '<$1M'
  - $1M to $5M -> '$1-5M'
  - $5M to $25M -> '$5-25M'
  - $25M+ -> '$25M+'
  - unspecified -> 'unknown'
  If the attendee runs multiple lines, use TOTAL combined revenue.

gender — infer from first-person language, names, and explicit references.
Use 'unknown' if ambiguous.

topics (1-3) — pick what the conversation IS ACTUALLY ABOUT. Precision
over recall — only include a topic if Alex spends real time on it. Don't
include a topic just because a related word appears.

conversation_summary — 1-2 sentences naming the attendee's primary
industry, revenue if mentioned, and the specific problem they're working
on with Alex. This is what search ranks against, so use plain words an
editor would type."""

# The constants list (industries, revenue, gender, topics) is injected into
# the system prompt as the cache-stable second block. Splitting it from the
# rules above keeps the smaller, more frequently-edited piece together.
def _enums_block() -> str:
    return (
        "ALLOWED VALUES (use exact strings):\n\n"
        f"industries (pick ONE primary, 0-2 secondaries): {INDUSTRIES}\n\n"
        f"revenue_band: {REVENUE_BANDS}\n\n"
        f"gender: {GENDERS}\n\n"
        f"topics (pick 1-3): {TOPICS}\n"
    )


def _tagger_schema() -> dict:
    industry_tag_schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "industry": {"type": "string", "enum": INDUSTRIES},
            "confidence": {"type": "number"},
            "evidence": {"type": "string"},
            "actively_discussed": {"type": "boolean"},
        },
        "required": ["industry", "confidence", "evidence", "actively_discussed"],
    }
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "primary_industry": {"type": "string", "enum": INDUSTRIES},
            "primary_confidence": {"type": "number"},
            "primary_evidence": {"type": "string"},
            "secondary_tags": {
                "type": "array",
                "items": industry_tag_schema,
            },
            "revenue_band": {"type": "string", "enum": REVENUE_BANDS},
            "gender": {"type": "string", "enum": GENDERS},
            "topics": {
                "type": "array",
                "items": {"type": "string", "enum": TOPICS},
            },
            "conversation_summary": {"type": "string"},
        },
        "required": [
            "primary_industry",
            "primary_confidence",
            "primary_evidence",
            "secondary_tags",
            "revenue_band",
            "gender",
            "topics",
            "conversation_summary",
        ],
    }


def _call_tagger(full_text: str) -> dict:
    """Stage-1 tagger call with prompt-caching on the rules + enums."""
    client = _anthropic()
    # Cap input size — 12k chars is enough for the longest session in the corpus.
    truncated = full_text[:12000]
    resp = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=2048,
        system=[
            {"type": "text", "text": TAGGER_SYSTEM},
            {
                "type": "text",
                "text": _enums_block(),
                # Cache the enums block — it's stable across every session
                # in this corpus and is by far the most token-expensive part
                # of the system prompt.
                "cache_control": {"type": "ephemeral"},
            },
        ],
        messages=[
            {
                "role": "user",
                "content": (
                    f"<transcript>\n{truncated}\n</transcript>\n\n"
                    "Return the JSON tagging. Use only verbatim quotes from "
                    "the transcript above."
                ),
            }
        ],
        output_config={
            "format": {
                "type": "json_schema",
                "schema": _tagger_schema(),
            },
        },
    )
    return _extract_json(resp)


# ---------------------------------------------------------------------------
# Stage 2: verbatim quote validation
# ---------------------------------------------------------------------------

_WS_RE = re.compile(r"\s+")


def _normalize(text: str) -> str:
    return _WS_RE.sub(" ", text).strip().lower()


def _quote_appears_in(quote: str, transcript: str) -> bool:
    """True if `quote` appears as a (whitespace-normalized) substring of
    `transcript`. Permissive on whitespace, strict on words."""
    if not quote:
        return False
    if len(quote) > MAX_EVIDENCE_CHARS:
        # Reject sprawling quotes — they're either paraphrases or attempts to
        # cover the whole transcript to game the verbatim check.
        return False
    return _normalize(quote) in _normalize(transcript)


# ---------------------------------------------------------------------------
# Stage 3: audit
# ---------------------------------------------------------------------------

AUDIT_SYSTEM = """You are auditing a single industry tag for a media editor's
search library. You will see ONLY the candidate industry and a quoted excerpt
of evidence — NOT the full transcript and NOT any other tags.

Answer YES (accept: true) when the evidence shows the attendee is actively
operating in this industry today, OR selling through this industry's channel,
OR running a real revenue line in this category — even if it's a smaller
secondary business alongside something larger.

Answer NO (accept: false) when:
  - The evidence is just a passing mention without operational involvement
  - The business was exited or sold (past tense, no longer running)
  - The attendee is asking about getting INTO this industry but hasn't started
  - The evidence describes Alex's advice or commentary, not the attendee's
    actual business
  - The "industry" is a hobby investment, not an operating business (e.g.,
    owning some real estate passively is not real_estate; running a real
    estate brokerage IS)

Concrete examples to calibrate:
  - "I have a hair salon doing $900K and a wholesale ecommerce business
    doing $2.6M" + industry=retail_and_brick_mortar: YES (salon is an
    operating brick-and-mortar location).
  - "I sell custom gaming tables via Google Ads, $2.5M/year" + industry=
    e_commerce: YES (direct-to-consumer online sales = e-commerce).
  - "I sell custom gaming tables via Google Ads, $2.5M/year" + industry=
    manufacturing: YES (they manufacture the product they sell).
  - "I have another business, trunk removal" + industry=home_services:
    YES if revenue is implied; NO if just listed as a distraction with no
    revenue/operations details.
  - "I also have real estate" described as investments with no management
    business + industry=real_estate: NO (passive).
  - "I used to run a fitness coaching business" + industry=health_and_wellness:
    NO (exited).

Output strict JSON:
  { "accept": <true|false>, "reason": "<one short sentence>" }

Apply the criteria. Don't default to no; apply the criteria to the evidence."""


def _audit_schema() -> dict:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "accept": {"type": "boolean"},
            "reason": {"type": "string"},
        },
        "required": ["accept", "reason"],
    }


def _call_audit(industry: str, evidence: str) -> tuple[bool, str]:
    client = _anthropic()
    resp = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=200,
        system=[
            {"type": "text", "text": AUDIT_SYSTEM, "cache_control": {"type": "ephemeral"}},
        ],
        messages=[
            {
                "role": "user",
                "content": (
                    f"<candidate_industry>{industry}</candidate_industry>\n"
                    f"<evidence>{evidence}</evidence>"
                ),
            }
        ],
        output_config={
            "format": {
                "type": "json_schema",
                "schema": _audit_schema(),
            },
        },
    )
    data = _extract_json(resp)
    return bool(data.get("accept")), str(data.get("reason", "")).strip()


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

def _extract_json(resp) -> dict:
    """Pull the JSON block out of an Anthropic response."""
    for block in resp.content:
        if getattr(block, "type", None) == "text":
            text = block.text or ""
            text = text.strip()
            if text.startswith("```"):
                # Strip any code-fence wrapping (shouldn't happen with structured
                # outputs, but harmless if it does).
                text = re.sub(r"^```(?:json)?\s*", "", text)
                text = re.sub(r"\s*```$", "", text)
            return json.loads(text)
    raise RuntimeError("Anthropic response had no text block to parse")


def tag_session_v2(full_text: str) -> SessionTagsV2:
    """Run the full Stage 1 -> 2 -> 3 pipeline for one session."""
    data = _call_tagger(full_text)

    primary_industry = data["primary_industry"]
    primary_tag = IndustryTag(
        industry=primary_industry,
        confidence=float(data["primary_confidence"]),
        evidence=str(data["primary_evidence"]),
        actively_discussed=True,  # primary is always treated as active
    )

    raw_secondaries = data.get("secondary_tags", [])
    candidates = [
        IndustryTag(
            industry=s["industry"],
            confidence=float(s["confidence"]),
            evidence=str(s["evidence"]),
            actively_discussed=bool(s["actively_discussed"]),
        )
        for s in raw_secondaries
        if s["industry"] != primary_industry  # never repeat the primary as secondary
    ]

    # Stage 2: verbatim quote validation (run on every candidate, including primary).
    primary_tag.quote_verified = _quote_appears_in(primary_tag.evidence, full_text)
    for tag in candidates:
        tag.quote_verified = _quote_appears_in(tag.evidence, full_text)

    # Stage 3: audit. Only run on secondaries that survived stage 2.
    surviving: list[IndustryTag] = []
    for tag in candidates:
        if not tag.quote_verified:
            tag.audit_passed = False
            tag.audit_reason = "evidence quote not found in transcript"
            continue
        if not tag.actively_discussed:
            tag.audit_passed = False
            tag.audit_reason = "attendee not actively operating this line"
            continue
        if tag.confidence < SECONDARY_CONFIDENCE_FLOOR:
            tag.audit_passed = False
            tag.audit_reason = f"confidence {tag.confidence:.2f} below floor"
            continue
        accept, reason = _call_audit(tag.industry, tag.evidence)
        tag.audit_passed = accept
        tag.audit_reason = reason
        if accept:
            surviving.append(tag)

    return SessionTagsV2(
        primary_industry=primary_industry,
        primary_tag=primary_tag,
        secondary_industries=[t.industry for t in surviving],
        secondary_tags=surviving,
        revenue_band=data["revenue_band"],
        gender=data["gender"],
        topics=list(data["topics"]),
        conversation_summary=data["conversation_summary"].strip(),
        all_candidates=[primary_tag, *candidates],
    )
