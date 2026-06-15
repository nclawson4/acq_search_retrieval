"use client";

import { useEffect, useState } from "react";

const EXAMPLES = [
  "female founders building a service business",
  "home services hiring their first sales team",
  "real estate brokers",
  "agency owners around $1-5M with churn problems",
];

const INTERVAL_MS = 3200;
const ANIM_MS = 500;

function fillForm(query: string) {
  const form = document.querySelector(
    "form.hero-form",
  ) as HTMLFormElement | null;
  if (!form) {
    window.location.href = `/?q=${encodeURIComponent(query)}`;
    return;
  }
  const input = form.querySelector(
    'input[name="q"]',
  ) as HTMLInputElement | null;
  if (input) input.value = query;
  form.querySelectorAll("select").forEach((sel) => {
    (sel as HTMLSelectElement).value = "";
  });
  form.requestSubmit();
}

export default function CyclingExample() {
  const [index, setIndex] = useState(0);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    const tick = setInterval(() => {
      setAnimating(true);
      window.setTimeout(() => {
        setIndex((i) => (i + 1) % EXAMPLES.length);
        setAnimating(false);
      }, ANIM_MS);
    }, INTERVAL_MS);
    return () => clearInterval(tick);
  }, []);

  const current = EXAMPLES[index];
  const next = EXAMPLES[(index + 1) % EXAMPLES.length];

  return (
    <div className="mt-2 flex items-center gap-2 text-sm text-zinc-500 select-none">
      <span className="shrink-0">Try one of these:</span>
      <div className="relative h-6 flex-1 overflow-hidden">
        <button
          type="button"
          onClick={() => fillForm(current)}
          aria-hidden={animating}
          className={`absolute inset-0 flex items-center truncate text-left text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-50 hover:underline transition-all ease-out ${
            animating
              ? "-translate-y-full opacity-0 pointer-events-none"
              : "translate-y-0 opacity-100"
          }`}
          style={{ transitionDuration: `${ANIM_MS}ms` }}
        >
          <span className="truncate">{current}</span>
        </button>
        <button
          type="button"
          onClick={() => fillForm(next)}
          aria-hidden={!animating}
          className={`absolute inset-0 flex items-center truncate text-left text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-50 hover:underline transition-all ease-out ${
            animating
              ? "translate-y-0 opacity-100"
              : "translate-y-full opacity-0 pointer-events-none"
          }`}
          style={{ transitionDuration: `${ANIM_MS}ms` }}
        >
          <span className="truncate">{next}</span>
        </button>
      </div>
    </div>
  );
}
