// Shared per-query cost telemetry + daily spend ceiling.
//
// Both the production homepage search path (app/page.tsx -> searchSessions)
// and the dev-gated /api/search/sessions route use these helpers so the cost
// guard is enforced identically everywhere. The ceiling defends a public demo
// against cost-exhaustion abuse.

import { sql } from "./db";
import { usageCostUSD, type TokenUsage } from "./openai";

// Hard daily ceiling on LLM + embedding spend. Defaults to $5 when the env
// var is unset.
export const DAILY_COST_CEILING_USD = Number(
  process.env.DAILY_COST_CEILING_USD ?? "5",
);

// Rolling 24h spend pulled from query_log. Defensive: any DB error returns 0
// (fail OPEN on the read) so a transient Postgres blip never hard-blocks
// search. The ceiling is a cost guard, not a security control.
export async function dailySpendUSD(): Promise<number> {
  try {
    const rows = (await sql()`
      select coalesce(sum(cost_usd), 0)::float as total
      from query_log
      where queried_at >= now() - interval '24 hours'
    `) as Array<{ total: number }>;
    return Number(rows[0]?.total ?? 0);
  } catch {
    return 0;
  }
}

// True when the rolling 24h spend has already met or exceeded the ceiling.
export async function isOverDailyCeiling(): Promise<boolean> {
  const spent = await dailySpendUSD();
  return spent >= DAILY_COST_CEILING_USD;
}

// Fire-and-forget per-query cost telemetry. Never throws: a failure here must
// not break search. Returns the computed cost for callers that want it.
export function logQueryCost(args: {
  query: string;
  nResults: number;
  latencyMs: number;
  usage: TokenUsage;
}): number {
  const costUSD = usageCostUSD(args.usage);
  try {
    void sql()`
      insert into query_log
        (query_text, n_results, latency_ms, cost_usd,
         llm_tokens_input, llm_tokens_output, embed_tokens)
      values
        (${args.query}, ${args.nResults}, ${args.latencyMs}, ${costUSD},
         ${args.usage.input}, ${args.usage.output}, ${args.usage.embed})
    `.catch(() => undefined);
  } catch {
    // Synchronous failure constructing the query: swallow.
  }
  return costUSD;
}
