interface PageProps {
  searchParams: Promise<{ from?: string; error?: string }>;
}

export default async function LoginPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const from = sp.from ?? "/";
  const hasError = sp.error === "1";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold mb-2">Demo access</h1>
        <p className="text-sm text-zinc-500 mb-6">Enter the demo password to continue.</p>
        <form method="post" action="/api/login" className="space-y-3">
          <input type="hidden" name="from" value={from} />
          <input
            type="password"
            name="password"
            autoFocus
            required
            placeholder="Password"
            className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100"
          />
          <button
            type="submit"
            className="w-full rounded-md bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-3 text-sm font-medium hover:opacity-90"
          >
            Continue
          </button>
          {hasError && (
            <p className="text-xs text-red-600 dark:text-red-400">Incorrect password.</p>
          )}
        </form>
      </div>
    </main>
  );
}
