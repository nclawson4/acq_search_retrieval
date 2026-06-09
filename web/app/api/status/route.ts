import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = (await sql()`
      select
        (select count(*) from videos) as videos,
        (select count(*) from segments) as segments,
        (select count(*) from frames) as frames,
        (select coalesce(sum(duration_s), 0) from videos) as duration_s,
        (select max(last_indexed_at) from videos) as last_indexed_at
    `) as Array<{
      videos: number;
      segments: number;
      frames: number;
      duration_s: number;
      last_indexed_at: string | null;
    }>;
    const r = rows[0];
    return NextResponse.json(
      {
        ok: true,
        videos: Number(r.videos),
        segments: Number(r.segments),
        frames: Number(r.frames),
        hours_indexed: Number(r.duration_s) / 3600,
        last_indexed_at: r.last_indexed_at,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}
