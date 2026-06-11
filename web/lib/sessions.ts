// Session search: filter extraction → hard filter + semantic rank → LLM judge.

import { sql } from "./db";
import { embedQuery } from "./embed";
import { addUsage, emptyUsage, type TokenUsage } from "./openai";
import { qdrant } from "./qdrant";
import { judgeCandidates } from "./judge";
import { extractFilters, type ExtractedFilters } from "./extract";
import type { Gender, Industry, RevenueBand, Topic } from "./taxonomy";

const COLLECTION_SESSIONS = "sessions";
const OVERFETCH = 20;
const JUDGE_INPUT_LIMIT = 20;
const RELEVANCE_FLOOR = 0.5;

export interface SessionHit {
  sessionId: number;
  videoId: string;
  videoTitle: string;
  videoUrl: string;
  startS: number;
  endS: number;
  industry: string | null;
  secondaryIndustries: string[];
  revenueBand: string | null;
  attendeeGender: string | null;
  topics: string[];
  conversationSummary: string;
  semanticScore: number;
  judgeScore: number;
  reason: string;
  playUrl: string;
}

export interface SessionSearchOptions {
  query: string;
  filters?: {
    industry?: Industry | null;
    // 0+ bands the query qualifies for. Range expressions ("over $1M",
    // "$3M-$10M") expand to multiple bands. Empty = no revenue filter.
    revenueBands?: RevenueBand[];
    gender?: Gender | null;
    topics?: Topic[];
  };
  k?: number;
}

export interface SessionSearchResult {
  query: string;
  extracted: ExtractedFilters;
  hits: SessionHit[];
  usage: TokenUsage;
  latencyMs: number;
}

