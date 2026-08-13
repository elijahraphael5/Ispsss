import { Topnav } from "@/components/Topnav";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { invoices, currentSubscriber } from "@/lib/mock-data";
import { formatNaira } from "@/lib/format";

export default function BillingPage() {
  return (
    <>
      <Topnav greeting="Billing" />
      <div className="grid grid-cols-3 gap-5 p-8">
        <Card title="Auto renew" className="col-span-1">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">
                {currentSubscriber.plan.autoRenew ? "Turned on" : "Turned off"}
              </div>
              <div className="text-xs text-muted">Renews {currentSubscriber.plan.renewsOn}</div>
            </div>
            <button className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-bg">
              {currentSubscriber.plan.autoRenew ? "Turn off" : "Turn on"}
            </button>
          </div>
        </Card>
        <Card title="Payment method" className="col-span-2">
          <div className="flex items-center justify-between">
            <div className="text-sm">Card ending •••• 4471</div>
            <button className="text-xs font-medium text-brand hover:underline">Update</button>
          </div>
        </Card>

        <Card title="Invoice history" className="col-span-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="pb-3">Invoice</th>
                <th className="pb-3">Issued</th>
                <th className="pb-3">Amount</th>
                <th className="pb-3">Status</th>
                <th className="pb-3 text-right">Receipt</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id} className="border-b border-border last:border-0">
                  <td className="py-3 font-medium">{i.id}</td>
                  <td className="py-3 text-muted">{i.issuedAt}</td>
                  <td className="py-3">{formatNaira(i.amountKobo)}</td>
                  <td className="py-3"><Badge status={i.status} /></td>
                  <td className="py-3 text-right">
                    <button className="text-xs font-medium text-brand hover:underline">
                      {i.status === "PAID" ? "Download" : "Pay now"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
