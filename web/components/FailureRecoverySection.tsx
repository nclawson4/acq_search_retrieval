// Failure-recovery section. Describes what catches each external failure
// mode.

import type { ReactNode } from "react";

interface Item {
  title: string;
  body: ReactNode;
}

const ITEMS: Item[] = [
  {
    title: "Rate limiter fails closed",
    body: (
      <>
        If Upstash Redis is unreachable, search APIs return{" "}
        <code className="rounded bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 text-[11px]">
          503
        </code>{" "}
        rather than letting OpenAI cost through unmetered. Enforced in{" "}
        <code className="rounded bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 text-[11px]">
          proxy.ts
        </code>
        .
      </>
    ),
  },
  {
    title: "Daily cost ceiling",
    body: (
      <>
        Rolling 24-hour sum of inference cost from{" "}
        <code className="rounded bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 text-[11px]">
          query_log
        </code>
        ; once{" "}
        <code className="rounded bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 text-[11px]">
          DAILY_COST_CEILING_USD
        </code>{" "}
        is hit the route returns 429 until UTC midnight. Defends against
        cost-exhaustion abuse on a public demo.
      </>
    ),
  },
  {
    title: "User-facing error boundary",
    body: (
      <>
        Generic{" "}
        <code className="rounded bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 text-[11px]">
          app/error.tsx
        </code>{" "}
        with retry. No stack traces leak to visitors.
      </>
    ),
  },
  {
    title: "Per-dependency health probes",
    body: (
      <>
        Postgres, Qdrant, OpenAI, and Redis are each probed with a 4-second
        timeout. Probes run in parallel and the per-dep result lands in{" "}
        <code className="rounded bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 text-[11px]">
          /api/status
        </code>
        , so one slow dependency can't hide behind the others.
      </>
    ),
  },
  {
    title: "Hourly cron probe + alert hook",
    body: (
      <>
        Vercel cron pings{" "}
        <code className="rounded bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 text-[11px]">
          /api/health/check
        </code>{" "}
        on the hour. Each tick is persisted to{" "}
        <code className="rounded bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 text-[11px]">
          health_checks
        </code>{" "}
        for forensic replay; if any required dep is down the snapshot is POSTed
        to{" "}
        <code className="rounded bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 text-[11px]">
          ALERT_WEBHOOK_URL
        </code>{" "}
        (Slack-compatible).
      </>
    ),
  },
  {
    title: "On-call runbook",
    body: (
      <>
        Per-dependency failure modes and the first three things to check are
        documented in{" "}
        <code className="rounded bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 text-[11px]">
          docs/failure-recovery.md
        </code>
        .
      </>
    ),
  },
];

export default function FailureRecoverySection() {
  return (
    <section className="mt-16">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Failure recovery
        </h2>
        <span className="text-xs uppercase tracking-wider text-zinc-500">
          What breaks first, and what catches it
        </span>
      </div>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 max-w-3xl">
        The system has four external dependencies: Postgres, Qdrant, OpenAI,
        and Redis. Each can fail. Below is what catches each failure today.
      </p>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-3">
        {ITEMS.map((it) => (
          <div
            key={it.title}
            className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4"
          >
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {it.title}
            </h3>
            <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
              {it.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
