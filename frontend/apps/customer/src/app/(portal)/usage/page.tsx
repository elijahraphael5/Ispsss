import { Topnav } from "@/components/Topnav";
import { Card } from "@/components/Card";
import { currentSubscriber } from "@/lib/mock-data";

export default function UsagePage() {
  const { usage, plan } = currentSubscriber;
  const maxDaily = Math.max(...usage.dailyGb);
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <>
      <Topnav greeting="Data usage" />
      <div className="grid grid-cols-3 gap-5 p-8">
        <Card title="Used this cycle">
          <div className="font-display text-3xl font-semibold">{usage.usedGb} GB</div>
          <div className="mt-1 text-xs text-muted">
            {usage.cycleDaysTotal - usage.cycleDaysElapsed} days left in cycle
          </div>
        </Card>
        <Card title="Peak speed today">
          <div className="font-display text-3xl font-semibold">{usage.peakMbps} Mbps</div>
          <div className="mt-1 text-xs text-muted">plan speed {plan.speedMbps} Mbps</div>
        </Card>
        <Card title="Plan type">
          <div className="font-display text-3xl font-semibold">Unlimited</div>
          <div className="mt-1 text-xs text-muted">no data cap on {plan.name}</div>
        </Card>

        <Card title="Daily breakdown" className="col-span-3">
          <div className="flex h-48 items-end gap-4">
            {usage.dailyGb.map((gb, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-2">
                <span className="text-xs font-medium text-muted">{gb} GB</span>
                <div
                  className="w-full rounded-t-md bg-signal/80 transition-all hover:bg-signal"
                  style={{ height: `${(gb / maxDaily) * 100}%` }}
                />
                <span className="text-xs text-muted">{days[i]}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
