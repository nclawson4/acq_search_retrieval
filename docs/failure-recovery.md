# Failure recovery

The system has four external dependencies and one internal cost circuit. Each can fail. This document is the runbook.

## Dependencies and what happens when each fails

| Dep | Used for | Failure mode | What happens today |
|---|---|---|---|
| Neon Postgres | Session metadata, video titles, cost ledger | DB unreachable | `searchSessions` throws; UI shows the generic error page (`app/error.tsx`); cron health check sees `postgres_ok=false` and (if `ALERT_WEBHOOK_URL` set) posts an alert |
| Qdrant Cloud | Dense vector retrieval | API down or auth rotated | `searchSessions` throws on the `.query()` call; same UX as above; cron health check sees `qdrant_ok=false` |
| OpenAI API | Filter extractor, judge re-rank, embeddings | Provider outage / 5xx / 429 | Surfaces as a thrown error mid-pipeline; same UX as above |
| Upstash Redis | Per-IP rate limit + anonymous free-tier counter | KV unreachable | `proxy.ts` is **fail-closed**: every rate-limited path returns 503 with `x-ratelimit-scope: unavailable`. Home page renders, but new searches are refused until KV recovers |

## What's in place

- **Fail-closed rate limiter** (`proxy.ts`): if Redis can't be reached, search APIs return 503 rather than letting traffic through unmetered.
- **Daily cost ceiling** (`app/api/search/sessions/route.ts`): rolling 24h sum from `query_log`; once `DAILY_COST_CEILING_USD` is hit the route returns 429 until midnight. This is the financial circuit breaker against runaway OpenAI spend.
- **Per-IP free tier** (`lib/searchGate.ts`): anonymous IPs get 5 free searches per 24h before being bounced to `/login`. Backed by Redis with 24h TTL.
- **User-facing error page** (`app/error.tsx`): one-click retry, link home. Doesn't leak stack traces.
- **Cost telemetry** (`query_log`): every search writes tokens + cost + latency. Feeds the ceiling, available for ad-hoc forensics.
- **Per-dependency health probes** (`lib/health.ts`): cheap probes against Postgres, Qdrant, OpenAI, Redis with a 4s timeout per probe. Run in parallel.
- **`/api/status` snapshot**: returns the live `deps` snapshot alongside corpus stats. Returns 503 if any required dep is down.
- **Hourly cron probe** (`/api/health/check`, scheduled via `vercel.json`): runs the probes, persists each tick to `health_checks` (jsonb snapshot for forensic replay), and POSTs to `ALERT_WEBHOOK_URL` (Slack-compatible) if any required dep is down. `CRON_SECRET` gates the route in prod.

## Known limitations and roadmap

The following are intentional gaps before this is production-grade for a team's primary editing workflow:

1. **No paging tier.** Webhook → Slack is good for "we noticed something." A real on-call rotation needs PagerDuty/Opsgenie escalation when no human acks within N minutes.
2. **Hourly probe is too coarse for SLOs.** Pro Vercel allows down-to-the-minute schedules; a 1-minute cron with a 3-strike rule (alert after 3 consecutive failures) gives ~3 min detection on a 99.9% SLO without alert spam from blips.
3. **No synthetic-search canary.** The current probes verify *reachability*. They don't catch silent quality regressions (e.g., judge model swapped, embedding model deprecated). A nightly job that runs the 10 demo queries and diffs top-1 vs. a snapshot would catch this.
4. **Cost ceiling is per-day, not per-hour.** A bot blasting 5,000 requests in the first hour exhausts the day's budget before any human reacts. An hourly soft ceiling + a daily hard ceiling would be safer.
5. **No public status page.** A `/status` web page reading `health_checks` for the last 24h would let consumers (the editing team) self-serve "is it me or the service?" without DMing engineering.
6. **No runtime fallback when OpenAI is down.** The judge is the most expensive stage; bypassing it on 5xx errors would degrade gracefully (return semantic-rank-only results) instead of failing closed.

## On-call quick reference

- **Search returns 500s, error message includes "qdrant":** check Qdrant Cloud status page; verify `QDRANT_URL` / `QDRANT_API_KEY` env vars haven't been rotated.
- **Search returns 500s, error message includes "openai" or "rate":** check OpenAI status; verify key isn't past spend cap; consider raising `DAILY_COST_CEILING_USD` if legitimately exhausted.
- **All search APIs returning 503 with `x-ratelimit-scope: unavailable`:** Upstash Redis is down. Search is intentionally refused; this is the fail-closed posture. Restore KV before re-enabling.
- **`/api/health/check` keeps showing `postgres_ok=false`:** Neon is the source of truth. Without it there are no titles or playable URLs. Restore Neon before anything else.
- **`/api/status` shows `last_indexed_at` more than 7 days old:** the ingest pipeline has not been re-run; new content is missing from search results.
