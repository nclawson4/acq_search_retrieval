// Golden-set + validation section. Loads two artifacts at build time via
// JSON import:
//   - public/demo-eval-latest.json: 9 demo queries × full searchSessions
//     pipeline. Written by `npx tsx scripts/demo_eval.ts`.
//   - public/filter-eval-latest.json: extraction-accuracy + filter-fidelity
//     report. Written by `npx tsx scripts/filter_eval.ts`.
//
// Static imports are the most reliable on Vercel. public/ files aren't
// readable via fs in the lambda runtime, so reading at request time would
// fail in prod even though it works in `next dev`.

import demoEvalRaw from "../public/demo-eval-latest.json";
import filterEvalRaw from "../public/filter-eval-latest.json";

interface DemoTopHit {
  videoTitle: string;
  videoId: string;
  startS: number;
  durationS: number;
  industry: string | null;
  revenueBand: string | null;
  attendeeGender: string | null;
  topics: string[];
  judgeScore: number;
  semanticScore: number;
  reason: string;
}

interface DemoDetail {
  query: string;
  source: "cycling" | "hero";
  extracted: {
    industry: string | null;
    revenueBands: string[];
    gender: string | null;
    topics: string[];
    residualText: string;
  };
  hitsCount: number;
  topHits: DemoTopHit[];
  latencyMs: number;
  meanTop3JudgeScore: number;
  passedRelevanceFloor: boolean;
}

interface DemoReport {
  ranAt: string;
  total: number;
  passRate: number;
  meanLatencyMs: number;
  medianLatencyMs: number;
  meanTop1JudgeScore: number;
  meanHits: number;
  details: DemoDetail[];
}

interface FilterEvalReport {
  ranAt: string;
  extraction: {
    summary: {
      total: number;
      industryAccuracy: number;
      revenueBandsAccuracy: number;
      genderAccuracy: number;
      topicsPrecision: number;
      topicsRecall: number;
      topicsF1: number;
      allFieldsCorrect: number;
    };
  };
  fidelity: {
    revenue: { applicable: number; matched: number; rate: number };
    gender: { applicable: number; matched: number; rate: number };
    industry: { applicable: number; matched: number; rate: number };
    topics: { applicable: number; matched: number; rate: number };
    totalHitsEvaluated: number;
  } | null;
}

const demo = demoEvalRaw as DemoReport;
const filterEval = filterEvalRaw as unknown as FilterEvalReport;

function fmtTime(t: string): string {
  try {
    const d = new Date(t);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return t;
  }
}

