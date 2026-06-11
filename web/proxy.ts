import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const PER_MIN = Number(process.env.SEARCH_RATE_LIMIT_PER_MIN ?? "30");
const DAILY_CAP = Number(process.env.SEARCH_DAILY_GLOBAL_CAP ?? "10000");

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

// Password gate for the demo. The cookie value is the literal password — we
// don't store it server-side and don't issue tokens. Comparing strings here
// keeps the gate stupid-simple for a single-credential demo; for any real
// multi-user deployment, swap this for proper auth.
// NOTE: The upfront password gate was removed — gating is now IP-count based
// in `app/page.tsx` so anonymous visitors get 5 free searches before being
// redirected to /login. The middleware still rate-limits the cost-driver API
// paths.

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
  const { pathname } = req.nextUrl;

  // Rate-limit the cost-driver paths only (LLM/embedding-backed). The home
  // page calls searchSessions server-side, so anonymous query counting lives
  // in app/page.tsx and is gated against the same Redis store.
  const isRateLimited =
    pathname.startsWith("/api/search") || pathname.startsWith("/api/mcp");
  if (!isRateLimited || !perIp || !dailyCap) return NextResponse.next();

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

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export const config = {
  // Match all paths except static assets and Next.js internals; the function
  // itself decides whether each path needs auth, rate-limit, or both.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
