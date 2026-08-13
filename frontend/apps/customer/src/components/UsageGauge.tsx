export function UsageGauge({
  daysElapsed,
  daysTotal,
  usedGb,
}: {
  daysElapsed: number;
  daysTotal: number;
  usedGb: number;
}) {
  const pct = Math.min(daysElapsed / daysTotal, 1);
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - pct);
  const daysLeft = daysTotal - daysElapsed;

  return (
    <div className="flex items-center gap-8">
      <div className="relative h-[160px] w-[160px] shrink-0">
        <svg width="160" height="160" viewBox="0 0 160 160" className="-rotate-90">
          <circle cx="80" cy="80" r={radius} fill="none" stroke="#E4E9F1" strokeWidth="12" />
          <circle
            cx="80"
            cy="80"
            r={radius}
            fill="none"
            stroke="#2F6FED"
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-all duration-700"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-3xl font-semibold tabular-nums">{daysLeft}</span>
          <span className="text-xs text-muted">days left</span>
        </div>
      </div>
      <div className="flex-1 space-y-4">
        <div>
          <div className="text-xs text-muted">Used this cycle</div>
          <div className="font-display text-2xl font-semibold tabular-nums">{usedGb} GB</div>
        </div>
        <div>
          <div className="text-xs text-muted">Plan</div>
          <div className="text-sm font-medium">Unlimited — no data cap</div>
        </div>
      </div>
    </div>
  );
}
