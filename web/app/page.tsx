import { APP_NAME } from "@/lib/env";
import { searchMoments, type SearchHit } from "@/lib/search";

export const dynamic = "force-dynamic";

function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();

  let hits: SearchHit[] = [];
  let error: string | null = null;
  if (query) {
    try {
      hits = await searchMoments({ query, k: 20 });
    } catch (err) {
      error = err instanceof Error ? err.message : "Search failed";
    }
  }

  return (
    <main className="flex flex-col items-center w-full px-4 sm:px-6 py-10 sm:py-16">
      <div className="w-full max-w-3xl">
        <header className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">{APP_NAME}</h1>
          <p className="mt-2 text-sm sm:text-base text-zinc-600 dark:text-zinc-400">
            Find ranked, timestamped moments across the library. Try things like{" "}
            <em>&ldquo;explaining the value equation&rdquo;</em> or{" "}
            <em>&ldquo;why most businesses fail at pricing&rdquo;</em>.
          </p>
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
          <p className="mt-10 text-sm text-zinc-500 dark:text-zinc-400">
            Enter a query above to search. Each result links you to the exact moment in the
            source video.
          </p>
        )}

        {query && !error && hits.length === 0 && (
          <p className="mt-10 text-sm text-zinc-500 dark:text-zinc-400">
            No matches for <strong>&ldquo;{query}&rdquo;</strong>. Try rephrasing or describing the
            moment more directly.
          </p>
        )}

        <ul className="mt-8 space-y-4">
          {hits.map((hit, i) => (
            <li
              key={`${hit.videoId}-${hit.startS}-${i}`}
              className="flex flex-col sm:flex-row gap-4 rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 hover:border-zinc-400 dark:hover:border-zinc-600 transition"
            >
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
                  <a
                    href={hit.playUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-zinc-900 dark:text-zinc-100 underline underline-offset-2 hover:no-underline"
                  >
                    Play at {fmtTime(hit.startS)}
                  </a>
                  <span className="text-zinc-400">·</span>
                  <span className="text-zinc-500">score {hit.score.toFixed(3)}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>

        <footer className="mt-16 text-xs text-zinc-500 dark:text-zinc-500">
          Multi-modal retrieval over a long-form video library. Transcript embeddings power text
          search; visual frames are extracted at scene changes.
        </footer>
      </div>
    </main>
  );
}
