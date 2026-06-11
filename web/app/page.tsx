import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import HeroAnimation from "@/components/HeroAnimation";
import MobileHeroAnimation from "@/components/MobileHeroAnimation";
import SearchProgressBar from "@/components/SearchProgressBar";
import { incrementAnonymousSearch } from "@/lib/searchGate";
import { searchSessions, type SessionHit } from "@/lib/sessions";
import {
  INDUSTRIES,
  INDUSTRY_LABELS,
  REVENUE_BANDS,
  TOPICS,
  TOPIC_LABELS,
  GENDERS,
  type Industry,
  type RevenueBand,
  type Topic,
  type Gender,
} from "@/lib/taxonomy";

export const dynamic = "force-dynamic";

const EXAMPLES = [
  "med spa owners stuck under $5M trying to scale",
  "female founders building a service business",
  "home services hiring their first sales team",
  "real estate brokers raising prices",
  "agency owners around $1-5M with churn problems",
];

function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

interface PageSearchParams {
  q?: string;
  industry?: string;
  revenue?: string;
  gender?: string;
  topics?: string;
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  const sp = await searchParams;
  const query = (sp.q ?? "").trim();
  const industry = (sp.industry as Industry | undefined) || null;
  const revenue = (sp.revenue as RevenueBand | undefined) || null;
  const gender = (sp.gender as Gender | undefined) || null;
  const topics = ((sp.topics ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as Topic[]) ?? [];

  const hasAnyInput = !!(query || industry || revenue || gender || topics.length > 0);

  // IP-based gate: anonymous IPs get SEARCH_FREE_LIMIT searches per rolling
  // 24h before the demo password is required. Authenticated cookie skips this.
  if (hasAnyInput) {
    const demoPassword = process.env.DEMO_PASSWORD ?? "";
    const cookieStore = await cookies();
    const authed =
      demoPassword.length > 0 &&
      cookieStore.get("demo_auth")?.value === demoPassword;
    if (!authed && demoPassword.length > 0) {
      const hdrs = await headers();
      // Prefer Vercel's authoritative `x-real-ip`. The leading entry of
      // `x-forwarded-for` is user-controllable and would let a single
      // attacker bypass the gate by rotating the header value per request.
      const ip =
        hdrs.get("x-real-ip")?.trim() ||
        hdrs.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
        // Last-resort fallback: rightmost entry of x-forwarded-for (last
        // hop Vercel observed, harder to spoof than the head).
        hdrs
          .get("x-forwarded-for")
          ?.split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .at(-1) ||
        "anonymous";
      const { overLimit } = await incrementAnonymousSearch(ip);
      if (overLimit) {
        const back = `/?${new URLSearchParams({
          ...(query ? { q: query } : {}),
          ...(industry ? { industry } : {}),
          ...(revenue ? { revenue } : {}),
          ...(gender ? { gender } : {}),
          ...(topics.length > 0 ? { topics: topics.join(",") } : {}),
        }).toString()}`;
        redirect(`/login?from=${encodeURIComponent(back)}`);
      }
    }
  }

  type SearchOutcome = {
    hits: SessionHit[];
    extracted: Awaited<ReturnType<typeof searchSessions>>["extracted"] | null;
    error: string | null;
    latencyMs: number;
    costUSD: number;
  };

  const outcome: SearchOutcome = await (async (): Promise<SearchOutcome> => {
    if (!hasAnyInput) {
      return { hits: [], extracted: null, error: null, latencyMs: 0, costUSD: 0 };
    }
    try {
      const r = await searchSessions({
        query,
        filters: {
          industry,
          revenueBands: revenue ? [revenue] : [],
          gender,
          topics,
        },
        k: 20,
      });
      return {
        hits: r.hits,
        extracted: r.extracted,
        error: null,
        latencyMs: r.latencyMs,
        costUSD: 0,
      };
    } catch (err) {
      return {
        hits: [],
        extracted: null,
        error: err instanceof Error ? err.message : "Search failed",
        latencyMs: 0,
        costUSD: 0,
      };
    }
  })();
  const { hits, extracted, error } = outcome;

  return (
    <main className="flex flex-col items-center w-full px-4 sm:px-6 py-8">
      <SearchProgressBar />
      <a
        href="https://github.com/nclawson4/acq_search_retrieval"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="View source on GitHub"
        className="fixed top-4 right-4 z-40 inline-flex items-center justify-center rounded-full p-2 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-50 transition"
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden
        >
          <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.69-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.74.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.77.11 3.06.74.81 1.19 1.84 1.19 3.1 0 4.43-2.7 5.41-5.27 5.69.41.36.78 1.07.78 2.15 0 1.55-.01 2.81-.01 3.19 0 .31.21.68.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z" />
        </svg>
      </a>
      <div className="w-full max-w-[1280px]">
        {/* Hero: title + search on the left, animation on the right */}
        <section className="mb-10 grid grid-cols-1 lg:grid-cols-[460px_1fr] gap-8 lg:gap-10 items-start">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-300 dark:border-zinc-700 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Live demo
            </span>
            <h1 className="mt-4 text-3xl sm:text-4xl lg:text-[56px] font-semibold tracking-[-0.02em] leading-[1.05] text-zinc-900 dark:text-zinc-50">
              Speed up your editing pipeline 100x
            </h1>
            <p className="mt-4 sm:mt-5 text-lg sm:text-xl lg:text-2xl text-zinc-600 dark:text-zinc-400 leading-snug">
              Search your entire long-form content library in seconds.
            </p>

            {/* Mobile-only animated demo (between subtitle and search input) */}
            <div className="mt-6 lg:hidden">
              <MobileHeroAnimation />
            </div>

            <form action="/" method="get" className="mt-7 space-y-3 hero-form">
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              name="q"
              defaultValue={query}
              placeholder="Describe who you want clips of..."
              autoFocus
              className="flex-1 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100"
              maxLength={500}
            />
            <button
              type="submit"
              className="w-full sm:w-auto rounded-md bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-5 py-3 text-base font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200"
            >
              Search
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <label className="flex flex-col gap-1">
              <span className="text-zinc-500">Industry</span>
              <select
                name="industry"
                defaultValue={industry ?? ""}
                className="rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5"
              >
                <option value="">Any</option>
                {INDUSTRIES.map((i) => (
                  <option key={i} value={i}>{INDUSTRY_LABELS[i]}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-zinc-500">Revenue</span>
              <select
                name="revenue"
                defaultValue={revenue ?? ""}
                className="rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5"
              >
                <option value="">Any</option>
                {REVENUE_BANDS.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-zinc-500">Gender</span>
              <select
                name="gender"
                defaultValue={gender ?? ""}
                className="rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5"
              >
                <option value="">Any</option>
                {GENDERS.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-zinc-500">Topic</span>
              <select
                name="topics"
                defaultValue={topics[0] ?? ""}
                className="rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5"
              >
                <option value="">Any</option>
                {TOPICS.map((t) => (
                  <option key={t} value={t}>{TOPIC_LABELS[t]}</option>
                ))}
              </select>
            </label>
          </div>
            </form>
          </div>

          {/* Animation panel */}
          <div className="hidden lg:block lg:pt-2">
            <HeroAnimation />
          </div>
        </section>

        {error && (
          <p className="mt-6 rounded-md bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 text-red-800 dark:text-red-200 px-4 py-3 text-sm">
            {error}
          </p>
        )}

        {!hasAnyInput && !error && (
          <div className="mt-10">
            <p className="text-sm text-zinc-500 mb-3">Try one of these:</p>
            <ul className="flex flex-wrap gap-2">
              {EXAMPLES.map((eq) => (
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

        {extracted && (extracted.industry || extracted.revenueBands.length > 0 || extracted.gender || extracted.topics.length > 0) && (
          <div className="mt-6 rounded-md border border-zinc-200 dark:border-zinc-800 px-4 py-3 text-xs text-zinc-600 dark:text-zinc-400">
            <span className="text-zinc-500">Interpreted from your text:</span>{" "}
            {extracted.industry && (
              <span className="inline-block ml-1 rounded bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5">
                industry: {INDUSTRY_LABELS[extracted.industry]}
              </span>
            )}
            {extracted.revenueBands.length > 0 && (
              <span className="inline-block ml-1 rounded bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5">
                revenue: {extracted.revenueBands.join(" / ")}
              </span>
            )}
            {extracted.gender && (
              <span className="inline-block ml-1 rounded bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5">
                gender: {extracted.gender}
              </span>
            )}
            {extracted.topics.map((t) => (
              <span key={t} className="inline-block ml-1 rounded bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5">
                {TOPIC_LABELS[t]}
              </span>
            ))}
          </div>
        )}

        {hasAnyInput && !error && hits.length === 0 && (
          <p className="mt-10 text-sm text-zinc-500">
            No matches. Loosen a filter (especially industry or topic) and try again.
          </p>
        )}

        <ul className="mt-6 space-y-4">
          {hits.map((hit) => {
            const duration = Math.max(0, Math.round(hit.endS - hit.startS));
            const thumbUrl = `https://i.ytimg.com/vi/${hit.videoId}/mqdefault.jpg`;
            return (
              <li
                key={hit.sessionId}
                className="group rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 hover:border-zinc-400 dark:hover:border-zinc-600 transition"
              >
                <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 sm:items-center">
                  {/* Thumbnail — full-width on mobile, fixed 200px on tablet+. Clickable, with play overlay + duration badge */}
                  <a
                    href={hit.playUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="relative shrink-0 block rounded-lg overflow-hidden ring-1 ring-black/10 dark:ring-white/10 group/thumb aspect-video bg-zinc-200 dark:bg-zinc-800 w-full sm:w-[200px]"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={thumbUrl}
                      alt={hit.videoTitle || hit.videoId}
                      className="block w-full h-full object-cover"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover/thumb:bg-black/35 transition-colors">
                      <div className="h-12 w-12 rounded-full bg-white/95 flex items-center justify-center shadow-[0_4px_18px_rgba(0,0,0,0.35)] scale-90 opacity-90 group-hover/thumb:scale-100 group-hover/thumb:opacity-100 transition">
                        <svg
                          width="20"
                          height="20"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          className="text-zinc-900 ml-0.5"
                          aria-hidden
                        >
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </div>
                    </div>
                    <div className="absolute bottom-1.5 right-1.5 rounded bg-black/85 px-1.5 py-0.5 text-[10px] font-medium text-white tabular-nums">
                      {fmtTime(duration)}
                    </div>
                  </a>

                  {/* Right column: title, chips, summary */}
                  <div className="flex-1 min-w-0 flex flex-col">
                    <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {hit.videoTitle || hit.videoId}
                    </h2>

                    <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px] uppercase tracking-wide">
                      {hit.industry && (
                        <span className="rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 px-1.5 py-0.5">
                          {INDUSTRY_LABELS[hit.industry] ?? hit.industry}
                        </span>
                      )}
                      {hit.secondaryIndustries?.map((si) => (
                        <span
                          key={si}
                          className="rounded border border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 px-1.5 py-0.5"
                          title="Secondary industry — verified via separate audit pass"
                        >
                          + {INDUSTRY_LABELS[si] ?? si}
                        </span>
                      ))}
                      {hit.revenueBand && (
                        <span className="rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 px-1.5 py-0.5">
                          {hit.revenueBand}
                        </span>
                      )}
                      {hit.attendeeGender && hit.attendeeGender !== "unknown" && (
                        <span className="rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 px-1.5 py-0.5">
                          {hit.attendeeGender}
                        </span>
                      )}
                      {hit.topics.slice(0, 3).map((t) => (
                        <span key={t} className="rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 px-1.5 py-0.5">
                          {TOPIC_LABELS[t] ?? t}
                        </span>
                      ))}
                    </div>

                    <p className="mt-2 text-sm text-zinc-800 dark:text-zinc-200">
                      {hit.conversationSummary}
                    </p>
                    {hit.reason && (
                      <p className="mt-1.5 text-xs text-zinc-500 italic">
                        why it matched: {hit.reason}
                      </p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </main>
  );
}
