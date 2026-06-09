import { sql } from "./db";
import { embedQuery } from "./embed";
import { COLLECTION_SEGMENTS } from "./env";
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

export async function searchMoments(opts: SearchOptions): Promise<SearchHit[]> {
  const k = Math.min(Math.max(1, opts.k ?? DEFAULT_K), MAX_K);
  if (!opts.query || !opts.query.trim()) return [];

  const queryVec = await embedQuery(opts.query.trim());

  const filter = opts.videoId
    ? { must: [{ key: "video_id", match: { value: opts.videoId } }] }
    : undefined;

  const points = await qdrant().query(COLLECTION_SEGMENTS, {
    query: queryVec,
    limit: k,
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

  const hits: SearchHit[] = [];
  for (const p of points.points) {
    const row = byPoint.get(String(p.id));
    if (!row) continue;
    const startS = Number(row.start_s);
    const videoUrl = String(row.url);
    hits.push({
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
  return hits;
}

function appendTimestamp(url: string, t: number): string {
  const seconds = Math.max(0, Math.floor(t));
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}t=${seconds}s`;
}
