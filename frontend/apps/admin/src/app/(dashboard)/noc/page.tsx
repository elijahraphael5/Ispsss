import { Topbar } from "@/components/Topbar";
import { Badge } from "@/components/Badge";
import { networkDevices } from "@/lib/mock-data";

const statusColor: Record<string, string> = {
  ONLINE: "bg-signal",
  WARNING: "bg-warning",
  CRITICAL: "bg-critical",
  OFFLINE: "bg-offline",
};

export default function NocPage() {
  const counts = networkDevices.reduce<Record<string, number>>((acc, d) => {
    acc[d.status] = (acc[d.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <Topbar title="Network operations center" subtitle="Polling every 30s · stale after 90s without response" />
      <div className="grid grid-cols-4 gap-4 p-8 pb-0">
        {(["ONLINE", "WARNING", "CRITICAL", "OFFLINE"] as const).map((s) => (
          <div key={s} className="flex items-center gap-3 rounded border border-border bg-surface p-4">
            <span className={`h-2.5 w-2.5 rounded-full ${statusColor[s]}`} />
            <div>
              <div className="font-mono text-[11px] uppercase tracking-widest text-muted">{s}</div>
              <div className="font-display text-xl font-semibold">{counts[s] ?? 0}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="p-8">
        <div className="overflow-hidden rounded border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left font-mono text-[11px] uppercase tracking-wide text-muted">
                <th className="px-5 py-2.5">Device</th>
                <th className="px-5 py-2.5">Name</th>
                <th className="px-5 py-2.5">Type</th>
                <th className="px-5 py-2.5">Status</th>
                <th className="px-5 py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {networkDevices.map((d) => (
                <tr key={d.id} className="border-b border-border last:border-0 hover:bg-surface2">
                  <td className="px-5 py-3 font-mono text-xs text-muted">{d.id}</td>
                  <td className="px-5 py-3">{d.name}</td>
                  <td className="px-5 py-3 text-muted uppercase">{d.type}</td>
                  <td className="px-5 py-3"><Badge status={d.status} /></td>
                  <td className="px-5 py-3 text-right">
                    <button className="font-mono text-[11px] text-signal hover:underline">
                      {d.status === "OFFLINE" || d.status === "CRITICAL" ? "ping →" : "details →"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
