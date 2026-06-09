import { notFound } from "next/navigation";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

interface VideoRow {
  id: string;
  url: string;
  title: string | null;
  channel: string | null;
  duration_s: number;
  ingested_at: string;
}

interface SegmentRow {
  id: number;
  start_s: number;
  end_s: number;
  text: string;
  frame_url: string | null;
}

async function fetchVideo(id: string) {
  const videos = (await sql()`
    select id, url, title, channel, duration_s, ingested_at
    from videos
    where id = ${id}
    limit 1
  `) as VideoRow[];
  if (videos.length === 0) return null;

  const segments = (await sql()`
    select
      s.id,
      s.start_s,
      s.end_s,
      s.text,
      (
        select f.blob_url from frames f
        where f.video_id = s.video_id
        order by abs(f.t_s - (s.start_s + s.end_s) / 2)
        limit 1
      ) as frame_url
    from segments s
    where s.video_id = ${id}
    order by s.start_s
  `) as SegmentRow[];

  return { video: videos[0], segments };
}

export default async function VideoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await fetchVideo(id);
  if (!data) notFound();

  const { video, segments } = data;

  return (
    <main className="flex flex-col items-center w-full px-4 sm:px-6 py-10 sm:py-16">
      <div className="w-full max-w-3xl">
        <p className="text-xs text-zinc-500 mb-2">
          <a
            href="/"
            className="underline underline-offset-2 hover:no-underline"
          >
            ← back to search
          </a>
        </p>
        <header className="mb-6">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">
            {video.title || video.id}
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {video.channel || "Unknown channel"} · {fmtTime(Number(video.duration_s))} ·{" "}
            {segments.length} indexed segment{segments.length === 1 ? "" : "s"}
          </p>
          <p className="mt-2 text-xs">
            <a
              href={video.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:no-underline text-zinc-700 dark:text-zinc-300"
            >
              Open on YouTube ↗
            </a>
          </p>
        </header>

        {segments.length === 0 ? (
          <p className="text-sm text-zinc-500">
            This video has no indexed segments yet.
          </p>
        ) : (
          <ol className="space-y-3">
            {segments.map((seg) => {
              const playUrl = `${video.url}${
                video.url.includes("?") ? "&" : "?"
              }t=${Math.floor(Number(seg.start_s))}s`;
              return (
                <li
                  key={seg.id}
                  className="group flex flex-col sm:flex-row gap-3 rounded-md border border-zinc-200 dark:border-zinc-800 p-3 hover:border-zinc-400 dark:hover:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition relative"
                >
                  <a
                    href={playUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="absolute inset-0 z-0"
                    aria-label={`Play at ${fmtTime(Number(seg.start_s))}`}
                  />
                  <div className="relative z-10 pointer-events-none contents">
                    {seg.frame_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={seg.frame_url}
                        alt=""
                        loading="lazy"
                        className="w-full sm:w-32 h-auto sm:h-20 object-cover rounded bg-zinc-200 dark:bg-zinc-800"
                      />
                    ) : (
                      <div className="w-full sm:w-32 h-20 rounded bg-zinc-200 dark:bg-zinc-800" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-zinc-500 tabular-nums mb-1">
                        {fmtTime(Number(seg.start_s))} – {fmtTime(Number(seg.end_s))}
                      </p>
                      <p className="text-sm text-zinc-700 dark:text-zinc-300 line-clamp-3">
                        {seg.text}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </main>
  );
}
