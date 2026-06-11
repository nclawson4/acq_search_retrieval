import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { devRoutesEnabled } from "@/lib/env";
import type { Gender, Industry, RevenueBand, Topic } from "@/lib/taxonomy";

export const runtime = "nodejs";

export async function GET() {
  if (!devRoutesEnabled()) return new Response(null, { status: 404 });
  const rows = (await sql()`
    select q.id, q.query_text, q.expected_industry, q.expected_revenue,
           q.expected_topics, q.expected_gender, q.notes, q.created_at,
           (select count(*) from eval_labels where query_id = q.id) as label_count
    from eval_queries q
    order by q.created_at desc
  `) as Record<string, unknown>[];
  return NextResponse.json({ queries: rows });
}

export async function POST(req: Request) {
  if (!devRoutesEnabled()) return new Response(null, { status: 404 });
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const queryText = String(body.query_text ?? "").trim().slice(0, 500);
  if (!queryText) return NextResponse.json({ error: "query_text required" }, { status: 400 });

  const expectedIndustry = (body.expected_industry as Industry | null | undefined) ?? null;
  const expectedRevenue = (body.expected_revenue as RevenueBand | null | undefined) ?? null;
  const expectedTopics = (Array.isArray(body.expected_topics) ? body.expected_topics : []) as Topic[];
  const expectedGender = (body.expected_gender as Gender | null | undefined) ?? null;
  const notes = String(body.notes ?? "").slice(0, 500);

  const rows = (await sql()`
    insert into eval_queries
      (query_text, expected_industry, expected_revenue, expected_topics, expected_gender, notes)
    values
      (${queryText}, ${expectedIndustry}, ${expectedRevenue}, ${expectedTopics}, ${expectedGender}, ${notes})
    returning id, query_text, created_at
  `) as Array<{ id: number; query_text: string; created_at: string }>;

  return NextResponse.json({ query: rows[0] }, { status: 201 });
}
