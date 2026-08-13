"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { section: "Overview", items: [{ href: "/", label: "Executive dashboard" }] },
  {
    section: "Operations",
    items: [
      { href: "/subscribers", label: "Subscribers" },
      { href: "/noc", label: "Network / NOC" },
      { href: "/tickets", label: "Tickets" },
    ],
  },
  {
    section: "Finance",
    items: [{ href: "/billing", label: "Billing & invoices" }],
  },
  {
    section: "Insight",
    items: [{ href: "/reports", label: "Reports" }],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-5 py-4">
        <span className="h-2 w-2 rounded-full bg-signal shadow-[0_0_8px_theme(colors.signal)]" />
        <span className="font-display text-sm font-semibold tracking-tight">ISP OPS</span>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {NAV.map((group) => (
          <div key={group.section} className="mb-5">
            <div className="mb-1.5 px-2 font-mono text-[10px] uppercase tracking-widest text-muted">
              {group.section}
            </div>
            {group.items.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`block rounded px-2 py-1.5 text-sm transition-colors ${
                    active
                      ? "bg-surface2 text-text"
                      : "text-muted hover:bg-surface2 hover:text-text"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={`h-1 w-1 rounded-full ${active ? "bg-signal" : "bg-transparent"}`}
                    />
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="border-t border-border px-4 py-3">
        <div className="font-mono text-[10px] text-muted">v0.1.0 · api/v1 · staging</div>
      </div>
    </aside>
  );
}
