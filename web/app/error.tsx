"use client";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex flex-col items-center w-full px-4 sm:px-6 py-16">
      <div className="w-full max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">Something broke.</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          The search service is briefly unavailable. Try the request again — if it keeps failing,
          come back in a minute.
        </p>
        <div className="mt-6 flex gap-3 text-sm">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-md bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 hover:bg-zinc-800 dark:hover:bg-zinc-200"
          >
            Try again
          </button>
          <a
            href="/"
            className="rounded-md border border-zinc-300 dark:border-zinc-700 px-4 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            Go home
          </a>
        </div>
      </div>
    </main>
  );
}
