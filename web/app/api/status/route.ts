import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { overallOk, probeAll } from "@/lib/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // Corpus snapshot + per-dependency probes run in parallel. A Qdrant or
  // OpenAI outage shouldn't prevent us from reporting Postgres-backed counts.
  const [corpus, deps] = await Promise.all([
    sql()`
      select
        (select count(*) from videos) as videos,
        (select count(*) from segments) as segments,
        (select count(*) from frames) as frames,
        (select coalesce(sum(duration_s), 0) from videos) as duration_s,
        (select max(last_indexed_at) from videos) as last_indexed_at
    `.then(
      (rows) =>
        (rows as Array<Record<string, unknown>>)[0] ?? {},
      (err: unknown) => ({
        __error:
          err instanceof Error ? err.message : "corpus query failed",
      }),
    ),
    probeAll(),
  ]);

  const corpusErr = (corpus as { __error?: string }).__error;
  const ok = !corpusErr && overallOk(deps);
  const r = corpus as Record<string, unknown>;

  return NextResponse.json(
    {
      ok,
      videos: corpusErr ? null : Number(r.videos),
      segments: corpusErr ? null : Number(r.segments),
      frames: corpusErr ? null : Number(r.frames),
      hours_indexed: corpusErr ? null : Number(r.duration_s) / 3600,
      last_indexed_at: corpusErr ? null : (r.last_indexed_at as string | null),
      deps,
      ...(corpusErr ? { error: corpusErr } : {}),
    },
    {
      status: ok ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}
