import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const PER_MIN = Number(process.env.SEARCH_RATE_LIMIT_PER_MIN ?? "30");
const DAILY_CAP = Number(process.env.SEARCH_DAILY_GLOBAL_CAP ?? "10000");

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

let perIp: Ratelimit | null = null;
let dailyCap: Ratelimit | null = null;

if (KV_URL && KV_TOKEN) {
  const redis = new Redis({ url: KV_URL, token: KV_TOKEN });
  perIp = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(PER_MIN, "1 m"),
    prefix: "rl:ip",
    analytics: false,
  });
  dailyCap = new Ratelimit({
    redis,
    limiter: Ratelimit.fixedWindow(DAILY_CAP, "1 d"),
    prefix: "rl:daily",
    analytics: false,
  });
}

function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  return real || "anon";
}

export async function proxy(req: NextRequest) {
  if (!perIp || !dailyCap) return NextResponse.next();

  const ip = clientIp(req);
  const [ipResult, capResult] = await Promise.all([
    perIp.limit(`ip:${ip}`),
    dailyCap.limit("global"),
  ]);

  if (!capResult.success) {
    return new NextResponse(
      JSON.stringify({
        error: "Daily demo limit reached. Resets at UTC midnight.",
      }),
      {
        status: 429,
        headers: {
          "content-type": "application/json",
          "x-ratelimit-scope": "global",
        },
      },
    );
  }
  if (!ipResult.success) {
    const retryAfter = Math.max(1, Math.ceil((ipResult.reset - Date.now()) / 1000));
    return new NextResponse(
      JSON.stringify({
        error: "Too many requests. Try again in a moment.",
      }),
      {
        status: 429,
        headers: {
          "content-type": "application/json",
          "retry-after": String(retryAfter),
          "x-ratelimit-scope": "ip",
        },
      },
    );
  }

  const res = NextResponse.next();
  res.headers.set("x-ratelimit-limit", String(PER_MIN));
  res.headers.set("x-ratelimit-remaining", String(Math.max(0, ipResult.remaining)));
  return res;
}

export const config = {
  matcher: ["/api/search/:path*", "/api/mcp/:path*"],
};
