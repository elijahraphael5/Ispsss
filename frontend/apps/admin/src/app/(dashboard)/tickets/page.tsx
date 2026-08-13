"use client";

import { useState } from "react";
import { Topbar } from "@/components/Topbar";
import { Badge } from "@/components/Badge";
import { tickets, type TicketStatus } from "@/lib/mock-data";

const FILTERS: { label: string; value: TicketStatus | null }[] = [
  { label: "All", value: null },
  { label: "Open", value: "OPEN" },
  { label: "In progress", value: "IN_PROGRESS" },
  { label: "Escalated", value: "ESCALATED" },
  { label: "Resolved", value: "RESOLVED" },
];

export default function TicketsPage() {
  const [active, setActive] = useState<TicketStatus | null>(null);
  const visible = active ? tickets.filter((t) => t.status === active) : tickets;

  return (
    <>
      <Topbar title="Tickets" subtitle="SLA tracking · escalation on breach" />
      <div className="p-8">
        <div className="mb-4 flex gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.label}
              onClick={() => setActive(f.value)}
              className={`rounded px-3 py-1.5 text-sm ${
                active === f.value ? "bg-surface2 text-text" : "text-muted hover:bg-surface2"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="overflow-hidden rounded border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left font-mono text-[11px] uppercase tracking-wide text-muted">
                <th className="px-5 py-2.5">ID</th>
                <th className="px-5 py-2.5">Subject</th>
                <th className="px-5 py-2.5">Subscriber</th>
                <th className="px-5 py-2.5">Priority</th>
                <th className="px-5 py-2.5">Status</th>
                <th className="px-5 py-2.5">SLA</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-muted">
                    No tickets in this view
                  </td>
                </tr>
              )}
              {visible.map((t) => (
                <tr key={t.id} className="border-b border-border last:border-0 hover:bg-surface2">
                  <td className="px-5 py-3 font-mono text-xs text-muted">{t.id}</td>
                  <td className="px-5 py-3">{t.subject}</td>
                  <td className="px-5 py-3 text-muted">{t.subscriber}</td>
                  <td className="px-5 py-3"><Badge status={t.priority} /></td>
                  <td className="px-5 py-3"><Badge status={t.status} /></td>
                  <td className="px-5 py-3 font-mono text-xs text-muted">{t.sla}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
