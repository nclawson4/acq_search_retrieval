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
export const MCP_TOKEN = process.env.MCP_TOKEN ?? "";

export const COLLECTION_SEGMENTS = "segments";
export const COLLECTION_FRAMES = "frames";
export const TEXT_EMBED_MODEL = "text-embedding-3-small";
