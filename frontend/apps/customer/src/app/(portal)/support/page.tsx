import { Topnav } from "@/components/Topnav";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { tickets } from "@/lib/mock-data";

export default function SupportPage() {
  return (
    <>
      <Topnav greeting="Support" />
      <div className="grid grid-cols-3 gap-5 p-8">
        <Card title="Open a ticket" className="col-span-1">
          <form className="space-y-3">
            <input
              placeholder="What's going on?"
              className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm placeholder:text-muted focus:border-brand"
            />
            <textarea
              placeholder="Add details — when it started, what you've tried…"
              rows={4}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm placeholder:text-muted focus:border-brand"
            />
            <button type="button" className="w-full rounded-lg bg-brand py-2.5 text-sm font-medium text-white hover:opacity-90">
              Submit ticket
            </button>
          </form>
        </Card>

        <Card title="Your tickets" className="col-span-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="pb-3">Ticket</th>
                <th className="pb-3">Subject</th>
                <th className="pb-3">Updated</th>
                <th className="pb-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id} className="border-b border-border last:border-0">
                  <td className="py-3 font-medium">{t.id}</td>
                  <td className="py-3">{t.subject}</td>
                  <td className="py-3 text-muted">{t.updatedAt}</td>
                  <td className="py-3 text-right"><Badge status={t.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
