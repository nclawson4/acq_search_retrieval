"use client";

import { useCallback, useEffect, useState } from "react";
import type { Gender, Industry, RevenueBand, Topic } from "@/lib/taxonomy";

type Relevance = "relevant" | "partial" | "not_relevant";

interface SessionHit {
  sessionId: number;
  videoId: string;
  videoTitle: string;
  startS: number;
  endS: number;
  industry: string | null;
  revenueBand: string | null;
  attendeeGender: string | null;
  topics: string[];
  conversationSummary: string;
  reason: string;
  judgeScore: number;
  semanticScore: number;
  playUrl: string;
}

interface GoldQuery {
  id: number;
  query_text: string;
  expected_industry: Industry | null;
  expected_revenue: RevenueBand | null;
  expected_topics: Topic[] | null;
  expected_gender: Gender | null;
  label_count: number;
  created_at: string;
}

interface EvalRunSummary {
  id: number;
  ran_at: string;
  recall_at_5: number;
  recall_at_10: number;
  mrr: number;
}

interface RunReport {
  ran_at: string;
  total_queries: number;
  precision_at_5: number;
  recall_at_10: number;
  mrr: number;
  total_cost_usd: number;
  total_latency_ms: number;
  per_query: Array<{
    query_id: number;
    query_text: string;
    rank_of_first_relevant: number | null;
    precision_at_5: number;
    recall_relevant_in_topk: number;
    hits: Array<{
      session_id: number;
      judge_score: number;
      relevance: Relevance | null;
    }>;
  }>;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export default function EvalPage() {
  const [tab, setTab] = useState<"builder" | "runner">("builder");
  const [queries, setQueries] = useState<GoldQuery[]>([]);
  const [runs, setRuns] = useState<EvalRunSummary[]>([]);

  const loadQueries = useCallback(async () => {
    const r = await fetch("/api/eval/queries", { cache: "no-store" });
    const j = await r.json();
    setQueries(j.queries ?? []);
  }, []);

  const loadRuns = useCallback(async () => {
    const r = await fetch("/api/eval/run", { cache: "no-store" });
    const j = await r.json();
    setRuns(j.runs ?? []);
  }, []);

  useEffect(() => {
    loadQueries();
    loadRuns();
  }, [loadQueries, loadRuns]);

  return (
    <main className="flex flex-col items-center w-full px-4 sm:px-6 py-8">
      <div className="w-full max-w-4xl">
        <header className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            <a href="/eval" className="hover:opacity-80">Search eval</a>
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Build a gold set of queries with labeled relevant sessions, then run the eval to
            measure precision@5, recall@10, and MRR over time.
          </p>
        </header>

        <div className="flex gap-2 mb-6 text-sm">
          <button
            type="button"
            onClick={() => setTab("builder")}
            className={`rounded-md px-4 py-2 border ${
              tab === "builder"
                ? "bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100"
                : "border-zinc-300 dark:border-zinc-700"
            }`}
          >
            Gold-set builder ({queries.length})
          </button>
          <button
            type="button"
            onClick={() => setTab("runner")}
            className={`rounded-md px-4 py-2 border ${
              tab === "runner"
                ? "bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100"
                : "border-zinc-300 dark:border-zinc-700"
            }`}
          >
            Run + history ({runs.length})
          </button>
        </div>

        {tab === "builder" ? (
          <BuilderTab queries={queries} reloadQueries={loadQueries} />
        ) : (
          <RunnerTab runs={runs} reloadRuns={loadRuns} />
        )}
      </div>
    </main>
  );
}

function BuilderTab({ queries, reloadQueries }: { queries: GoldQuery[]; reloadQueries: () => Promise<void> }) {
  const [activeQuery, setActiveQuery] = useState<GoldQuery | null>(null);
  const [newQueryText, setNewQueryText] = useState("");
  const [hits, setHits] = useState<SessionHit[]>([]);
  const [labels, setLabels] = useState<Record<number, Relevance>>({});
  const [loading, setLoading] = useState(false);

  const createQuery = async () => {
    if (!newQueryText.trim()) return;
    const r = await fetch("/api/eval/queries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query_text: newQueryText.trim() }),
    });
    if (r.ok) {
      setNewQueryText("");
      await reloadQueries();
    }
  };

