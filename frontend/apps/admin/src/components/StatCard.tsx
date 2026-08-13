export function StatCard({
  label,
  value,
  delta,
  tone = "neutral",
}: {
  label: string;
  value: string;
  delta?: string;
  tone?: "up" | "down" | "neutral";
}) {
  const toneColor =
    tone === "up" ? "text-signal" : tone === "down" ? "text-critical" : "text-muted";
  return (
    <div className="rounded border border-border bg-surface p-4">
      <div className="font-mono text-[11px] uppercase tracking-widest text-muted">{label}</div>
      <div className="mt-2 font-display text-2xl font-semibold tabular-nums">{value}</div>
      {delta && <div className={`mt-1 font-mono text-xs ${toneColor}`}>{delta}</div>}
    </div>
  );
}
