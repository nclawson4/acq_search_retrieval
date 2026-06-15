// Per-dependency health probes used by /api/status and /api/health/check.
// Each probe is cheap (no LLM calls), runs in parallel, and times out fast so
// one slow dep can't block the whole snapshot.

import { sql } from "./db";
import { qdrant } from "./qdrant";

export interface DepResult {
  ok: boolean;
  latency_ms: number;
  detail?: string;
  error?: string;
}

const PROBE_TIMEOUT_MS = 4000;

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`probe timed out after ${ms}ms`)), ms),
    ),
  ]);
}

async function timeIt<T>(fn: () => Promise<T>): Promise<{
  ok: boolean;
  latency_ms: number;
  value?: T;
  error?: string;
}> {
  const t0 = Date.now();
  try {
    const v = await withTimeout(fn(), PROBE_TIMEOUT_MS);
    return { ok: true, latency_ms: Date.now() - t0, value: v };
  } catch (err) {
    return {
      ok: false,
      latency_ms: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function probePostgres(): Promise<DepResult> {
  const r = await timeIt(async () => {
    const rows = (await sql()`select 1 as one`) as Array<{ one: number }>;
    if (rows[0]?.one !== 1) throw new Error("unexpected probe response");
    return null;
  });
  return { ok: r.ok, latency_ms: r.latency_ms, error: r.error };
}

export async function probeQdrant(): Promise<DepResult> {
  const r = await timeIt(async () => {
    // getCollections is a cheap auth+routing check; doesn't hit any vector data.
    const out = await qdrant().getCollections();
    return out.collections?.length ?? 0;
  });
  return {
    ok: r.ok,
    latency_ms: r.latency_ms,
    detail: r.ok ? `${r.value} collections` : undefined,
    error: r.error,
  };
}

export async function probeOpenAI(): Promise<DepResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { ok: false, latency_ms: 0, error: "OPENAI_API_KEY not set" };
  }
  const r = await timeIt(async () => {
    // /v1/models is the lightest authenticated call. Avoids any token spend
    // and returns 401 if the key is rotated/revoked.
    const resp = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!resp.ok) throw new Error(`models endpoint returned ${resp.status}`);
    return null;
  });
  return { ok: r.ok, latency_ms: r.latency_ms, error: r.error };
}

export async function probeRedis(): Promise<DepResult> {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    return {
      ok: false,
      latency_ms: 0,
      error: "Redis not configured (KV_REST_API_URL / KV_REST_API_TOKEN unset)",
    };
  }
  const r = await timeIt(async () => {
    const resp = await fetch(`${url}/ping`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) throw new Error(`ping returned ${resp.status}`);
    return null;
  });
  return { ok: r.ok, latency_ms: r.latency_ms, error: r.error };
}

export interface DepsSnapshot {
  postgres: DepResult;
  qdrant: DepResult;
  openai: DepResult;
  redis: DepResult;
}

export async function probeAll(): Promise<DepsSnapshot> {
  const [postgres, qdrantR, openai, redis] = await Promise.all([
    probePostgres(),
    probeQdrant(),
    probeOpenAI(),
    probeRedis(),
  ]);
  return { postgres, qdrant: qdrantR, openai, redis };
}

export function overallOk(snap: DepsSnapshot): boolean {
  // Redis is non-critical for search itself (rate-limiter sits in front of
  // the API but the home-page render works without it). Postgres + Qdrant +
  // OpenAI are all required for a working search.
  return snap.postgres.ok && snap.qdrant.ok && snap.openai.ok;
}
