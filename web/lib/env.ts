function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const OPENAI_API_KEY = () => required("OPENAI_API_KEY");
export const QDRANT_URL = () => required("QDRANT_URL");
export const QDRANT_API_KEY = () => required("QDRANT_API_KEY");
export const DATABASE_URL = () => required("DATABASE_URL");

export const UPSTASH_REDIS_REST_URL = () => process.env.KV_REST_API_URL ?? "";
export const UPSTASH_REDIS_REST_TOKEN = () => process.env.KV_REST_API_TOKEN ?? "";

export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "Long-form video search";
export const SEARCH_RATE_LIMIT_PER_MIN = Number(
  process.env.SEARCH_RATE_LIMIT_PER_MIN ?? "30",
);
export const SEARCH_DAILY_GLOBAL_CAP = Number(
  process.env.SEARCH_DAILY_GLOBAL_CAP ?? "10000",
);
// Public demo token. This is hard-coded as a fallback because the project is
// a portfolio demo and the same string is already published in the README and
// powers the /login flow. For any real deployment, set the MCP_TOKEN env var
// to a private value and this fallback is bypassed.
export const MCP_TOKEN = process.env.MCP_TOKEN || "demo2026";

// Internal/dev-only routes (eval dashboard, per-video debug page, eval API,
// MCP endpoint). Gated behind an env var so the public deploy doesn't expose
// them. Set ENABLE_DEV_ROUTES=1 in .env.local to enable.
export function devRoutesEnabled(): boolean {
  return process.env.ENABLE_DEV_ROUTES === "1";
}

export const COLLECTION_SEGMENTS = "segments";
export const COLLECTION_FRAMES = "frames";
export const COLLECTION_MOMENTS = "moments";
export const TEXT_EMBED_MODEL = "text-embedding-3-small";
export const HYDE_MODEL = "gpt-4o-mini";
export const SCORE_FLOOR = 0.35;
export const REVENUE_BANDS = ["<$1M", "$1-5M", "$5-10M", "$10-50M", "$50M+"] as const;
export const PROBLEM_TAGS = [
  "pricing",
  "offers",
  "sales",
  "marketing",
  "hiring",
  "team_building",
  "operations",
  "scaling",
  "partnerships",
  "acquisition",
  "exit",
  "raising_capital",
  "product",
  "retention",
  "branding",
  "international_expansion",
  "competitors",
  "personal_development",
] as const;