export async function searchSessions(
  opts: SessionSearchOptions,
): Promise<SessionSearchResult> {
  const t0 = Date.now();
  let usage = emptyUsage();
  const k = Math.min(50, Math.max(1, opts.k ?? 10));
  const rawQuery = opts.query.trim();

  // 1. LLM extracts filters from the query (unless caller passed explicit ones).
  const explicit = opts.filters ?? {};

  let extracted: ExtractedFilters;
  if (rawQuery.length === 0) {
    extracted = {
      industry: null, revenueBands: [], gender: null,
      topics: [], residualText: "",
    };
  } else {
    const x = await extractFilters(rawQuery);
    extracted = x.filters;
    usage = addUsage(usage, x.usage);
  }

  // Merge explicit (UI chips) with extracted (LLM): explicit wins. For
  // revenue, an editor's single-band pick from the UI dropdown supersedes
  // any range the LLM extracted from text.
  const industry = explicit.industry ?? extracted.industry ?? null;
  const revenueBands =
    explicit.revenueBands && explicit.revenueBands.length > 0
      ? explicit.revenueBands
      : extracted.revenueBands;
  const gender = explicit.gender ?? extracted.gender ?? null;
  const topics =
    explicit.topics && explicit.topics.length > 0
      ? explicit.topics
      : extracted.topics;

  // 2. Build the embedding query. Prefer residual_text when present
  // (filter-mapped phrases stripped); fall back to raw query.
  const semanticText = (extracted.residualText || rawQuery).trim();

  let queryVec: number[] = [];
  if (semanticText.length > 0) {
    queryVec = await embedQuery(semanticText);
    // text-embedding-3-small charges per input token. Rough estimate; OpenAI
    // does not return token usage on the embeddings response uniformly.
    usage = addUsage(usage, { embed: Math.ceil(semanticText.length / 4) });
  }

  // 3. Hard filter via Qdrant. Industry matches the primary OR any of the
  // verified secondaries — a hair-extension business primarily on wholesale
  // tagged primary=health_and_wellness + secondary=e_commerce surfaces in
  // both searches, with the primary listed first on the card.
  const must: Array<Record<string, unknown>> = [];
  if (industry) {
    must.push({
      should: [
        { key: "industry", match: { value: industry } },
        { key: "secondary_industries", match: { any: [industry] } },
      ],
    });
  }
  if (revenueBands.length > 0) {
    must.push({ key: "revenue_band", match: { any: revenueBands } });
  }
  if (gender) must.push({ key: "attendee_gender", match: { value: gender } });
  if (topics && topics.length > 0) {
    must.push({ key: "topics", match: { any: topics } });
  }
  const filter = must.length > 0 ? { must } : undefined;

  // 4. Retrieve candidates.
  let points: Array<{ id: string | number; score: number; payload?: Record<string, unknown> | null }> = [];
  if (queryVec.length > 0) {
    const resp = await qdrant().query(COLLECTION_SESSIONS, {
      query: queryVec,
      limit: k * OVERFETCH,
      with_payload: true,
      filter,
    });
    points = resp.points as typeof points;
  } else {
    // No semantic text — scroll filtered sessions ordered by id.
    const resp = await qdrant().scroll(COLLECTION_SESSIONS, {
      filter,
      limit: k * OVERFETCH,
      with_payload: true,
    });
    points = (resp.points ?? []).map((p) => ({
      id: p.id,
      score: 0,
      payload: p.payload ?? {},
    }));
  }

  if (points.length === 0) {
    return {
      query: rawQuery,
      extracted,
      hits: [],
      usage,
      latencyMs: Date.now() - t0,
    };
  }

  // 5. Pull video metadata + dup_group_id (single query). The dup_group_id is
  // the session-level clustering key written by scripts/dedupe_sessions.py;
  // we use it below to collapse same-conversation sessions to one card.
  const sessionIds = points
    .map((p) => Number((p.payload as Record<string, unknown>)?.session_id))
    .filter((n) => Number.isFinite(n));

  const rows = (await sql()`
    select s.id as session_id, s.dup_group_id, s.play_start_s,
           s.attendee_cluster_id, s.end_s - s.start_s as duration_s,
           v.url as video_url, v.title as video_title
    from sessions s
    join videos v on v.id = s.video_id
    where s.id = any(${sessionIds}::bigint[])
  `) as Record<string, unknown>[];
  const videoByS = new Map<
    number,
    {
      url: string;
      title: string;
      dupGroupId: number | null;
      attendeeClusterId: number | null;
      durationS: number;
      playStartS: number | null;
    }
  >();
  for (const r of rows) {
    videoByS.set(Number(r.session_id), {
      url: String(r.video_url),
      title: String(r.video_title ?? ""),
      dupGroupId: r.dup_group_id == null ? null : Number(r.dup_group_id),
      attendeeClusterId: r.attendee_cluster_id == null ? null : Number(r.attendee_cluster_id),
      durationS: Number(r.duration_s) || 0,
      playStartS: r.play_start_s == null ? null : Number(r.play_start_s),
    });
  }

  // 6. Run the LLM judge on the top OVERFETCH; only if the editor asked
  // something specific (semantic text present). If no semantic text and
  // only filters were used, skip the judge — chips speak for themselves.
  let judged: Record<string | number, { score: number; reason: string }> = {};
  if (semanticText.length > 0 && points.length > 0) {
    const candidates = points.slice(0, JUDGE_INPUT_LIMIT).map((p) => {
      const pl = (p.payload ?? {}) as Record<string, unknown>;
      return {
        id: Number(pl.session_id),
        summary: String(pl.conversation_summary ?? ""),
        industry: (pl.industry as string) ?? null,
        revenueBand: (pl.revenue_band as string) ?? null,
        topics: Array.isArray(pl.topics) ? (pl.topics as string[]) : [],
      };
    });
    const jr = await judgeCandidates(rawQuery, candidates);
    usage = addUsage(usage, jr.usage);
    for (const r of jr.results) judged[String(r.id)] = { score: r.score, reason: r.reason };
  }

  // 7. Build hits, drop low-judge sessions, sort by judge then semantic.
  const hits: SessionHit[] = [];
  for (const p of points) {
    const pl = (p.payload ?? {}) as Record<string, unknown>;
    const sid = Number(pl.session_id);
    if (!Number.isFinite(sid)) continue;
    const vid = videoByS.get(sid);
    if (!vid) continue;

    const j = judged[String(sid)];
    const judgeScore = j?.score ?? (semanticText.length === 0 ? 1.0 : 0.0);
    const reason =
      j?.reason ??
      (semanticText.length === 0 ? "Matches your selected filters." : "");

    if (semanticText.length > 0 && judgeScore < RELEVANCE_FLOOR) continue;

    const startS = Number(pl.start_s) || 0;
    const endS = Number(pl.end_s) || 0;
    hits.push({
      sessionId: sid,
      videoId: String(pl.video_id ?? ""),
      videoTitle: vid.title || String(pl.video_title ?? ""),
      videoUrl: vid.url,
      startS,
      endS,
      industry: (pl.industry as string) ?? null,
      secondaryIndustries: Array.isArray(pl.secondary_industries)
        ? (pl.secondary_industries as string[])
        : [],
      revenueBand: (pl.revenue_band as string) ?? null,
      attendeeGender: (pl.attendee_gender as string) ?? null,
      topics: Array.isArray(pl.topics) ? (pl.topics as string[]) : [],
      conversationSummary: String(pl.conversation_summary ?? ""),
      semanticScore: typeof p.score === "number" ? p.score : 0,
      judgeScore,
      reason,
      // 1s preroll — enough headroom for YouTube's keyframe seek without the
      // perceptible "started early" gap.
      playUrl: appendTimestamp(vid.url, Math.max(0, startS - 1)),
    });
  }

  hits.sort((a, b) => {
    const dj = b.judgeScore - a.judgeScore;
    if (Math.abs(dj) > 0.001) return dj;
    return b.semanticScore - a.semanticScore;
  });

  // Collapse duplicate-group sessions to a single card. The dedup script clusters
  // sessions whose conversation identity matches (same attendee, same Q&A, even
  // when re-published as a short clipped out of a long workshop). Editors want
  // ONE card per real conversation. Within a group: prefer the higher-judge
  // hit; on a tie, prefer the SHORTER session (more clip-ready, less scrubbing).
  const seenGroups = new Set<number>();
  const deduped: SessionHit[] = [];
  for (const h of hits) {
    const meta = videoByS.get(h.sessionId);
    const gid = meta?.dupGroupId ?? null;
    if (gid != null) {
      if (seenGroups.has(gid)) {
        const priorIdx = deduped.findIndex(
          (d) => videoByS.get(d.sessionId)?.dupGroupId === gid,
        );
        if (priorIdx >= 0) {
          const prior = deduped[priorIdx];
          const priorDur = videoByS.get(prior.sessionId)?.durationS ?? Infinity;
          const thisDur = meta?.durationS ?? Infinity;
          if (
            Math.abs(prior.judgeScore - h.judgeScore) < 0.001 &&
            thisDur < priorDur
          ) {
            deduped[priorIdx] = h;
          }
        }
        continue;
      }
      seenGroups.add(gid);
    }
    deduped.push(h);
  }

  // Same-video, same-person collapse. When segmentation produces two sessions
  // of the same attendee inside one long video (a brief Alex/other turn split
  // them), don't surface both — the editor wants the one that encapsulates
  // more of that person. Rule: same video_id + same attendee_cluster_id,
  // drop all but the longest-duration session. The longer form's transcript
  // covers the shorter form's content by construction.
  const longestByPerson = new Map<string, SessionHit>();
  for (const h of deduped) {
    const meta = videoByS.get(h.sessionId);
    const cid = meta?.attendeeClusterId;
    if (cid == null) {
      // Shorts have null cluster id (single attendee per video) — keep as-is.
      const key = `solo:${h.sessionId}`;
      longestByPerson.set(key, h);
      continue;
    }
    const key = `${h.videoId}::${cid}`;
    const prior = longestByPerson.get(key);
    if (!prior) {
      longestByPerson.set(key, h);
      continue;
    }
    const priorDur = videoByS.get(prior.sessionId)?.durationS ?? 0;
    const thisDur = meta?.durationS ?? 0;
    if (thisDur > priorDur) longestByPerson.set(key, h);
  }
  // Preserve original judge-then-semantic ordering for the kept hits.
  const keptIds = new Set([...longestByPerson.values()].map((h) => h.sessionId));
  const sameVideoCollapsed = deduped.filter((h) => keptIds.has(h.sessionId));

  sameVideoCollapsed.length = Math.min(sameVideoCollapsed.length, k);
  return {
    query: rawQuery,
    extracted,
    hits: sameVideoCollapsed,
    usage,
    latencyMs: Date.now() - t0,
  };
}

function appendTimestamp(url: string, t: number): string {
  const seconds = Math.max(0, Math.floor(t));
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}t=${seconds}s`;
}
