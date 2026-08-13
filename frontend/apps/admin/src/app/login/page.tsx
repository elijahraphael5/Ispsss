export default function AdminLogin() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-signal shadow-[0_0_8px_theme(colors.signal)]" />
          <span className="font-display text-sm font-semibold tracking-tight">ISP OPS</span>
        </div>
        <h1 className="font-display text-2xl font-semibold">Sign in to the console</h1>
        <p className="mt-1 text-sm text-muted">Staff access only. 2FA required.</p>

        <form className="mt-8 space-y-4">
          <div>
            <label className="mb-1.5 block font-mono text-[11px] uppercase tracking-widest text-muted">
              Work email
            </label>
            <input
              type="email"
              placeholder="you@ispcompany.ng"
              className="w-full rounded border border-border bg-surface px-3 py-2.5 text-sm placeholder:text-muted focus:border-brand"
            />
          </div>
          <div>
            <label className="mb-1.5 block font-mono text-[11px] uppercase tracking-widest text-muted">
              Password
            </label>
            <input
              type="password"
              placeholder="••••••••••"
              className="w-full rounded border border-border bg-surface px-3 py-2.5 text-sm placeholder:text-muted focus:border-brand"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded bg-brand py-2.5 text-sm font-medium text-bg hover:opacity-90"
          >
            Continue
          </button>
        </form>
        <p className="mt-6 text-center font-mono text-[11px] text-muted">
          Locked out? Contact your operations manager.
        </p>
      </div>
    </div>
  );
}
