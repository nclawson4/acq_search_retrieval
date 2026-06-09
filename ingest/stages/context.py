"""Extract structured attendee context from a question turn.

Workshop attendees typically frame their question with: industry, revenue
stage, and a specific problem. We use one LLM call per question to
normalize this into filterable fields. Anything unspecified is null.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field

from openai import OpenAI

from config import CHAT_MODEL, OPENAI_API_KEY

REVENUE_BANDS = ["<$1M", "$1-5M", "$5-10M", "$10-50M", "$50M+"]
PROBLEM_TAGS = [
    "pricing",
    "offers",
    "sales",
    "marketing",
    "hiring",
    "team_building",
    "operations",
    "scaling",
    "partnerships",
    "acquisition",
    "exit",
    "raising_capital",
    "product",
    "retention",
    "branding",
    "international_expansion",
    "competitors",
    "personal_development",
]


@dataclass
class AttendeeContext:
    industry: str | None = None
    revenue_band: str | None = None
    problems: list[str] = field(default_factory=list)


SYSTEM = (
    "You extract structured business context from an attendee's question at "
    "an Alex Hormozi workshop. Output JSON only:\n"
    '{"industry": string|null, "revenue_band": string|null, "problems": string[]}\n\n'
    "Rules:\n"
    "- industry: short noun phrase describing the attendee's business (e.g. "
    '"med spa", "marketing agency", "SaaS company", "tax advisory", "franchise '
    'consulting"). null if not stated.\n'
    "- revenue_band: pick exactly one from "
    f"{REVENUE_BANDS} if the attendee gave an annual revenue figure; otherwise null. "
    'Use the band the stated revenue falls into. Examples: "$4M" -> "$1-5M", '
    '"$24M" -> "$10-50M", "we did 200k last year" -> "<$1M".\n'
    "- problems: zero or more tags from this exact set: "
    f"{PROBLEM_TAGS}. Pick only tags that clearly describe what the attendee "
    "is asking about. Empty list if unclear."
)


def extract_context(question_text: str) -> AttendeeContext:
    """Single LLM call. Returns empty context on failure."""
    if not question_text.strip():
        return AttendeeContext()
    client = OpenAI(api_key=OPENAI_API_KEY)
    try:
        resp = client.chat.completions.create(
            model=CHAT_MODEL,
            messages=[
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": question_text[:4000]},
            ],
            response_format={"type": "json_object"},
            temperature=0.0,
        )
        raw = resp.choices[0].message.content or "{}"
        data = json.loads(raw)
        industry = data.get("industry")
        revenue_band = data.get("revenue_band")
        problems = data.get("problems") or []
        return AttendeeContext(
            industry=industry if isinstance(industry, str) and industry.strip() else None,
            revenue_band=revenue_band if revenue_band in REVENUE_BANDS else None,
            problems=[p for p in problems if isinstance(p, str) and p in PROBLEM_TAGS],
        )
    except Exception:
        return AttendeeContext()
