"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/usage", label: "Usage" },
  { href: "/billing", label: "Billing" },
  { href: "/support", label: "Support" },
  { href: "/account", label: "Account" },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="flex h-screen w-56 shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex items-center gap-2 px-6 py-6">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-white">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2 6C6 2 10 2 14 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M4.2 8.4C6.8 5.8 9.2 5.8 11.8 8.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <circle cx="8" cy="12" r="1.4" fill="currentColor" />
          </svg>
        </span>
        <span className="font-display text-base font-semibold tracking-tight">My Internet</span>
      </div>
      <nav className="flex-1 px-4">
        {NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`mb-1 block rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                active ? "bg-brand/10 text-brand" : "text-muted hover:bg-bg hover:text-text"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="m-4 rounded-lg bg-bg p-4">
        <div className="mb-1 flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-signal" />
          <span className="text-xs font-medium text-signal">Connected</span>
        </div>
        <p className="text-xs text-muted">Everything is working normally.</p>
      </div>
    </aside>
  );
}
