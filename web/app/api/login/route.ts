import { NextResponse } from "next/server";

export const runtime = "nodejs";

const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "";
const AUTH_COOKIE = "demo_auth";

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

export async function POST(req: Request) {
  if (!DEMO_PASSWORD) {
    return NextResponse.json({ error: "Auth not configured" }, { status: 500 });
  }
  const form = await req.formData().catch(() => null);
  const password = String(form?.get("password") ?? "");
  if (!constantTimeEqual(password, DEMO_PASSWORD)) {
    const url = new URL("/login", req.url);
    url.searchParams.set("error", "1");
    return NextResponse.redirect(url, { status: 303 });
  }
  const fromRaw = String(form?.get("from") ?? "/");
  // Only allow same-origin paths back, never absolute URLs.
  const safeFrom = fromRaw.startsWith("/") && !fromRaw.startsWith("//") ? fromRaw : "/";

  const dest = new URL(safeFrom, req.url);
  const res = NextResponse.redirect(dest, { status: 303 });
  res.cookies.set(AUTH_COOKIE, password, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.url.startsWith("https"),
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
