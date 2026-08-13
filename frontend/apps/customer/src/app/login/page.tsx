export default function CustomerLogin() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-white">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 6C6 2 10 2 14 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <path d="M4.2 8.4C6.8 5.8 9.2 5.8 11.8 8.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <circle cx="8" cy="12" r="1.4" fill="currentColor" />
            </svg>
          </span>
          <span className="font-display text-base font-semibold tracking-tight">My Internet</span>
        </div>
        <h1 className="font-display text-2xl font-semibold">Welcome back</h1>
        <p className="mt-1 text-sm text-muted">Sign in to manage your plan and bills.</p>

        <form className="mt-8 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs text-muted">Email or phone</label>
            <input
              placeholder="you@example.com"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm placeholder:text-muted focus:border-brand"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-muted">Password</label>
            <input
              type="password"
              placeholder="••••••••••"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm placeholder:text-muted focus:border-brand"
            />
          </div>
          <button type="submit" className="w-full rounded-lg bg-brand py-2.5 text-sm font-medium text-white hover:opacity-90">
            Sign in
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-muted">
          New here? <a href="#" className="font-medium text-brand hover:underline">Create an account</a>
        </p>
      </div>
    </div>
  );
}