  const selectQuery = async (q: GoldQuery) => {
    setActiveQuery(q);
    setLoading(true);
    setHits([]);
    setLabels({});
    try {
      const sr = await fetch(
        `/api/search/sessions?q=${encodeURIComponent(q.query_text)}&k=20`,
      ).then((r) => r.json());
      setHits(sr.hits ?? []);
    } finally {
      setLoading(false);
    }
  };

  const label = async (sessionId: number, relevance: Relevance, rank: number) => {
    if (!activeQuery) return;
    setLabels((prev) => ({ ...prev, [sessionId]: relevance }));
    await fetch("/api/eval/label", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query_id: activeQuery.id,
        session_id: sessionId,
        relevance,
        rank,
      }),
    });
    await reloadQueries();
  };

  const deleteQuery = async (q: GoldQuery) => {
    const tail = q.label_count > 0 ? ` and its ${q.label_count} label${q.label_count === 1 ? "" : "s"}` : "";
    if (!confirm(`Delete "${q.query_text}"${tail}?`)) return;
    const r = await fetch(`/api/eval/queries/${q.id}`, { method: "DELETE" });
    if (!r.ok) {
      alert("Delete failed");
      return;
    }
    if (activeQuery?.id === q.id) {
      setActiveQuery(null);
      setHits([]);
      setLabels({});
    }
    await reloadQueries();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
      <aside className="lg:border-r lg:border-zinc-200 lg:dark:border-zinc-800 lg:pr-4">
        <h3 className="text-sm font-medium mb-2">Gold queries</h3>
        <div className="space-y-2 mb-4">
          <textarea
            value={newQueryText}
            onChange={(e) => setNewQueryText(e.target.value)}
            placeholder="Add a new query: 'med spa owners around $1-5M scaling team'"
            rows={3}
            className="w-full text-xs rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1.5"
            maxLength={500}
          />
          <button
            type="button"
            onClick={createQuery}
            className="w-full rounded-md bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-3 py-1.5 text-xs font-medium hover:opacity-90"
          >
            + Add query
          </button>
        </div>
        <ul className="space-y-1">
          {queries.length === 0 && (
            <li className="text-xs text-zinc-500">No queries yet. Add one to start labeling.</li>
          )}
          {queries.map((q) => (
            <li key={q.id} className="group flex items-stretch gap-1">
              <button
                type="button"
                onClick={() => selectQuery(q)}
                className={`flex-1 text-left rounded px-2 py-1.5 text-xs ${
                  activeQuery?.id === q.id
                    ? "bg-zinc-200 dark:bg-zinc-800"
                    : "hover:bg-zinc-100 dark:hover:bg-zinc-900"
                }`}
              >
                <div className="truncate">{q.query_text}</div>
                <div className="text-[10px] text-zinc-500">
                  {q.label_count} label{q.label_count === 1 ? "" : "s"}
                </div>
              </button>
              <button
                type="button"
                onClick={() => deleteQuery(q)}
                title="Delete query (cascades labels)"
                aria-label="Delete query"
                className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition rounded px-2 text-xs text-zinc-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section>
        {!activeQuery && (
          <p className="text-sm text-zinc-500">
            Pick a query from the left to see its top-20 search results and label which are
            relevant.
          </p>
        )}
        {activeQuery && (
          <div>
            <p className="text-sm mb-3">
              <strong>Query:</strong> {activeQuery.query_text}
            </p>
            {loading && <p className="text-sm text-zinc-500">Searching…</p>}
            {!loading && hits.length === 0 && (
              <p className="text-sm text-zinc-500">No results.</p>
            )}
            <ul className="space-y-3">
              {hits.map((h, i) => {
                const lab = labels[h.sessionId];
                return (
                  <li
                    key={h.sessionId}
                    className={`rounded border p-3 text-sm ${
                      lab === "relevant"
                        ? "border-green-400 bg-green-50/40 dark:bg-green-950/30"
                        : lab === "not_relevant"
                          ? "border-red-300 bg-red-50/30 dark:bg-red-950/20"
                          : lab === "partial"
                            ? "border-amber-300 bg-amber-50/30 dark:bg-amber-950/20"
                            : "border-zinc-200 dark:border-zinc-800"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium truncate">
                        {i + 1}. {h.videoTitle || h.videoId}
                      </span>
                      <span className="text-xs text-zinc-500 tabular-nums shrink-0">
                        {fmtTime(h.startS)} → {fmtTime(h.endS)} · judge {h.judgeScore.toFixed(2)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-zinc-700 dark:text-zinc-300">
                      {h.conversationSummary}
                    </p>
                    {h.reason && (
                      <p className="mt-1 text-[11px] text-zinc-500 italic">why: {h.reason}</p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <a
                        href={h.playUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2"
                      >
                        ▶ Open
                      </a>
                      <span className="text-zinc-400">·</span>
                      <LabelButton current={lab} value="relevant" onClick={() => label(h.sessionId, "relevant", i + 1)} />
                      <LabelButton current={lab} value="partial" onClick={() => label(h.sessionId, "partial", i + 1)} />
                      <LabelButton current={lab} value="not_relevant" onClick={() => label(h.sessionId, "not_relevant", i + 1)} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

function LabelButton({
  current,
  value,
  onClick,
}: {
  current: Relevance | undefined;
  value: Relevance;
  onClick: () => void;
}) {
  const labels: Record<Relevance, string> = {
    relevant: "Relevant",
    partial: "Partial",
    not_relevant: "Not relevant",
  };
  const colorClasses: Record<Relevance, string> = {
    relevant: "border-green-500 text-green-700 dark:text-green-300",
    partial: "border-amber-500 text-amber-700 dark:text-amber-300",
    not_relevant: "border-red-500 text-red-700 dark:text-red-300",
  };
  const active = current === value;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-2 py-0.5 text-xs border ${
        active ? `${colorClasses[value]} font-medium` : "border-zinc-300 dark:border-zinc-700"
      }`}
    >
      {labels[value]}
    </button>
  );
}

function RunnerTab({ runs, reloadRuns }: { runs: EvalRunSummary[]; reloadRuns: () => Promise<void> }) {
  const [running, setRunning] = useState(false);
  const [latest, setLatest] = useState<RunReport | null>(null);

  const runEval = async () => {
    setRunning(true);
    try {
      const r = await fetch("/api/eval/run", { method: "POST" });
      if (r.ok) {
        const j = (await r.json()) as RunReport;
        setLatest(j);
        await reloadRuns();
      } else {
        const j = await r.json();
        alert(j.error ?? "Run failed");
      }
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={runEval}
        disabled={running}
        className="rounded-md bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {running ? "Running…" : "Run eval"}
      </button>

      {latest && (
        <section className="mt-6">
          <h3 className="text-sm font-medium mb-2">Latest run · {new Date(latest.ran_at).toLocaleString()}</h3>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
            <Stat label="Precision@5" value={pct(latest.precision_at_5)} />
            <Stat label="Recall@10" value={pct(latest.recall_at_10)} />
            <Stat label="MRR" value={latest.mrr.toFixed(3)} />
            <Stat label="Cost" value={`$${latest.total_cost_usd.toFixed(4)}`} />
            <Stat label="Latency" value={`${latest.total_latency_ms} ms`} />
          </div>

          <h4 className="text-sm font-medium mt-6 mb-2">Per-query</h4>
          <ul className="space-y-2 text-sm">
            {latest.per_query.map((p) => (
              <li key={p.query_id} className="rounded border border-zinc-200 dark:border-zinc-800 p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium truncate">{p.query_text}</span>
                  <span className="text-xs shrink-0 tabular-nums">
                    rank {p.rank_of_first_relevant ?? "miss"} · prec@5 {pct(p.precision_at_5)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-10">
        <h3 className="text-sm font-medium mb-2">History</h3>
        {runs.length === 0 ? (
          <p className="text-xs text-zinc-500">No runs yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {runs.map((r) => (
              <li key={r.id} className="flex items-center justify-between text-xs">
                <span className="tabular-nums">{new Date(r.ran_at).toLocaleString()}</span>
                <span className="text-zinc-500 tabular-nums">
                  prec@5 {pct(Number(r.recall_at_5))} · recall@10 {pct(Number(r.recall_at_10))} · MRR {Number(r.mrr).toFixed(3)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-200 dark:border-zinc-800 p-3">
      <p className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
