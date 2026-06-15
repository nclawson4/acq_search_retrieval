// Cost optimization section. Numbers are either recomputed from documented
// unit prices (OpenAI / Deepgram / Anthropic list pricing as of 2026-Q1) or
// pulled from the README's already-verified figures. The savings calculator
// at the bottom is interactive.

import SavingsCalculator from "./SavingsCalculator";

type CostRow = { label: string; detail: string; cost: string };

const INDEX_ROWS: CostRow[] = [
  {
    label: "Transcription",
    detail: "Deepgram nova-3 batch @ $0.0043 / min · 250 hr = 15,000 min",
    cost: "$64.50",
  },
  {
    label: "Tagging + audit",
    detail: "Claude Sonnet 4.6, two passes · ~2,000 sessions × $0.005",
    cost: "$10.00",
  },
  {
    label: "Session embeddings",
    detail: "text-embedding-3-small · 2,000 sessions × $0.000005",
    cost: "$0.01",
  },
  {
    label: "Storage (Blob + Postgres + Qdrant)",
    detail: "Frames + rows + ~12 MB of 1536-d vectors fit in free tiers",
    cost: "~$0",
  },
];

const QUERY_ROWS: CostRow[] = [
  {
    label: "Filter extraction",
    detail: "gpt-4o-mini · 530 in / 100 out tokens",
    cost: "$0.000140",
  },
  {
    label: "Query embedding",
    detail: "text-embedding-3-small · ~30 tokens",
    cost: "$0.0000006",
  },
  {
    label: "LLM judge re-rank",
    detail: "gpt-4o-mini · 250/30 tokens × 30 candidates",
    cost: "$0.001665",
  },
  {
    label: "Vector search (Qdrant)",
    detail: "No marginal cost on the included tier",
    cost: "$0",
  },
  {
    label: "Metadata read (Postgres)",
    detail: "One indexed join per request",
    cost: "$0",
  },
];

function CostCard({
  title,
  rows,
  total,
  totalLabel,
}: {
  title: string;
  rows: CostRow[];
  total: string;
  totalLabel: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-5 flex flex-col">
      <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
        {title}
      </h3>
      <ul className="mt-4 space-y-3 text-sm">
        {rows.map((r) => (
          <li
            key={r.label}
            className="grid grid-cols-[1fr_auto] gap-x-3 items-baseline"
          >
            <div>
              <div className="text-zinc-800 dark:text-zinc-200">{r.label}</div>
              <div className="text-xs text-zinc-500 mt-0.5">{r.detail}</div>
            </div>
            <div className="tabular-nums text-zinc-900 dark:text-zinc-100">
              {r.cost}
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-4 pt-3 border-t border-zinc-200 dark:border-zinc-800 flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wider text-zinc-500">
          {totalLabel}
        </span>
        <span className="text-xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
          {total}
        </span>
      </div>
    </div>
  );
}

export default function CostSection() {
  return (
    <section className="mt-16">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Cost optimization
        </h2>
        <span className="text-xs uppercase tracking-wider text-zinc-500">
          Unit-economics, no hand-waving
        </span>
      </div>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 max-w-3xl">
        Indexing is a one-time per-TB cost. Queries are pay-per-use at fractions
        of a cent. Each number below is recomputed from published list pricing
        (OpenAI, Anthropic, Deepgram).
      </p>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <CostCard
          title="Indexing, per TB of source footage"
          rows={INDEX_ROWS}
          total="~$75"
          totalLabel="Per TB, one-time"
        />
        <CostCard
          title="Per query, what an editor's search costs"
          rows={QUERY_ROWS}
          total="~$0.0018"
          totalLabel="Per query"
        />
      </div>

      <SavingsCalculator />
    </section>
  );
}
