// Phase 1 observability for the search hot path. Additive, fail-open, and
// default-on (set TELEMETRY=0 to mute). It does NOT touch query_log or the
// DAILY_COST_CEILING_USD breaker — those keep working byte-for-byte.
//
// Every event is written to TWO transports:
//   1. a structured JSON line to stdout (Vercel log drains capture it even if
//      the serverless function freezes the instant after responding) — this is
//      the authoritative, dependency-free record. Critically, a Postgres outage
//      cannot erase it, so "Postgres is down" is still diagnosable from logs.
//   2. a best-effort row in the trace_events table, scheduled via next/server
//      after() so it flushes before the function freezes. When after() isn't
//      available (e.g. called from an offline script) it degrades to a
//      fire-and-forget insert.
//
// Nothing here ever throws into the request path.

import { sql } from "./db";

const SERVICE = "acq-search-retrieval";

export function telemetryEnabled(): boolean {
  const v = (process.env.TELEMETRY ?? "1").trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "off" && v !== "no";
}

// 32-hex id, usable as a correlation/trace id and seeded from an inbound
// x-request-id when the proxy supplied one (cross-layer correlation).
export function newQueryId(): string {
  try {
    return crypto.randomUUID().replace(/-/g, "");
  } catch {
    return Math.random().toString(16).slice(2).padEnd(32, "0").slice(0, 32);
  }
}

export type EventStatus = "ok" | "error" | "refused";

export interface TraceEvent {
  traceId: string;
  surface: string; // search_sessions | search_moments | mcp | refusal | health
  stage: string;
  status: EventStatus;
  durationMs?: number | null;
  dep?: string | null;
  errorClass?: string | null;
  errorMessage?: string | null;
  httpStatus?: number | null;
  costUsd?: number | null;
  attributes?: Record<string, unknown>;
}

export interface ErrorInfo {
  dep: string | null;
  httpStatus: number | null;
  errorClass: string;
  errorMessage: string;
}

// Best-effort classification of a thrown value into (dependency, http status,
// class, message) — enough to tell OpenAI 429 from Qdrant timeout from a
// Postgres outage without reproducing the failure.
export function classifyError(err: unknown): ErrorInfo {
  const e = err as {
    constructor?: { name?: string };
    name?: string;
    message?: unknown;
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
  };
  const errorClass = e?.constructor?.name || e?.name || "Error";
  const errorMessage = (
    e?.message != null ? String(e.message) : String(err)
  ).slice(0, 500);
  let httpStatus: number | null = null;
  for (const cand of [e?.status, e?.statusCode, e?.response?.status]) {
    if (typeof cand === "number") {
      httpStatus = cand;
      break;
    }
  }
  let dep: string | null = null;
  const hay = `${errorClass} ${errorMessage}`.toLowerCase();
  if (hay.includes("qdrant")) dep = "qdrant";
  else if (hay.includes("redis") || hay.includes("upstash")) dep = "redis";
  else if (
    hay.includes("neon") ||
    hay.includes("postgres") ||
    hay.includes("relation ") ||
    hay.includes("econnrefused")
  )
    dep = "postgres";
  else if (
    errorClass.startsWith("API") ||
    hay.includes("openai") ||
    hay.includes("embedding") ||
    httpStatus === 429
  )
    dep = "openai";
  return { dep, httpStatus, errorClass, errorMessage };
}

function emitStdout(ev: TraceEvent): void {
  try {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        service: SERVICE,
        ...ev,
      }),
    );
  } catch {
    /* never throw from logging */
  }
}

async function insertRow(ev: TraceEvent): Promise<void> {
  try {
    await sql()`
      insert into trace_events
        (trace_id, surface, stage, status, duration_ms, dep,
         error_class, error_message, http_status, cost_usd, attributes)
      values
        (${ev.traceId}, ${ev.surface}, ${ev.stage}, ${ev.status},
         ${ev.durationMs ?? null}, ${ev.dep ?? null},
         ${ev.errorClass ?? null}, ${ev.errorMessage ?? null},
         ${ev.httpStatus ?? null}, ${ev.costUsd ?? null},
         ${JSON.stringify(ev.attributes ?? {})}::jsonb)
    `;
  } catch {
    // Table may not exist yet, or Postgres is down. The stdout line already
    // carries the event, so this is a best-effort durability bonus only.
  }
}

function persist(ev: TraceEvent): void {
  // Schedule the durable write via after() so it survives function freeze.
  // Fall back to fire-and-forget when there's no request context (scripts).
  void (async () => {
    try {
      const { after } = await import("next/server");
      after(() => insertRow(ev));
    } catch {
      void insertRow(ev);
    }
  })();
}

export function recordEvent(ev: TraceEvent): void {
  if (!telemetryEnabled()) return;
  try {
    emitStdout(ev);
    persist(ev);
  } catch {
    /* fail-open */
  }
}

export function recordError(
  surface: string,
  stage: string,
  traceId: string,
  err: unknown,
  attributes?: Record<string, unknown>,
): void {
  const info = classifyError(err);
  recordEvent({
    traceId,
    surface,
    stage,
    status: "error",
    dep: info.dep,
    httpStatus: info.httpStatus,
    errorClass: info.errorClass,
    errorMessage: info.errorMessage,
    attributes,
  });
}

// A refusal is a request turned away BEFORE the work runs (rate limit, cost
// ceiling, free-tier). These happen upstream of the search span, so without an
// explicit event they'd be invisible — the most common "search stopped working"
// outages. reason ∈ rate_limit | cost_ceiling | free_tier.
export function recordRefusal(
  traceId: string,
  reason: string,
  attributes?: Record<string, unknown>,
): void {
  recordEvent({
    traceId,
    surface: "refusal",
    stage: reason,
    status: "refused",
    attributes,
  });
}
