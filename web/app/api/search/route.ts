import { NextResponse } from "next/server";
import { searchMoments } from "@/lib/search";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const query = (searchParams.get("q") ?? "").trim();
  const k = Number(searchParams.get("k") ?? "10");
  const videoId = searchParams.get("video_id") ?? undefined;

  if (!query) {
    return NextResponse.json({ error: "Missing q" }, { status: 400 });
  }

  try {
    const hits = await searchMoments({ query, k, videoId });
    return NextResponse.json({ query, hits }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "search failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
