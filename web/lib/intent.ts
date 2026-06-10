import OpenAI from "openai";
import { HYDE_MODEL, OPENAI_API_KEY, PROBLEM_TAGS, REVENUE_BANDS } from "./env";

let _client: OpenAI | null = null;
function client() {
  if (!_client) _client = new OpenAI({ apiKey: OPENAI_API_KEY() });
  return _client;
}

export interface QueryIntent {
  industries: string[];
  problems: string[];
  revenueBand: string | null;
}

const EMPTY: QueryIntent = { industries: [], problems: [], revenueBand: null };

const SYSTEM = `You extract structured filters from a search query against a video library of business workshop Q&A (attendee question + Alex Hormozi answer). Each moment was tagged at ingest time with: industry (short noun phrase the attendee used for their business — e.g. "med spa", "marketing agency", "dental practice"), revenue_band, and zero or more problem tags.

Output JSON only:
{
  "industries": string[],
  "problems": string[],
  "revenue_band": string|null
}

Rules:
- industries: if the query targets a business type or persona, return 3-8 short noun phrases an attendee in that sector might use to describe their business — cast a wide net across the sector. E.g. "healthcare founder" -> ["med spa","dental practice","chiropractic clinic","clinic","medical practice","veterinary clinic","wellness","physical therapy"]. "agency owner" -> ["marketing agency","advertising agency","creative agency","digital agency","pr agency"]. Empty array if the query has no persona/industry.
- problems: zero or more tags from this EXACT set, only if the query is clearly about that topic: ${JSON.stringify([...PROBLEM_TAGS])}. Empty array if unclear.
- revenue_band: one of ${JSON.stringify([...REVENUE_BANDS])} if the query specifies a revenue size; otherwise null.

Be conservative: only populate fields the query actually constrains. A pure how-to query like "how do I price an offer" -> industries=[], problems=["pricing","offers"], revenue_band=null. No commentary, JSON only.`;

export async function extractIntent(query: string): Promise<QueryIntent> {
  const q = query.trim();
  if (!q) return EMPTY;
  try {
    const resp = await client().chat.completions.create({
      model: HYDE_MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: q },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 250,
    });
    const raw = resp.choices[0]?.message?.content ?? "{}";
    const data = JSON.parse(raw) as Record<string, unknown>;

    const industries = Array.isArray(data.industries)
      ? (data.industries as unknown[])
          .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
          .map((s) => s.trim().toLowerCase())
          .slice(0, 8)
      : [];

    const allowedProblems = new Set<string>(PROBLEM_TAGS);
    const problems = Array.isArray(data.problems)
      ? (data.problems as unknown[]).filter(
          (s): s is string => typeof s === "string" && allowedProblems.has(s),
        )
      : [];

    const allowedBands = new Set<string>(REVENUE_BANDS);
    const rb = data.revenue_band;
    const revenueBand =
      typeof rb === "string" && allowedBands.has(rb) ? rb : null;

    return { industries, problems, revenueBand };
  } catch {
    return EMPTY;
  }
}