function Score({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const cls =
    value >= 0.9
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
      : value >= 0.7
        ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
        : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${cls}`}
    >
      {pct}%
    </span>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 px-1.5 py-0.5 text-[10px]">
      {children}
    </span>
  );
}

export default function GoldenSetSection() {
  const ex = filterEval.extraction.summary;
  const fid = filterEval.fidelity;

  return (
    <section className="mt-16">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Golden sets &amp; validation benchmarks
        </h2>
        <span className="text-xs uppercase tracking-wider text-zinc-500">
          Real queries, real numbers
        </span>
      </div>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 max-w-3xl">
        The product goal is one specific thing: given an editor's
        natural-language description of who they want clips of, surface the
        right sessions. The two evaluations below test that directly. Did the
        system understand the query, and do the sessions it returned actually
        match the query's intent?
      </p>

      {/* Headline numbers, non-technical readout */}
      <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
        <Headline
          label="Demo queries returned ≥1 relevant clip"
          value={`${Math.round(demo.passRate * 100)}%`}
          sub={`${demo.total} editor-style queries tested`}
        />
        <Headline
          label="Avg confidence in the top result"
          value={`${Math.round(demo.meanTop1JudgeScore * 100)}%`}
          sub="Graded 0–100 by the LLM judge"
        />
        <Headline
          label="Filter extraction accuracy"
          value={`${Math.round((ex.allFieldsCorrect / ex.total) * 100)}%`}
          sub={`${ex.allFieldsCorrect} of ${ex.total} queries, every field correct`}
        />
        <Headline
          label="Median search latency"
          value={`${Math.round(demo.medianLatencyMs / 100) / 10}s`}
          sub="End-to-end, including LLM grading"
        />
      </div>

      <p className="mt-3 text-xs text-zinc-500">
        Last run: demo eval {fmtTime(demo.ranAt)} · filter eval{" "}
        {fmtTime(filterEval.ranAt)}. Reproduce with{" "}
        <code className="text-[11px] rounded bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5">
          npx tsx scripts/demo_eval.ts
        </code>{" "}
        and{" "}
        <code className="text-[11px] rounded bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5">
          npx tsx scripts/filter_eval.ts
        </code>
        .
      </p>

      {/* Filter extraction per-field breakdown */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-5">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            Did the LLM understand the query?
          </h3>
          <p className="mt-1 text-xs text-zinc-500 leading-relaxed">
            For each of {ex.total} hand-labeled queries, a human reviewer wrote
            down the exact filters the system should extract. The numbers below
            are how often the LLM agreed with the human.
          </p>
          <div className="mt-4 space-y-2 text-sm">
            <FieldRow
              label="Industry"
              detail="Pizza shop → food_and_beverage; HVAC → home_services; etc."
              value={ex.industryAccuracy}
            />
            <FieldRow
              label="Revenue range"
              detail='"under $5M" → ["<$1M","$1-5M"]; "over $1M" → 3 bands'
              value={ex.revenueBandsAccuracy}
            />
            <FieldRow
              label="Gender"
              detail='"female founders" → female; "agency owners" → null'
              value={ex.genderAccuracy}
            />
            <FieldRow
              label="Topics (F1)"
              detail={`Precision ${Math.round(ex.topicsPrecision * 100)}% · Recall ${Math.round(ex.topicsRecall * 100)}%`}
              value={ex.topicsF1}
            />
          </div>
        </div>

        {/* Filter fidelity in returned sessions */}
        {fid && (
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-5">
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Do the returned sessions match the query?
            </h3>
            <p className="mt-1 text-xs text-zinc-500 leading-relaxed">
              For every result the system returned to the {demo.total} demo
              queries ({fid.totalHitsEvaluated} sessions in total), does the
              session's tagged metadata actually respect the extracted filters?
            </p>
            <div className="mt-4 space-y-2 text-sm">
              <FieldRow
                label="Revenue band"
                detail={`${fid.revenue.matched} of ${fid.revenue.applicable} returned sessions fall inside the asked revenue range`}
                value={fid.revenue.rate}
              />
              <FieldRow
                label="Gender"
                detail={`${fid.gender.matched} of ${fid.gender.applicable} returned sessions match the asked gender`}
                value={fid.gender.rate}
              />
              <FieldRow
                label="Top-result confidence (judge)"
                detail="The LLM judge re-reads each returned session and scores how well it answers the original query"
                value={demo.meanTop1JudgeScore}
              />
            </div>
          </div>
        )}
      </div>

      {/* Per-query detail table */}
      <div className="mt-6 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-5">
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          What the system did for each demo query
        </h3>
        <p className="mt-1 text-xs text-zinc-500">
          The filters the system pulled from the query, the top result it
          ranked highest, and the grader's reason for the score. If any of
          those three things look wrong for a query, that's where to debug.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                <th className="py-2 pr-4 font-medium">Query</th>
                <th className="py-2 pr-4 font-medium">Filters extracted</th>
                <th className="py-2 pr-4 font-medium">Top result</th>
                <th className="py-2 pr-3 font-medium">Judge</th>
                <th className="py-2 pr-3 font-medium">Hits</th>
                <th className="py-2 pr-3 font-medium">Latency</th>
              </tr>
            </thead>
            <tbody>
              {demo.details.map((d, i) => {
                const top = d.topHits[0];
                const f = d.extracted;
                return (
                  <tr
                    key={i}
                    className="border-b border-zinc-100 dark:border-zinc-900 last:border-0 align-top"
                  >
                    <td className="py-3 pr-4 max-w-[260px]">
                      <div className="text-zinc-900 dark:text-zinc-100">
                        {d.query}
                      </div>
                      <div className="mt-0.5 text-[10px] uppercase tracking-wider text-zinc-500">
                        {d.source}
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex flex-wrap gap-1">
                        {f.industry && <Chip>{f.industry}</Chip>}
                        {f.revenueBands.map((b) => (
                          <Chip key={b}>{b}</Chip>
                        ))}
                        {f.gender && <Chip>{f.gender}</Chip>}
                        {f.topics.map((t) => (
                          <Chip key={t}>{t}</Chip>
                        ))}
                        {!f.industry &&
                          f.revenueBands.length === 0 &&
                          !f.gender &&
                          f.topics.length === 0 && (
                            <span className="text-xs text-zinc-400">
                              none
                            </span>
                          )}
                      </div>
                    </td>
                    <td className="py-3 pr-4 max-w-[280px]">
                      {top ? (
                        <>
                          <div className="text-zinc-900 dark:text-zinc-100 truncate">
                            {top.videoTitle}
                          </div>
                          {top.reason && (
                            <div className="mt-0.5 text-[11px] text-zinc-500 italic">
                              {top.reason}
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="text-xs text-zinc-400">no hits</span>
                      )}
                    </td>
                    <td className="py-3 pr-3">
                      {top ? <Score value={top.judgeScore} /> : "n/a"}
                    </td>
                    <td className="py-3 pr-3 tabular-nums text-zinc-700 dark:text-zinc-300">
                      {d.hitsCount}
                    </td>
                    <td className="py-3 pr-3 tabular-nums text-zinc-700 dark:text-zinc-300">
                      {(d.latencyMs / 1000).toFixed(1)}s
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function FieldRow({
  label,
  detail,
  value,
}: {
  label: string;
  detail: string;
  value: number;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-x-3 items-baseline">
      <div>
        <div className="text-zinc-800 dark:text-zinc-200">{label}</div>
        <div className="text-xs text-zinc-500 mt-0.5">{detail}</div>
      </div>
      <Score value={value} />
    </div>
  );
}

function Headline({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4">
      <div className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
        {value}
      </div>
      <div className="mt-1 text-xs font-medium text-zinc-700 dark:text-zinc-300 leading-tight">
        {label}
      </div>
      <div className="mt-0.5 text-[11px] text-zinc-500">{sub}</div>
    </div>
  );
}
