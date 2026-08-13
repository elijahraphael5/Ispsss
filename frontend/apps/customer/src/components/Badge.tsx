const STATUS_STYLES: Record<string, string> = {
  ONLINE: "bg-signal/10 text-signal",
  ACTIVE: "bg-signal/10 text-signal",
  PAID: "bg-signal/10 text-signal",
  RESOLVED: "bg-signal/10 text-signal",
  ISSUED: "bg-warning/10 text-warning",
  OPEN: "bg-brand/10 text-brand",
  OVERDUE: "bg-critical/10 text-critical",
  CLOSED: "bg-border text-muted",
};

export function Badge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status] ?? "bg-border text-muted";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ")}
    </span>
  );
}
