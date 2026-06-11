import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { devRoutesEnabled } from "@/lib/env";

export const runtime = "nodejs";

const VALID = new Set(["relevant", "partial", "not_relevant"]);

export async function POST(req: Request) {
  if (!devRoutesEnabled()) return new Response(null, { status: 404 });
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const queryId = Number(body.query_id);
  const sessionId = Number(body.session_id);
  const rank = body.rank == null ? null : Number(body.rank);
  const relevance = String(body.relevance ?? "");
  if (!Number.isFinite(queryId) || !Number.isFinite(sessionId)) {
    return NextResponse.json({ error: "query_id and session_id required" }, { status: 400 });
  }
  if (!VALID.has(relevance)) {
    return NextResponse.json({ error: "relevance must be relevant|partial|not_relevant" }, { status: 400 });
  }

  await sql()`
    insert into eval_labels (query_id, session_id, relevance, rank)
    values (${queryId}, ${sessionId}, ${relevance}, ${rank})
    on conflict (query_id, session_id) do update set
      relevance = excluded.relevance,
      rank = excluded.rank,
      labeled_at = now()
  `;
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  if (!devRoutesEnabled()) return new Response(null, { status: 404 });
  const { searchParams } = new URL(req.url);
  const queryId = Number(searchParams.get("query_id"));
  const sessionId = Number(searchParams.get("session_id"));
  if (!Number.isFinite(queryId) || !Number.isFinite(sessionId)) {
    return NextResponse.json({ error: "query_id and session_id required" }, { status: 400 });
  }
  await sql()`delete from eval_labels where query_id = ${queryId} and session_id = ${sessionId}`;
  return NextResponse.json({ ok: true });
}
