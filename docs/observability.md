# Observability — finalized plan & Phase 1 implementation

This service already had health probes, an hourly cron, `query_log` cost
telemetry, and the `DAILY_COST_CEILING_USD` breaker — but no request tracing and
no visibility into the upstream refusals that cause most "search stopped working"
reports. This document is the finalized plan plus what Phase 1 ships.

## Principles (all honored by the code)

- **Additive & fail-open.** Telemetry never throws into the request path.
- **`query_log` and the cost ceiling are untouched.** The new layer writes to a
  separate `trace_events` table, so the cost-row insert that the ceiling depends
  on keeps working byte-for-byte.
- **Default-on with a kill switch.** Set `TELEMETRY=0` to mute.
- **Stdout is authoritative.** Every event is written to stdout (captured by
  Vercel log drains) *and* best-effort to Postgres — so a Postgres outage, the
  one failure that would erase the trace table, is still diagnosable from logs.

## What Phase 1 implements

1. **Correlation id end-to-end.** `proxy.ts` stamps an `x-request-id` on every
   forwarded request; `app/page.tsx` seeds the search `queryId` from it; the
   same id is the `trace_id` on every event.
2. **Search trace.** `lib/sessions.ts` records a `complete` event per search with
   per-stage timings (extract / embed / qdrant / judge), candidate + hit counts,
   token usage, cost, and a `judgeResultsCount` that exposes the "judge returned
   nothing" failure (which the user only feels as zero hits).
3. **Refusal events** — the highest-value gap. Rate-limit (503/429 in `proxy.ts`),
   cost-ceiling, and free-tier rejections happen *before* the search span, so
   they were invisible. They now emit explicit `refusal` events.
4. **Error events** classify the failing dependency (openai / qdrant / postgres /
   redis) and HTTP status so OpenAI 429 vs Qdrant timeout vs a Postgres outage
   are distinguishable without a repro.
5. **Offline ingest** gets a stdlib structured logger (`ingest/observability.py`):
   `ingest.run.start/done` + per-video ok/error with a `run_id`.

## Review must-fixes incorporated

- **B1:** `query_log` / `logQueryCost` are not modified; the cost ceiling can't be
  silently broken by a telemetry-column miss.
- **B2:** `trace_events` is created **only** in `ingest/schema.sql` (offline,
  single-writer) — never via per-request `CREATE TABLE` on the hot path.
- **B3:** new `SessionSearchResult.queryId` / `SessionSearchOptions.queryId` are
  optional; the build stays green.
- **B5:** durable writes go through `next/server` `after()` so they flush before
  the function freezes; the stdout line is the freeze-proof fallback.
- **D2/D3/D6:** refusals are recorded and the edge `x-request-id` correlates to
  the search `queryId`.

## Migration

`trace_events` ships in `ingest/schema.sql`. Apply it the same way the other
tables are provisioned (the ingest pipeline's `apply_schema`, or run the new
`create table if not exists trace_events ...` block against Neon). Until applied,
the durable insert no-ops and stdout still carries every event.

## Diagnose a failure (examples)

```sql
-- OpenAI 429 by stage
select stage, count(*) from trace_events
where status='error' and dep='openai' and http_status=429 group by stage;

-- "search stopped working" — was it a refusal?
select stage, count(*) from trace_events where status='refused' group by stage;

-- judge returned garbage (zero results from non-empty input)
select trace_id, attributes->>'judgeInputCount', attributes->>'judgeResultsCount'
from trace_events where stage='complete'
and (attributes->>'judgeResultsCount')::int = 0
and (attributes->>'judgeInputCount')::int > 0;
```

## Deferred (Phase 2/3)

OpenTelemetry spans + OTLP export via `@vercel/otel` (verify the Next 16
instrumentation hook against `node_modules/next/dist/docs` first), moving the
spend `SUM` off the hot path, and alert-on-approaching-ceiling.
