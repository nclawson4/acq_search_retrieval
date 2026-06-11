import { Redis } from "@upstash/redis";

// Free-tier: how many searches an IP gets before the demo password is
// required. Per-query cost is roughly $0.0013 (gpt-4o-mini filter extract +
// LLM judge × ~20 candidates + embedding), so 5 free queries ≈ $0.007.
export const SEARCH_FREE_LIMIT = 5;
const TTL_SECONDS = 60 * 60 * 24; // sliding 24-hour window

function getRedis(): Redis | null {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export async function incrementAnonymousSearch(
  ip: string,
): Promise<{ count: number; overLimit: boolean }> {
  const redis = getRedis();
  // Fail open when Redis isn't configured — local dev / preview without KV.
  if (!redis) return { count: 0, overLimit: false };

  const key = `search_count:${ip}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, TTL_SECONDS);
  return { count, overLimit: count > SEARCH_FREE_LIMIT };
}
