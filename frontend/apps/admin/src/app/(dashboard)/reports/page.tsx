import { Topbar } from "@/components/Topbar";

const REPORTS = [
  { name: "Revenue report", desc: "Monthly revenue by branch and plan" },
  { name: "Subscriber report", desc: "Growth, churn, and status breakdown" },
  { name: "Churn report", desc: "Cancellations and suspensions by reason" },
  { name: "Usage report", desc: "Bandwidth consumption trends" },
  { name: "Ticket report", desc: "SLA compliance and resolution time" },
  { name: "Network health report", desc: "Device uptime across branches" },
];

export default function ReportsPage() {
  return (
    <>
      <Topbar title="Reports" subtitle="Export as PDF, Excel, or CSV" />
      <div className="grid grid-cols-3 gap-4 p-8">
        {REPORTS.map((r) => (
          <div key={r.name} className="rounded border border-border bg-surface p-5">
            <h3 className="font-display text-sm font-semibold">{r.name}</h3>
            <p className="mt-1 text-xs text-muted">{r.desc}</p>
            <div className="mt-4 flex gap-2">
              {["PDF", "Excel", "CSV"].map((f) => (
                <button key={f} className="rounded border border-border px-2.5 py-1 font-mono text-[11px] text-muted hover:bg-surface2 hover:text-text">
                  {f}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
