import { Topbar } from "@/components/Topbar";
import { Badge } from "@/components/Badge";
import { subscribers, invoices, tickets } from "@/lib/mock-data";
import { formatNaira } from "@/lib/format";
import { notFound } from "next/navigation";

export default function SubscriberDetail({ params }: { params: { id: string } }) {
  const sub = subscribers.find((s) => s.id === params.id);
  if (!sub) notFound();

  const subInvoices = invoices.filter((i) => i.subscriber === sub.name);
  const subTickets = tickets.filter((t) => t.subscriber === sub.name);

  return (
    <>
      <Topbar title={sub.name} subtitle={`${sub.id} · ${sub.type} · ${sub.branch}`} />
      <div className="grid grid-cols-3 gap-4 p-8">
        <div className="col-span-2 space-y-4">
          <div className="rounded border border-border bg-surface p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold">Subscription</h2>
              <Badge status={sub.status} />
            </div>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-muted">Plan</dt>
              <dd>{sub.plan}</dd>
              <dt className="text-muted">Branch</dt>
              <dd>{sub.branch}</dd>
              <dt className="text-muted">Account balance</dt>
              <dd className={sub.balanceKobo < 0 ? "text-critical" : ""}>
                {sub.balanceKobo < 0 ? formatNaira(sub.balanceKobo) : "₦0 — no dues"}
              </dd>
            </dl>
          </div>

          <div className="rounded border border-border bg-surface">
            <div className="border-b border-border px-5 py-3">
              <h2 className="font-display text-sm font-semibold">Invoices</h2>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {subInvoices.length === 0 && (
                  <tr><td className="px-5 py-4 text-muted">No invoices for this subscriber yet.</td></tr>
                )}
                {subInvoices.map((i) => (
                  <tr key={i.id} className="border-b border-border last:border-0">
                    <td className="px-5 py-2.5 font-mono text-xs text-muted">{i.id}</td>
                    <td className="px-5 py-2.5">{formatNaira(i.amountKobo)}</td>
                    <td className="px-5 py-2.5 text-muted">due {i.dueAt}</td>
                    <td className="px-5 py-2.5"><Badge status={i.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded border border-border bg-surface">
            <div className="border-b border-border px-5 py-3">
              <h2 className="font-display text-sm font-semibold">Tickets</h2>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {subTickets.length === 0 && (
                  <tr><td className="px-5 py-4 text-muted">No tickets raised.</td></tr>
                )}
                {subTickets.map((t) => (
                  <tr key={t.id} className="border-b border-border last:border-0">
                    <td className="px-5 py-2.5 font-mono text-xs text-muted">{t.id}</td>
                    <td className="px-5 py-2.5">{t.subject}</td>
                    <td className="px-5 py-2.5"><Badge status={t.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded border border-border bg-surface p-5">
            <h2 className="mb-3 font-display text-sm font-semibold">Quick actions</h2>
            <div className="flex flex-col gap-2">
              <button className="rounded border border-border px-3 py-2 text-left text-sm hover:bg-surface2">Suspend service</button>
              <button className="rounded border border-border px-3 py-2 text-left text-sm hover:bg-surface2">Change plan</button>
              <button className="rounded border border-border px-3 py-2 text-left text-sm hover:bg-surface2">Issue invoice</button>
              <button className="rounded border border-border px-3 py-2 text-left text-sm hover:bg-surface2">View KYC documents</button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
