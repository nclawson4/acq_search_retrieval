import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const dynamic = "force-dynamic";

interface QueryDetail {
  query: string;
  notes?: string;
  source?: "golden" | "synthetic";
  expectedVideo: string;
  expectedTRange?: [number, number];
  rank: number | null;
  topHits: Array<{ videoId: string; startS: number; score: number }>;
}
interface Report {
  ranAt: string;
  mode: string;
  k: number;
  total: number;
  recallAt5: number;
  recallAt10: number;
  mrr: number;
  details: QueryDetail[];
}

async function readReport(): Promise<Report | null> {
  try {
    const path = resolve(process.cwd(), "public", "eval-latest.json");
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as Report;
  } catch {
    return null;
  }
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export default async function EvalPage() {
  const report = await readReport();

  return (
    <main className="flex flex-col items-center w-full px-4 sm:px-6 py-10 sm:py-16">
      <div className="w-full max-w-4xl">
        <header className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Retrieval eval</h1>
          <p className="mt-2 text-sm sm:text-base text-zinc-600 dark:text-zinc-400">
            Recall@k and MRR for the search index. Re-run with{" "}
            <code className="rounded bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-xs">
              npx tsx scripts/eval.ts
            </code>{" "}
            from <code className="rounded bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-xs">web/</code>.
          </p>
        </header>

        {!report ? (
          <div className="rounded-md border border-zinc-200 dark:border-zinc-800 p-6 text-sm text-zinc-600 dark:text-zinc-400">
            No eval report yet. Run{" "}
            <code className="rounded bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-xs">
              npx tsx scripts/eval.ts
            </code>{" "}
            to generate one.
          </div>
        ) : (
          <>
            <section className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
              <Stat label="Recall@5" value={pct(report.recallAt5)} />
              <Stat label="Recall@10" value={pct(report.recallAt10)} />
              <Stat label="MRR" value={report.mrr.toFixed(3)} />
              <Stat label="Queries" value={String(report.total)} />
            </section>

            <p className="text-xs text-zinc-500 mb-4">
              Mode: <strong>{report.mode}</strong> · k={report.k} · Ran at{" "}
              {new Date(report.ranAt).toLocaleString()}
            </p>

            <h2 className="text-lg font-semibold mb-3">Per-query details</h2>
            <ul className="space-y-3">
              {report.details.map((d, i) => (
                <li
                  key={i}
                  className={`rounded-md border p-3 text-sm ${
                    d.rank !== null
                      ? "border-zinc-200 dark:border-zinc-800"
                      : "border-red-200 dark:border-red-900 bg-red-50/40 dark:bg-red-950/40"
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {d.query}
                    </p>
                    <span className="text-xs shrink-0 tabular-nums">
                      {d.rank === null ? "miss" : `rank ${d.rank}`}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    expected video <code>{d.expectedVideo}</code>
                    {d.expectedTRange && (
                      <>
                        {" "}
                        @ {d.expectedTRange[0]}–{d.expectedTRange[1]}s
                      </>
                    )}
                    {d.source && ` · ${d.source}`}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-200 dark:border-zinc-800 p-4">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
