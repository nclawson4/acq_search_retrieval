// Cron-targeted health probe.
//
// Vercel cron pings this hourly (see vercel.json). On each call we:
//   1. Probe every external dependency in parallel (Postgres, Qdrant, OpenAI, Redis)
//   2. Persist the snapshot to `health_checks` (CREATE TABLE IF NOT EXISTS, no
//      manual migration step needed for a fresh deploy)
//   3. If any required dep is down, POST the snapshot to ALERT_WEBHOOK_URL
//      (Slack-style incoming webhook). Falls back to a no-op when unset so
//      the demo deploy doesn't 500 on first cron tick.
//
// Auth: if CRON_SECRET is set, the request must carry
// `Authorization: Bearer <secret>`. Vercel cron adds this automatically.
// When CRON_SECRET is unset (local dev / portfolio demo) the route is open.
// The work it does is read-only probing plus a single small INSERT.

import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { overallOk, probeAll, type DepsSnapshot } from "@/lib/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function ensureTable(): Promise<void> {
  await sql()`
    create table if not exists health_checks (
      id           bigserial primary key,
      checked_at   timestamptz default now(),
      ok           boolean not null,
      postgres_ok  boolean not null,
      qdrant_ok    boolean not null,
      openai_ok    boolean not null,
      redis_ok     boolean not null,
      snapshot     jsonb   not null
    )
  `;
  await sql()`
    create index if not exists health_checks_time_idx on health_checks(checked_at desc)
  `;
}

async function notify(snap: DepsSnapshot): Promise<{ sent: boolean; reason?: string }> {
  const hook = process.env.ALERT_WEBHOOK_URL;
  if (!hook) return { sent: false, reason: "ALERT_WEBHOOK_URL unset" };
  const down = Object.entries(snap)
    .filter(([, v]) => !v.ok)
    .map(([k, v]) => `${k}${v.error ? `: ${v.error}` : ""}`);
  if (down.length === 0) return { sent: false, reason: "nothing-to-report" };
  const payload = {
    text: `:rotating_light: Search system dep down (${down.length}): ${down.join("; ")}`,
    snapshot: snap,
    at: new Date().toISOString(),
  };
  try {
    const resp = await fetch(hook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { sent: resp.ok, reason: resp.ok ? undefined : `webhook ${resp.status}` };
  } catch (err) {
    return {
      sent: false,
      reason: err instanceof Error ? err.message : "webhook fetch failed",
    };
  }
}

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // open on demos with no secret configured
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) return new NextResponse(null, { status: 401 });

  const snap = await probeAll();
  const ok = overallOk(snap);

  // Best-effort persist. If Postgres itself is what's down, we can't write.
  // surface that to the caller in the response.
  let persisted = true;
  let persistError: string | undefined;
  try {
    await ensureTable();
    await sql()`
      insert into health_checks
        (ok, postgres_ok, qdrant_ok, openai_ok, redis_ok, snapshot)
      values
        (${ok}, ${snap.postgres.ok}, ${snap.qdrant.ok},
         ${snap.openai.ok}, ${snap.redis.ok}, ${JSON.stringify(snap)})
    `;
  } catch (err) {
    persisted = false;
    persistError = err instanceof Error ? err.message : "insert failed";
  }

  const alert = ok ? { sent: false, reason: "all-deps-ok" } : await notify(snap);

  return NextResponse.json(
    { ok, deps: snap, persisted, persistError, alert },
    {
      status: ok ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}
