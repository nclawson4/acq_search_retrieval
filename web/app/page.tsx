import { sql } from "@/lib/db";
import { APP_NAME, SCORE_FLOOR } from "@/lib/env";
import { searchMoments, type SearchHit } from "@/lib/search";

export const dynamic = "force-dynamic";

const EXAMPLE_QUERIES = [
  "the value equation",
  "why pricing matters more than acquisition",
  "how to think about partnerships",
  "what makes a great offer",
  "advice on raising prices",
];

function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

async function getCorpusStats() {
  try {
    const rows = (await sql()`
      select
        (select count(*) from videos) as videos,
        (select count(*) from segments) as segments,
        (select count(*) from frames) as frames,
        (select coalesce(sum(duration_s), 0) from videos) as duration_s
    `) as Array<{ videos: number; segments: number; frames: number; duration_s: number }>;
    const r = rows[0];
    return {
      videos: Number(r.videos),
      segments: Number(r.segments),
      frames: Number(r.frames),
      hours: Number(r.duration_s) / 3600,
    };
  } catch {
    return null;
  }
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();

  const [hitsAndError, stats] = await Promise.all([
    (async (): Promise<{ hits: SearchHit[]; error: string | null }> => {
      if (!query) return { hits: [], error: null };
      try {
        return { hits: await searchMoments({ query, k: 20 }), error: null };
      } catch (err) {
        return {
          hits: [],
          error: err instanceof Error ? err.message : "Search failed",
        };
      }
    })(),
    getCorpusStats(),
  ]);
  const { hits, error } = hitsAndError;
  const strongHits = hits.filter((h) => h.score >= SCORE_FLOOR);
  const weakHidden = hits.length - strongHits.length;

  return (
    <main className="flex flex-col items-center w-full px-4 sm:px-6 py-10 sm:py-16">
      <div className="w-full max-w-3xl">
        <header className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            <a href="/" className="hover:opacity-80 transition">{APP_NAME}</a>
          </h1>
          <p className="mt-2 text-sm sm:text-base text-zinc-600 dark:text-zinc-400">
            Find ranked, timestamped moments across the library. Type what you remember of the
            moment — it doesn&rsquo;t need to be exact.
          </p>
          {stats && stats.videos > 0 && (
            <p className="mt-3 text-xs text-zinc-500 tabular-nums">
              Indexing {stats.videos} video{stats.videos === 1 ? "" : "s"} ·{" "}
              {stats.hours.toFixed(1)} hours · {stats.segments} segments · {stats.frames} frames
            </p>
          )}
        </header>

        <form action="/" method="get" className="flex gap-2">
          <input
            name="q"
            defaultValue={query}
            placeholder="Search for a moment..."
            autoFocus
            className="flex-1 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100"
          />
          <button
            type="submit"
            className="rounded-md bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-5 py-3 text-base font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200"
          >
            Search
          </button>
        </form>

        {error && (
          <p className="mt-6 rounded-md bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 text-red-800 dark:text-red-200 px-4 py-3 text-sm">
            {error}
          </p>
        )}

        {!query && !error && (
          <div className="mt-10">
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-3">
              Try one of these:
            </p>
            <ul className="flex flex-wrap gap-2">
              {EXAMPLE_QUERIES.map((eq) => (
                <li key={eq}>
                  <a
                    href={`/?q=${encodeURIComponent(eq)}`}
                    className="inline-block rounded-full border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-xs hover:border-zinc-500 dark:hover:border-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition"
                  >
                    {eq}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {query && !error && strongHits.length === 0 && (
          <p className="mt-10 text-sm text-zinc-500 dark:text-zinc-400">
            No strong matches for <strong>&ldquo;{query}&rdquo;</strong>. Try rephrasing or
            describing the moment more directly.
            {weakHidden > 0 && (
              <>
                {" "}
                <span className="text-zinc-400">
                  ({weakHidden} weak match{weakHidden === 1 ? "" : "es"} hidden below score{" "}
                  {SCORE_FLOOR.toFixed(2)}.)
                </span>
              </>
            )}
          </p>
        )}

        <ul className="mt-8 space-y-4">
          {strongHits.map((hit, i) => (
            <li
              key={`${hit.videoId}-${hit.startS}-${i}`}
              className="group flex flex-col sm:flex-row gap-4 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 hover:border-zinc-400 dark:hover:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition relative focus-within:ring-2 focus-within:ring-zinc-900 dark:focus-within:ring-zinc-100"
            >
              <a
                href={hit.playUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="absolute inset-0 z-0"
                aria-label={`Play ${hit.videoTitle || hit.videoId} at ${fmtTime(hit.startS)}`}
              />
              <div className="relative z-10 pointer-events-none contents">
              {hit.frameUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={hit.frameUrl}
                  alt=""
                  loading="lazy"
                  className="w-full sm:w-48 h-auto sm:h-28 object-cover rounded-md bg-zinc-200 dark:bg-zinc-800"
                />
              ) : (
                <div className="w-full sm:w-48 h-28 rounded-md bg-zinc-200 dark:bg-zinc-800" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                    {hit.videoTitle || hit.videoId}
                  </h2>
                  <span className="text-xs text-zinc-500 tabular-nums shrink-0">
                    {fmtTime(hit.startS)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300 line-clamp-3">
                  {hit.text}
                </p>
                <div className="mt-2 flex items-center gap-3 text-xs">
                  <span className="font-medium text-zinc-900 dark:text-zinc-100 group-hover:underline underline-offset-2">
                    Play at {fmtTime(hit.startS)} →
                  </span>
                  <span className="text-zinc-400">·</span>
                  <a
                    href={`/v/${hit.videoId}`}
                    className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 underline-offset-2 hover:underline relative z-20 pointer-events-auto"
                  >
                    all moments
                  </a>
                  <span className="text-zinc-400">·</span>
                  <span className="text-zinc-500">score {hit.score.toFixed(3)}</span>
                </div>
              </div>
              </div>
            </li>
          ))}
        </ul>

        {strongHits.length > 0 && weakHidden > 0 && (
          <p className="mt-6 text-xs text-zinc-500">
            {weakHidden} weaker match{weakHidden === 1 ? "" : "es"} hidden (score &lt;{" "}
            {SCORE_FLOOR.toFixed(2)}).
          </p>
        )}

        <footer className="mt-16 text-xs text-zinc-500 dark:text-zinc-500">
          Multi-modal retrieval over a long-form video library. Transcript embeddings power text
          search; visual frames are extracted at scene changes.
        </footer>
      </div>
    </main>
  );
}
