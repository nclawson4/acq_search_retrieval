import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { devRoutesEnabled } from "@/lib/env";
import { searchSessions } from "@/lib/sessions";
import { usageCostUSD } from "@/lib/openai";
import type { Gender, Industry, RevenueBand, Topic } from "@/lib/taxonomy";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_QUERY_LEN = 500;
const DAILY_COST_CEILING_USD = Number(process.env.DAILY_COST_CEILING_USD ?? "5");

function parseTopicList(v: string | null): Topic[] | undefined {
  if (!v) return undefined;
  const parts = v.split(",").map((s) => s.trim()).filter(Boolean) as Topic[];
  return parts.length > 0 ? parts : undefined;
}

async function dailySpendUSD(): Promise<number> {
  const rows = (await sql()`
    select coalesce(sum(cost_usd), 0)::float as total
    from query_log
    where queried_at >= now() - interval '24 hours'
  `) as Array<{ total: number }>;
  return Number(rows[0]?.total ?? 0);
}

export async function POST(req: Request) {
  if (!devRoutesEnabled()) return new Response(null, { status: 404 });
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const query = String(body.query ?? "").trim().slice(0, MAX_QUERY_LEN);
  const industry = (body.industry as Industry | null | undefined) ?? null;
  const gender = (body.gender as Gender | null | undefined) ?? null;
  const topics = (Array.isArray(body.topics) ? body.topics : []) as Topic[];
  const k = Math.min(50, Math.max(1, Number(body.k ?? 10)));

  // Revenue: prefer the new revenue_bands array. Fall back to the legacy
  // single revenue_band for clients that haven't migrated.
  const rawBands = Array.isArray(body.revenue_bands) ? body.revenue_bands : [];
  let revenueBands = rawBands.filter(
    (b: unknown): b is RevenueBand => typeof b === "string",
  ) as RevenueBand[];
  if (revenueBands.length === 0 && typeof body.revenue_band === "string") {
    revenueBands = [body.revenue_band as RevenueBand];
  }

  if (!query && !industry && revenueBands.length === 0 && !gender && topics.length === 0) {
    return NextResponse.json({ error: "Provide query or at least one filter" }, { status: 400 });
  }

  // Daily cost ceiling — defends a public demo from cost-exhaustion abuse.
  const spent = await dailySpendUSD();
  if (spent >= DAILY_COST_CEILING_USD) {
    return NextResponse.json(
      {
        error: "Daily cost ceiling reached. Search will resume tomorrow.",
        spent_usd: spent,
        cap_usd: DAILY_COST_CEILING_USD,
      },
      { status: 429 },
    );
  }

  try {
    const result = await searchSessions({
      query,
      k,
      filters: { industry, revenueBands, gender, topics },
    });
    const costUSD = usageCostUSD(result.usage);

    // Fire-and-forget telemetry insert. Doesn't block the response.
    sql()`
      insert into query_log
        (query_text, n_results, latency_ms, cost_usd,
         llm_tokens_input, llm_tokens_output, embed_tokens)
      values
        (${query}, ${result.hits.length}, ${result.latencyMs}, ${costUSD},
         ${result.usage.input}, ${result.usage.output}, ${result.usage.embed})
    `.catch(() => undefined);

    return NextResponse.json(
      {
        query: result.query,
        extracted: result.extracted,
        hits: result.hits,
        meta: {
          latency_ms: result.latencyMs,
          cost_usd: costUSD,
          tokens: result.usage,
          k,
        },
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "search failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET variant kept for convenience: same shape, query params instead of body.
export async function GET(req: Request) {
  if (!devRoutesEnabled()) return new Response(null, { status: 404 });
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  const body = {
    query: q,
    industry: searchParams.get("industry") || null,
    revenue_band: searchParams.get("revenue_band") || null,
    gender: searchParams.get("gender") || null,
    topics: parseTopicList(searchParams.get("topics")) ?? [],
    k: Number(searchParams.get("k") ?? "10"),
  };
  return POST(
    new Request(req.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}
