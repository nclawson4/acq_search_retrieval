import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { devRoutesEnabled } from "@/lib/env";
import { searchSessions } from "@/lib/sessions";
import { usageCostUSD, type TokenUsage } from "@/lib/openai";

export const runtime = "nodejs";
export const maxDuration = 300;

const K_FOR_RECALL = 10;
const K_FOR_PRECISION = 5;

interface PerQueryResult {
  query_id: number;
  query_text: string;
  rank_of_first_relevant: number | null;
  precision_at_5: number;
  recall_relevant_in_topk: number;
  hits: Array<{
    session_id: number;
    judge_score: number;
    relevance: "relevant" | "partial" | "not_relevant" | null;
  }>;
}

interface RunReport {
  ran_at: string;
  total_queries: number;
  precision_at_5: number;
  recall_at_10: number;
  mrr: number;
  total_cost_usd: number;
  total_latency_ms: number;
  per_query: PerQueryResult[];
}

export async function POST() {
  if (!devRoutesEnabled()) return new Response(null, { status: 404 });
  const queries = (await sql()`
    select q.id, q.query_text, q.expected_industry, q.expected_revenue,
           q.expected_topics, q.expected_gender,
           coalesce(
             (select json_agg(json_build_object(
                'session_id', l.session_id,
                'relevance', l.relevance
             )) from eval_labels l where l.query_id = q.id),
             '[]'::json
           ) as labels
    from eval_queries q
    order by q.id
  `) as Array<{
    id: number;
    query_text: string;
    expected_industry: string | null;
    expected_revenue: string | null;
    expected_topics: string[] | null;
    expected_gender: string | null;
    labels: Array<{ session_id: number; relevance: string }>;
  }>;

  if (queries.length === 0) {
    return NextResponse.json({ error: "No gold queries yet — build the set first." }, { status: 400 });
  }

  let totalCost = 0;
  let totalLatency = 0;
  let sumPrecAt5 = 0;
  let sumRecall = 0;
  let sumRR = 0; // for MRR

  const perQuery: PerQueryResult[] = [];

  for (const q of queries) {
    const labels = new Map<number, "relevant" | "partial" | "not_relevant">();
    for (const l of q.labels ?? []) {
      labels.set(l.session_id, l.relevance as never);
    }
    const relevantSet = new Set(
      [...labels.entries()].filter(([, r]) => r === "relevant").map(([s]) => s),
    );

    const r = await searchSessions({
      query: q.query_text,
      k: K_FOR_RECALL,
    });
    totalLatency += r.latencyMs;
    totalCost += usageCostUSD(r.usage as TokenUsage);

    const hitSessionIds = r.hits.map((h) => h.sessionId);
    let firstRelevantRank: number | null = null;
    for (let i = 0; i < hitSessionIds.length; i++) {
      if (relevantSet.has(hitSessionIds[i])) {
        firstRelevantRank = i + 1;
        break;
      }
    }
    const precAt5 =
      relevantSet.size === 0
        ? 0
        : hitSessionIds.slice(0, K_FOR_PRECISION).filter((s) => relevantSet.has(s)).length /
          K_FOR_PRECISION;
    const recall =
      relevantSet.size === 0
        ? 0
        : hitSessionIds.slice(0, K_FOR_RECALL).filter((s) => relevantSet.has(s)).length /
          relevantSet.size;
    const rr = firstRelevantRank ? 1.0 / firstRelevantRank : 0;
    sumPrecAt5 += precAt5;
    sumRecall += recall;
    sumRR += rr;

    perQuery.push({
      query_id: q.id,
      query_text: q.query_text,
      rank_of_first_relevant: firstRelevantRank,
      precision_at_5: precAt5,
      recall_relevant_in_topk: recall,
      hits: r.hits.map((h) => ({
        session_id: h.sessionId,
        judge_score: h.judgeScore,
        relevance: labels.get(h.sessionId) ?? null,
      })),
    });
  }

  const n = queries.length;
  const report: RunReport = {
    ran_at: new Date().toISOString(),
    total_queries: n,
    precision_at_5: sumPrecAt5 / n,
    recall_at_10: sumRecall / n,
    mrr: sumRR / n,
    total_cost_usd: totalCost,
    total_latency_ms: totalLatency,
    per_query: perQuery,
  };

  // Persist a summary into eval_runs (reuse the existing table).
  await sql()`
    insert into eval_runs (recall_at_5, recall_at_10, mrr, details)
    values (${report.precision_at_5}, ${report.recall_at_10}, ${report.mrr}, ${JSON.stringify(report)}::jsonb)
  `;

  return NextResponse.json(report);
}

export async function GET() {
  if (!devRoutesEnabled()) return new Response(null, { status: 404 });
  const rows = (await sql()`
    select id, ran_at, recall_at_5, recall_at_10, mrr
    from eval_runs
    order by ran_at desc
    limit 50
  `) as Array<{ id: number; ran_at: string; recall_at_5: number; recall_at_10: number; mrr: number }>;
  return NextResponse.json({ runs: rows });
}
