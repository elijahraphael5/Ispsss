const STATUS_STYLES: Record<string, string> = {
  ONLINE: "bg-signal/15 text-signal border-signal/30",
  ACTIVE: "bg-signal/15 text-signal border-signal/30",
  PAID: "bg-signal/15 text-signal border-signal/30",
  RESOLVED: "bg-signal/15 text-signal border-signal/30",

  WARNING: "bg-warning/15 text-warning border-warning/30",
  ISSUED: "bg-warning/15 text-warning border-warning/30",
  IN_PROGRESS: "bg-warning/15 text-warning border-warning/30",
  PENDING_KYC: "bg-warning/15 text-warning border-warning/30",
  MEDIUM: "bg-warning/15 text-warning border-warning/30",
  HIGH: "bg-warning/15 text-warning border-warning/30",

  CRITICAL: "bg-critical/15 text-critical border-critical/30",
  OVERDUE: "bg-critical/15 text-critical border-critical/30",
  ESCALATED: "bg-critical/15 text-critical border-critical/30",
  SUSPENDED: "bg-critical/15 text-critical border-critical/30",
  TERMINATED: "bg-critical/15 text-critical border-critical/30",

  OFFLINE: "bg-offline/15 text-muted border-offline/30",
  OPEN: "bg-offline/15 text-muted border-offline/30",
  CLOSED: "bg-offline/15 text-muted border-offline/30",
  LOW: "bg-offline/15 text-muted border-offline/30",
  DRAFT: "bg-offline/15 text-muted border-offline/30",
  VOID: "bg-offline/15 text-muted border-offline/30",
};

export function Badge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status] ?? STATUS_STYLES.OFFLINE;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide ${cls}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status.replace(/_/g, " ")}
    </span>
  );
}
