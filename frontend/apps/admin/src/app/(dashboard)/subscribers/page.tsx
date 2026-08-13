import { Topbar } from "@/components/Topbar";
import { Badge } from "@/components/Badge";
import { subscribers } from "@/lib/mock-data";
import { formatNaira } from "@/lib/format";
import Link from "next/link";

export default function SubscribersPage() {
  return (
    <>
      <Topbar title="Subscribers" subtitle={`${subscribers.length.toLocaleString()} shown · filtered by all branches`} />
      <div className="p-8">
        <div className="mb-4 flex items-center gap-3">
          <input
            placeholder="Search name, account ID, phone…"
            className="w-80 rounded border border-border bg-surface px-3 py-2 text-sm placeholder:text-muted focus:border-brand"
          />
          <select className="rounded border border-border bg-surface px-3 py-2 text-sm text-muted">
            <option>All statuses</option>
            <option>Active</option>
            <option>Suspended</option>
            <option>Pending KYC</option>
            <option>Terminated</option>
          </select>
          <button className="ml-auto rounded bg-brand px-3 py-2 text-sm font-medium text-bg hover:opacity-90">
            + New subscriber
          </button>
        </div>

        <div className="overflow-hidden rounded border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left font-mono text-[11px] uppercase tracking-wide text-muted">
                <th className="px-5 py-2.5">Account</th>
                <th className="px-5 py-2.5">Name</th>
                <th className="px-5 py-2.5">Type</th>
                <th className="px-5 py-2.5">Plan</th>
                <th className="px-5 py-2.5">Branch</th>
                <th className="px-5 py-2.5">Status</th>
                <th className="px-5 py-2.5 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {subscribers.map((s) => (
                <tr key={s.id} className="border-b border-border last:border-0 hover:bg-surface2">
                  <td className="px-5 py-3">
                    <Link href={`/subscribers/${s.id}`} className="font-mono text-xs text-signal hover:underline">
                      {s.id}
                    </Link>
                  </td>
                  <td className="px-5 py-3">{s.name}</td>
                  <td className="px-5 py-3 text-muted">{s.type}</td>
                  <td className="px-5 py-3 text-muted">{s.plan}</td>
                  <td className="px-5 py-3 text-muted">{s.branch}</td>
                  <td className="px-5 py-3"><Badge status={s.status} /></td>
                  <td className={`px-5 py-3 text-right font-mono text-xs ${s.balanceKobo < 0 ? "text-critical" : "text-muted"}`}>
                    {s.balanceKobo < 0 ? formatNaira(s.balanceKobo) : "—"}
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
