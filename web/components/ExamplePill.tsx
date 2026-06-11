"use client";

export default function ExamplePill({ query }: { query: string }) {
  return (
    <button
      type="button"
      onClick={() => {
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
      }}
      className="inline-block rounded-full border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-xs hover:border-zinc-500 dark:hover:border-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition cursor-pointer"
    >
      {query}
    </button>
  );
}
