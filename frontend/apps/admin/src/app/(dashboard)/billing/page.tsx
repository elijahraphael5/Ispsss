import { Topbar } from "@/components/Topbar";
import { Badge } from "@/components/Badge";
import { invoices, kpis } from "@/lib/mock-data";
import { formatNaira } from "@/lib/format";

export default function BillingPage() {
  const overdue = invoices.filter((i) => i.status === "OVERDUE");
  return (
    <>
      <Topbar title="Billing & invoices" subtitle="Recurring billing · VAT · penalties" />
      <div className="grid grid-cols-3 gap-4 p-8 pb-0">
        <div className="rounded border border-border bg-surface p-4">
          <div className="font-mono text-[11px] uppercase tracking-widest text-muted">Revenue this month</div>
          <div className="mt-2 font-display text-2xl font-semibold">{formatNaira(kpis.revenueMonth)}</div>
        </div>
        <div className="rounded border border-border bg-surface p-4">
          <div className="font-mono text-[11px] uppercase tracking-widest text-muted">Overdue invoices</div>
          <div className="mt-2 font-display text-2xl font-semibold text-critical">{overdue.length}</div>
        </div>
        <div className="rounded border border-border bg-surface p-4">
          <div className="font-mono text-[11px] uppercase tracking-widest text-muted">Overdue amount</div>
          <div className="mt-2 font-display text-2xl font-semibold text-critical">
            {formatNaira(overdue.reduce((s, i) => s + i.amountKobo, 0))}
          </div>
        </div>
      </div>

      <div className="p-8">
        <div className="overflow-hidden rounded border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left font-mono text-[11px] uppercase tracking-wide text-muted">
                <th className="px-5 py-2.5">Invoice</th>
                <th className="px-5 py-2.5">Subscriber</th>
                <th className="px-5 py-2.5">Amount</th>
                <th className="px-5 py-2.5">Due</th>
                <th className="px-5 py-2.5">Status</th>
                <th className="px-5 py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id} className="border-b border-border last:border-0 hover:bg-surface2">
                  <td className="px-5 py-3 font-mono text-xs text-muted">{i.id}</td>
                  <td className="px-5 py-3">{i.subscriber}</td>
                  <td className="px-5 py-3">{formatNaira(i.amountKobo)}</td>
                  <td className="px-5 py-3 text-muted">{i.dueAt}</td>
                  <td className="px-5 py-3"><Badge status={i.status} /></td>
                  <td className="px-5 py-3 text-right">
                    <button className="font-mono text-[11px] text-signal hover:underline">view →</button>
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
