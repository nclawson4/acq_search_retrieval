import { NextResponse } from "next/server";
import { searchMoments, type SpeakerMode } from "@/lib/search";

export const runtime = "nodejs";

function parseList(v: string | null): string[] | undefined {
  if (!v) return undefined;
  const parts = v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const query = (searchParams.get("q") ?? "").trim();
  const k = Number(searchParams.get("k") ?? "10");
  const videoId = searchParams.get("video_id") ?? undefined;
  const speaker = (searchParams.get("speaker") as SpeakerMode | null) ?? "answer";
  const industry = searchParams.get("industry") ?? undefined;
  const revenueBand = searchParams.get("revenue_band") ?? undefined;
  const problems = parseList(searchParams.get("problems"));
  const minAudioQualityRaw = searchParams.get("min_audio_quality");
  const minAudioQuality = minAudioQualityRaw != null ? Number(minAudioQualityRaw) : undefined;

  if (!query) {
    return NextResponse.json({ error: "Missing q" }, { status: 400 });
  }

  try {
    const { hits } = await searchMoments({
      query,
      k,
      videoId,
      speaker,
      industry: industry || null,
      revenueBand: revenueBand || null,
      problems,
      minAudioQuality,
    });
    return NextResponse.json({ query, hits }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "search failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
