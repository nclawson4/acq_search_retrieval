import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { devRoutesEnabled } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const rows = (await sql()`
      select title from videos where id = ${id} limit 1
    `) as Array<{ title: string | null }>;
    const title = rows[0]?.title || id;
    return { title };
  } catch {
    return {};
  }
}

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

interface MomentRow {
  id: number;
  q_start_s: number;
  q_end_s: number;
  q_text: string;
  a_start_s: number;
  a_end_s: number;
  a_text: string;
  industry: string | null;
  revenue_band: string | null;
  problems: string[] | null;
  audio_quality: number | null;
  clip_score: number | null;
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

  const moments = (await sql()`
    select
      m.id,
      m.q_start_s, m.q_end_s, m.q_text,
      m.a_start_s, m.a_end_s, m.a_text,
      m.industry, m.revenue_band, m.problems,
      m.audio_quality, m.clip_score,
      (
        select f.blob_url from frames f
        where f.video_id = m.video_id
        order by abs(f.t_s - (m.a_start_s + m.a_end_s) / 2)
        limit 1
      ) as frame_url
    from moments m
    where m.video_id = ${id}
    order by m.q_start_s
  `) as MomentRow[];

  return { video: videos[0], moments };
}

export default async function VideoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!devRoutesEnabled()) notFound();
  const { id } = await params;
  const data = await fetchVideo(id);
  if (!data) notFound();

  const { video, moments } = data;

  return (
    <main className="flex flex-col items-center w-full px-4 sm:px-6 py-10 sm:py-16">
      <div className="w-full max-w-3xl">
        <p className="text-xs text-zinc-500 mb-2">
          <a href="/" className="underline underline-offset-2 hover:no-underline">
            ← back to search
          </a>
        </p>
        <header className="mb-6">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">
            {video.title || video.id}
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {video.channel || "Unknown channel"} · {fmtTime(Number(video.duration_s))} ·{" "}
            {moments.length} Q&amp;A moment{moments.length === 1 ? "" : "s"}
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

        {moments.length === 0 ? (
          <p className="text-sm text-zinc-500">This video has no indexed Q&amp;A moments yet.</p>
        ) : (
          <ol className="space-y-3">
            {moments.map((m) => {
              const playUrl = `${video.url}${
                video.url.includes("?") ? "&" : "?"
              }t=${Math.floor(Number(m.q_start_s))}s`;
              const problems = Array.isArray(m.problems) ? m.problems : [];
              return (
                <li
                  key={m.id}
                  className="group flex flex-col sm:flex-row gap-3 rounded-md border border-zinc-200 dark:border-zinc-800 p-3 hover:border-zinc-400 dark:hover:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition relative"
                >
                  <a
                    href={playUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="absolute inset-0 z-0"
                    aria-label={`Play at ${fmtTime(Number(m.q_start_s))}`}
                  />
                  <div className="relative z-10 pointer-events-none contents">
                    {m.frame_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={m.frame_url}
                        alt=""
                        loading="lazy"
                        className="w-full sm:w-32 h-auto sm:h-20 object-cover rounded bg-zinc-200 dark:bg-zinc-800"
                      />
                    ) : (
                      <div className="w-full sm:w-32 h-20 rounded bg-zinc-200 dark:bg-zinc-800" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-zinc-500 tabular-nums mb-1">
                        {fmtTime(Number(m.q_start_s))} – {fmtTime(Number(m.a_end_s))}
                      </p>
                      {(m.industry || m.revenue_band || problems.length > 0) && (
                        <div className="mb-1 flex flex-wrap gap-1 text-[10px] uppercase tracking-wide">
                          {m.industry && (
                            <span className="rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 px-1.5 py-0.5">
                              {m.industry}
                            </span>
                          )}
                          {m.revenue_band && (
                            <span className="rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 px-1.5 py-0.5">
                              {m.revenue_band}
                            </span>
                          )}
                          {problems.slice(0, 3).map((p) => (
                            <span
                              key={p}
                              className="rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 px-1.5 py-0.5"
                            >
                              {p.replace(/_/g, " ")}
                            </span>
                          ))}
                        </div>
                      )}
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2">
                        <span className="font-medium text-zinc-700 dark:text-zinc-300">Q:</span>{" "}
                        {m.q_text}
                      </p>
                      <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300 line-clamp-3">
                        <span className="font-medium text-zinc-900 dark:text-zinc-100">A:</span>{" "}
                        {m.a_text}
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
