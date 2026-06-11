"use client";

import { useEffect, useState } from "react";

const STAGES = [
  "Understanding your query",
  "Embedding semantic context",
  "Searching 71 attendee sessions",
  "Ranking with LLM judge",
  "Finalizing top matches",
];

const STAGE_MS = 650;

export default function SearchProgressBar() {
  const [pending, setPending] = useState(false);
  const [stageIdx, setStageIdx] = useState(0);

  useEffect(() => {
    const form = document.querySelector(
      "form.hero-form",
    ) as HTMLFormElement | null;
    if (!form) return;
    const onSubmit = () => {
      setPending(true);
      setStageIdx(0);
    };
    form.addEventListener("submit", onSubmit);
    return () => form.removeEventListener("submit", onSubmit);
  }, []);

  useEffect(() => {
    if (!pending) return;
    if (stageIdx >= STAGES.length - 1) return;
    const t = setTimeout(() => setStageIdx((p) => p + 1), STAGE_MS);
    return () => clearTimeout(t);
  }, [pending, stageIdx]);

  if (!pending) return null;

  const progress = ((stageIdx + 1) / STAGES.length) * 100;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-24 sm:pt-32 pointer-events-none bg-black/30 backdrop-blur-[2px]">
      <div className="pointer-events-auto rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 w-full max-w-[360px] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.35)]">
        <div className="px-5 pt-4 pb-3 border-b border-zinc-100 dark:border-zinc-900">
          <div className="text-[10px] uppercase tracking-[0.18em] font-semibold text-zinc-500 dark:text-zinc-400">
            Searching
          </div>
          <div className="mt-0.5 text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {STAGES[stageIdx]}
          </div>
        </div>

        <ul className="px-5 py-4 space-y-2.5">
          {STAGES.map((s, i) => {
            const done = i < stageIdx;
            const active = i === stageIdx;
            return (
              <li key={i} className="flex items-center gap-3 text-sm">
                <span className="w-4 h-4 flex items-center justify-center shrink-0">
                  {done ? (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-zinc-900 dark:text-zinc-100"
                      aria-hidden
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : active ? (
                    <span className="relative w-2.5 h-2.5">
                      <span className="absolute inset-0 rounded-full bg-zinc-900 dark:bg-zinc-100" />
                      <span className="absolute inset-0 rounded-full bg-zinc-900 dark:bg-zinc-100 animate-ping opacity-60" />
                    </span>
                  ) : (
                    <span className="w-2 h-2 rounded-full border border-zinc-300 dark:border-zinc-700" />
                  )}
                </span>
                <span
                  className={
                    active
                      ? "text-zinc-900 dark:text-zinc-100 font-medium"
                      : done
                        ? "text-zinc-500 dark:text-zinc-400"
                        : "text-zinc-400 dark:text-zinc-600"
                  }
                >
                  {s}
                </span>
              </li>
            );
          })}
        </ul>

        <div className="px-5 pb-4">
          <div className="h-1 rounded-full overflow-hidden bg-zinc-100 dark:bg-zinc-900">
            <div
              className="h-full bg-zinc-900 dark:bg-zinc-100 transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
