export function Topnav({ greeting }: { greeting: string }) {
  return (
    <header className="flex items-center justify-between border-b border-border bg-surface px-8 py-5">
      <div>
        <p className="text-sm text-muted">Welcome back</p>
        <h1 className="font-display text-xl font-semibold">{greeting}</h1>
      </div>
      <div className="flex items-center gap-3">
        <button className="rounded-lg border border-border px-3 py-2 text-sm text-muted hover:bg-bg">
          Get help
        </button>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand/10 text-sm font-medium text-brand">
          AO
        </div>
      </div>
    </header>
  );
}
