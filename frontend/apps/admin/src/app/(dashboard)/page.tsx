import { Topbar } from "@/components/Topbar";
import { StatCard } from "@/components/StatCard";
import { Badge } from "@/components/Badge";
import { kpis, networkDevices, tickets, revenueTrend } from "@/lib/mock-data";
import { formatNaira } from "@/lib/format";

export default function ExecutiveDashboard() {
  const max = Math.max(...revenueTrend);
  return (
    <>
      <Topbar title="Executive dashboard" subtitle="Live snapshot across all branches" />
      <div className="grid grid-cols-4 gap-4 p-8">
        <StatCard label="Active customers" value={kpis.activeCustomers.toLocaleString()} delta="+128 this week" tone="up" />
        <StatCard label="Online now" value={kpis.onlineNow.toLocaleString()} delta={`${((kpis.onlineNow / kpis.activeCustomers) * 100).toFixed(1)}% of base`} />
        <StatCard label="Revenue today" value={formatNaira(kpis.revenueToday)} delta="+6.2% vs yesterday" tone="up" />
        <StatCard label="Revenue this month" value={formatNaira(kpis.revenueMonth)} />
        <StatCard label="Suspended accounts" value={kpis.suspendedAccounts.toString()} delta="due to overdue billing" tone="down" />
        <StatCard label="Open tickets" value={kpis.openTickets.toString()} delta="3 breaching SLA" tone="down" />
        <StatCard label="Network health" value={`${kpis.networkHealthPct}%`} tone="up" />
        <StatCard label="Bandwidth in use" value={`${(kpis.bandwidthMbps / 1000).toFixed(1)} Gbps`} />
      </div>

      <div className="grid grid-cols-3 gap-4 px-8 pb-8">
        <div className="col-span-2 rounded border border-border bg-surface p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold">Revenue — last 12 months</h2>
            <span className="font-mono text-[11px] text-muted">₦ millions</span>
          </div>
          <div className="flex h-40 items-end gap-2">
            {revenueTrend.map((v, i) => (
              <div key={i} className="flex-1">
                <div
                  className="rounded-t bg-signal/70 transition-all hover:bg-signal"
                  style={{ height: `${(v / max) * 100}%` }}
                  title={`₦${v}m`}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="rounded border border-border bg-surface p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold">Device grid</h2>
            <a href="/noc" className="font-mono text-[11px] text-signal hover:underline">
              full NOC →
            </a>
          </div>
          <div className="grid grid-cols-6 gap-1.5">
            {networkDevices.map((d) => {
              const color =
                d.status === "ONLINE"
                  ? "bg-signal"
                  : d.status === "WARNING"
                  ? "bg-warning"
                  : d.status === "CRITICAL"
                  ? "bg-critical"
                  : "bg-offline";
              return (
                <div
                  key={d.id}
                  title={`${d.name} — ${d.status}`}
                  className={`aspect-square rounded-sm ${color} opacity-90 hover:opacity-100`}
                />
              );
            })}
          </div>
          <div className="mt-4 space-y-1.5 border-t border-border pt-3">
            {networkDevices
              .filter((d) => d.status !== "ONLINE")
              .map((d) => (
                <div key={d.id} className="flex items-center justify-between text-xs">
                  <span className="text-muted">{d.name}</span>
                  <Badge status={d.status} />
                </div>
              ))}
          </div>
        </div>
      </div>

      <div className="px-8 pb-8">
        <div className="rounded border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <h2 className="font-display text-sm font-semibold">Priority tickets</h2>
            <a href="/tickets" className="font-mono text-[11px] text-signal hover:underline">
              all tickets →
            </a>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left font-mono text-[11px] uppercase tracking-wide text-muted">
                <th className="px-5 py-2">ID</th>
                <th className="px-5 py-2">Subject</th>
                <th className="px-5 py-2">Subscriber</th>
                <th className="px-5 py-2">Priority</th>
                <th className="px-5 py-2">Status</th>
                <th className="px-5 py-2">SLA</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id} className="border-b border-border last:border-0 hover:bg-surface2">
                  <td className="px-5 py-2.5 font-mono text-xs text-muted">{t.id}</td>
                  <td className="px-5 py-2.5">{t.subject}</td>
                  <td className="px-5 py-2.5 text-muted">{t.subscriber}</td>
                  <td className="px-5 py-2.5"><Badge status={t.priority} /></td>
                  <td className="px-5 py-2.5"><Badge status={t.status} /></td>
                  <td className="px-5 py-2.5 font-mono text-xs text-muted">{t.sla}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
