import { sql } from "./db";
import { embedQuery } from "./embed";
import { COLLECTION_MOMENTS } from "./env";
import { hypotheticalAnswer } from "./hyde";
import { qdrant } from "./qdrant";

export type SpeakerMode = "answer" | "question" | "both";

export interface SearchHit {
  videoId: string;
  videoTitle: string;
  videoUrl: string;
  channel: string;
  // The full Q→A pair.
  qStartS: number;
  qEndS: number;
  qText: string;
  aStartS: number;
  aEndS: number;
  aText: string;
  // Which side this hit matched on (the one shown in the result list).
  matchedKind: "answer" | "question";
  score: number;
  // Attendee context filters and clip quality.
  industry: string | null;
  revenueBand: string | null;
  problems: string[];
  audioQuality: number | null;
  clipScore: number | null;
  frameUrl: string | null;
  // YouTube link timestamped to the start of the question (or answer if questions filtered out).
  playUrl: string;
}

export interface SearchOptions {
  query: string;
  k?: number;
  videoId?: string;
  // Which side of the Q→A pair the embedding match runs against. Default: answer.
  speaker?: SpeakerMode;
  industry?: string | null;
  revenueBand?: string | null;
  problems?: string[];
  minAudioQuality?: number;
}

const DEFAULT_K = 10;
const MAX_K = 50;
const OVERFETCH = 4;

export interface SearchResult {
  hits: SearchHit[];
}

export async function searchMoments(opts: SearchOptions): Promise<SearchResult> {
  const k = Math.min(Math.max(1, opts.k ?? DEFAULT_K), MAX_K);
  if (!opts.query || !opts.query.trim()) return { hits: [] };
  // Match both sides of the Q&A pair by default — persona phrasing
  // ("ecommerce founder", "med spa owner") lives in the question text, not
  // Alex's reply, so single-sided answer-only matching misses it.
  const speaker = opts.speaker ?? "both";

  const rawQuery = opts.query.trim();
  const embedTarget = await hypotheticalAnswer(rawQuery).catch(() => rawQuery);
  const queryVec = await embedQuery(embedTarget);

  // Only structured filters explicitly passed by the caller (or required
  // invariants like video_id / speaker side) get applied. Free-text intent
  // mapping is handled by the embedding, not regex layers.
  const must: Array<Record<string, unknown>> = [];
  if (opts.videoId) must.push({ key: "video_id", match: { value: opts.videoId } });
  if (speaker !== "both") must.push({ key: "kind", match: { value: speaker } });
  if (opts.industry) must.push({ key: "industry", match: { value: opts.industry } });
  if (opts.revenueBand) must.push({ key: "revenue_band", match: { value: opts.revenueBand } });
  if (opts.problems && opts.problems.length > 0) {
    must.push({ key: "problems", match: { any: opts.problems } });
  }
  if (opts.minAudioQuality && opts.minAudioQuality > 0) {
    must.push({ key: "audio_quality", range: { gte: opts.minAudioQuality } });
  }
  const filter = must.length > 0 ? { must } : undefined;

  const points = await qdrant().query(COLLECTION_MOMENTS, {
    query: queryVec,
    limit: k * OVERFETCH,
    with_payload: true,
    filter,
  });
  if (!points.points.length) return { hits: [] };

  // We need the Q + A text for whichever Qdrant point matched. Each point has
  // a payload.pair_qdrant_id pointing at the OTHER side of the same moment.
  // Look up the moments row by either a_qdrant_point_id or q_qdrant_point_id.
  const matchedIds = points.points.map((p) => String(p.id));
  const rows = (await sql()`
    select
      m.id,
      m.video_id,
      m.q_start_s, m.q_end_s, m.q_text,
      m.a_start_s, m.a_end_s, m.a_text,
      m.industry, m.revenue_band, m.problems,
      m.audio_quality, m.clip_score,
      m.a_qdrant_point_id::text as a_point_id,
      m.q_qdrant_point_id::text as q_point_id,
      v.title, v.channel, v.url,
      (
        select f.blob_url from frames f
        where f.video_id = m.video_id
        order by abs(f.t_s - (m.a_start_s + m.a_end_s) / 2)
        limit 1
      ) as frame_url
    from moments m
    join videos v on v.id = m.video_id
    where m.a_qdrant_point_id::text = any(${matchedIds}::text[])
       or m.q_qdrant_point_id::text = any(${matchedIds}::text[])
  `) as Record<string, unknown>[];

  const byPointId = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    byPointId.set(String(r.a_point_id), r);
    byPointId.set(String(r.q_point_id), r);
  }

  // Walk hits in score order. Dedupe by moment id so a single moment doesn't
  // appear twice when speaker="both" surfaces both sides.
  const seenMomentIds = new Set<string>();
  const hits: SearchHit[] = [];
  for (const p of points.points) {
    const row = byPointId.get(String(p.id));
    if (!row) continue;
    const momentId = String(row.id);
    if (seenMomentIds.has(momentId)) continue;
    seenMomentIds.add(momentId);

    const qStartS = Number(row.q_start_s);
    const matchedKind: "answer" | "question" =
      String(p.id) === String(row.a_point_id) ? "answer" : "question";
    const videoUrl = String(row.url);

    hits.push({
      videoId: String(row.video_id),
      videoTitle: String(row.title ?? ""),
      videoUrl,
      channel: String(row.channel ?? ""),
      qStartS,
      qEndS: Number(row.q_end_s),
      qText: String(row.q_text),
      aStartS: Number(row.a_start_s),
      aEndS: Number(row.a_end_s),
      aText: String(row.a_text),
      matchedKind,
      score: typeof p.score === "number" ? p.score : 0,
      industry: row.industry ? String(row.industry) : null,
      revenueBand: row.revenue_band ? String(row.revenue_band) : null,
      problems: Array.isArray(row.problems) ? (row.problems as string[]) : [],
      audioQuality:
        row.audio_quality !== null && row.audio_quality !== undefined
          ? Number(row.audio_quality)
          : null,
      clipScore:
        row.clip_score !== null && row.clip_score !== undefined ? Number(row.clip_score) : null,
      frameUrl: row.frame_url ? String(row.frame_url) : null,
      playUrl: appendTimestamp(videoUrl, qStartS),
    });
    if (hits.length >= k) break;
  }
  return { hits };
}

function appendTimestamp(url: string, t: number): string {
  const seconds = Math.max(0, Math.floor(t));
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}t=${seconds}s`;
}
