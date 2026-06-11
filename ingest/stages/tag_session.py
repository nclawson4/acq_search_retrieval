"""LLM tagging for sessions: industry, revenue_band, gender, topics, summary.

Single GPT-4o-mini call per session with strict json_schema output. The LLM
is constrained to the closed-set taxonomies in ingest/topics.py, so search-
side filter mapping and topic ranking can rely on the same vocabulary.
"""
from __future__ import annotations

import json
from dataclasses import dataclass

from openai import OpenAI

from config import CHAT_MODEL, OPENAI_API_KEY
from topics import GENDERS, INDUSTRIES, REVENUE_BANDS, TOPICS


@dataclass
class SessionTags:
    industry: str
    revenue_band: str
    gender: str
    topics: list[str]
    conversation_summary: str


def _system_prompt() -> str:
    return (
        "You are a media editor tagging a Q&A session from a business coaching "
        "workshop. The session contains ONE attendee describing their business "
        "and Alex Hormozi (the coach) answering. Your job is to extract "
        "structured tags so an editor can find this clip later.\n\n"
        "Rules:\n"
        "1. Pick exactly ONE industry from the allowed list. If genuinely "
        "   ambiguous, use 'other'.\n"
        "2. Pick exactly ONE revenue_band from the allowed list based on what "
        "   the attendee says their business does in annual revenue. If they "
        "   don't say, use 'unknown'.\n"
        "3. Infer attendee gender from voice context: the words the attendee "
        "   uses, names ('Sam', 'my wife/husband'), and explicit references. "
        "   If ambiguous, use 'unknown'.\n"
        "4. Pick 1-3 topics from the allowed list that the conversation is "
        "   ACTUALLY ABOUT — not just mentioned in passing. Topic precision "
        "   matters more than recall.\n"
        "5. Write a 1-2 sentence conversation_summary that names the "
        "   attendee's industry, current revenue if mentioned, and the "
        "   specific problem they are working on with Alex. This summary is "
        "   what the search system embeds to match against editor queries."
    )


def _response_schema() -> dict:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "industry": {"type": "string", "enum": INDUSTRIES},
            "revenue_band": {"type": "string", "enum": REVENUE_BANDS},
            "gender": {"type": "string", "enum": GENDERS},
            "topics": {
                "type": "array",
                "minItems": 1,
                "maxItems": 3,
                "items": {"type": "string", "enum": TOPICS},
            },
            "conversation_summary": {"type": "string"},
        },
        "required": [
            "industry",
            "revenue_band",
            "gender",
            "topics",
            "conversation_summary",
        ],
    }


_client: OpenAI | None = None


def _openai() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=OPENAI_API_KEY)
    return _client


def tag_session(full_text: str) -> SessionTags:
    """Single LLM call. Truncates very long texts to keep cost predictable."""
    truncated = full_text[:12000]
    resp = _openai().chat.completions.create(
        model=CHAT_MODEL,
        messages=[
            {"role": "system", "content": _system_prompt()},
            {
                "role": "user",
                "content": f"Session transcript:\n\n<transcript>\n{truncated}\n</transcript>",
            },
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "session_tags",
                "strict": True,
                "schema": _response_schema(),
            },
        },
        temperature=0.0,
    )
    data = json.loads(resp.choices[0].message.content or "{}")
    return SessionTags(
        industry=data["industry"],
        revenue_band=data["revenue_band"],
        gender=data["gender"],
        topics=list(data["topics"]),
        conversation_summary=data["conversation_summary"].strip(),
    )
