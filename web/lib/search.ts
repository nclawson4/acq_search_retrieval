import { sql } from "./db";
import { embedQuery } from "./embed";
import { COLLECTION_SEGMENTS } from "./env";
import { hypotheticalAnswer } from "./hyde";
import { qdrant } from "./qdrant";

export interface SearchHit {
  videoId: string;
  videoTitle: string;
  videoUrl: string;
  channel: string;
  startS: number;
  endS: number;
  text: string;
  score: number;
  frameUrl: string | null;
  playUrl: string;
}

export interface SearchOptions {
  query: string;
  k?: number;
  videoId?: string;
}

const DEFAULT_K = 10;
const MAX_K = 50;
const DEDUPE_WINDOW_S = 15; // collapse overlapping moments from the same video within this window
const OVERFETCH = 3; // request OVERFETCH × k from Qdrant so dedupe can still return k

export async function searchMoments(opts: SearchOptions): Promise<SearchHit[]> {
  const k = Math.min(Math.max(1, opts.k ?? DEFAULT_K), MAX_K);
  if (!opts.query || !opts.query.trim()) return [];

  // HyDE: rewrite the user query into a hypothetical spoken-style answer before
  // embedding. Closes the vocab gap between conversational speech and the way
  // people phrase questions. Falls back to the raw query if the rewrite fails.
  let embedTarget = opts.query.trim();
  try {
    embedTarget = await hypotheticalAnswer(opts.query.trim());
  } catch {
    // keep raw query
  }
  const queryVec = await embedQuery(embedTarget);

  const filter = opts.videoId
    ? { must: [{ key: "video_id", match: { value: opts.videoId } }] }
    : undefined;

  const points = await qdrant().query(COLLECTION_SEGMENTS, {
    query: queryVec,
    limit: k * OVERFETCH,
    with_payload: true,
    filter,
  });

  if (!points.points.length) return [];

  const pointIds = points.points.map((p) => String(p.id));
  const rows = (await sql()`
    select
      s.qdrant_point_id::text as point_id,
      s.video_id,
      s.start_s,
      s.end_s,
      s.text,
      v.title,
      v.channel,
      v.url,
      (
        select f.blob_url from frames f
        where f.video_id = s.video_id
        order by abs(f.t_s - (s.start_s + s.end_s) / 2)
        limit 1
      ) as frame_url
    from segments s
    join videos v on v.id = s.video_id
    where s.qdrant_point_id::text = any(${pointIds}::text[])
  `) as Record<string, unknown>[];

  const byPoint = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    byPoint.set(String(row.point_id), row);
  }

  const all: SearchHit[] = [];
  for (const p of points.points) {
    const row = byPoint.get(String(p.id));
    if (!row) continue;
    const startS = Number(row.start_s);
    const videoUrl = String(row.url);
    all.push({
      videoId: String(row.video_id),
      videoTitle: String(row.title ?? ""),
      videoUrl,
      channel: String(row.channel ?? ""),
      startS,
      endS: Number(row.end_s),
      text: String(row.text),
      score: typeof p.score === "number" ? p.score : 0,
      frameUrl: row.frame_url ? String(row.frame_url) : null,
      playUrl: appendTimestamp(videoUrl, startS),
    });
  }

  return dedupeByWindow(all, DEDUPE_WINDOW_S).slice(0, k);
}

function dedupeByWindow(hits: SearchHit[], windowS: number): SearchHit[] {
  // Walk in rank order; suppress any hit whose midpoint is within windowS of
  // a higher-ranked hit from the same video.
  const kept: SearchHit[] = [];
  for (const h of hits) {
    const mid = (h.startS + h.endS) / 2;
    const tooClose = kept.some(
      (prev) =>
        prev.videoId === h.videoId &&
        Math.abs((prev.startS + prev.endS) / 2 - mid) < windowS,
    );
    if (!tooClose) kept.push(h);
  }
  return kept;
}

function appendTimestamp(url: string, t: number): string {
  const seconds = Math.max(0, Math.floor(t));
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}t=${seconds}s`;
}
