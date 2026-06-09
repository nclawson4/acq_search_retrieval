export default function NotFound() {
  return (
    <main className="flex flex-col items-center w-full px-4 sm:px-6 py-16">
      <div className="w-full max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">Not here.</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Whatever URL brought you here doesn&rsquo;t exist on this site.
        </p>
        <p className="mt-6 text-sm">
          <a
            href="/"
            className="underline underline-offset-2 hover:no-underline text-zinc-900 dark:text-zinc-100"
          >
            Go to search
          </a>
        </p>
      </div>
    </main>
  );
}
