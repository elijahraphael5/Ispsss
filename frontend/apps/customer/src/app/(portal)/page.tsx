import { Topnav } from "@/components/Topnav";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { UsageGauge } from "@/components/UsageGauge";
import { currentSubscriber, invoices } from "@/lib/mock-data";
import { formatNaira } from "@/lib/format";

export default function CustomerDashboard() {
  const { plan, usage, network, devices } = currentSubscriber;
  const latestInvoice = invoices.find((i) => i.status === "ISSUED");
  const maxDaily = Math.max(...usage.dailyGb);

  return (
    <>
      <Topnav greeting={`Hi, ${currentSubscriber.name.split(" ")[0]}`} />
      <div className="grid grid-cols-3 gap-5 p-8">
        <Card title="Your plan" className="col-span-2">
          <UsageGauge
            daysElapsed={usage.cycleDaysElapsed}
            daysTotal={usage.cycleDaysTotal}
            usedGb={usage.usedGb}
          />
          <div className="mt-6 flex items-center justify-between rounded-lg bg-bg px-4 py-3">
            <div>
              <div className="font-medium">{plan.name}</div>
              <div className="text-xs text-muted">Renews {plan.renewsOn} · {formatNaira(plan.priceKobo)}/mo</div>
            </div>
            <button className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90">
              Change plan
            </button>
          </div>
        </Card>

        <Card title="Connection">
          <div className="mb-4 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-signal" />
            <span className="text-sm font-medium text-signal">Online</span>
          </div>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">Signal strength</dt>
              <dd className="font-medium">{network.signalStrength}%</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Latency</dt>
              <dd className="font-medium">{network.latencyMs}ms</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Peak speed today</dt>
              <dd className="font-medium">{usage.peakMbps} Mbps</dd>
            </div>
          </dl>
        </Card>

        <Card title="This week's usage" className="col-span-2">
          <div className="flex h-32 items-end gap-3">
            {usage.dailyGb.map((gb, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-2">
                <div
                  className="w-full rounded-t-md bg-brand/80 transition-all hover:bg-brand"
                  style={{ height: `${(gb / maxDaily) * 100}%` }}
                />
                <span className="text-[11px] text-muted">
                  {["M", "T", "W", "T", "F", "S", "S"][i]}
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card
          title="Next bill"
          action={<a href="/billing" className="text-xs font-medium text-brand hover:underline">view all</a>}
        >
          {latestInvoice ? (
            <>
              <div className="font-display text-2xl font-semibold">{formatNaira(latestInvoice.amountKobo)}</div>
              <div className="mt-1 text-xs text-muted">Issued {latestInvoice.issuedAt}</div>
              <div className="mt-4">
                <Badge status={latestInvoice.status} />
              </div>
              <button className="mt-4 w-full rounded-lg bg-brand py-2.5 text-sm font-medium text-white hover:opacity-90">
                Pay now
              </button>
            </>
          ) : (
            <p className="text-sm text-muted">You're all paid up.</p>
          )}
        </Card>

        <Card title="Devices" className="col-span-3">
          <div className="grid grid-cols-2 gap-3">
            {devices.map((d) => (
              <div key={d.name} className="flex items-center justify-between rounded-lg bg-bg px-4 py-3">
                <div>
                  <div className="text-sm font-medium">{d.name}</div>
                  <div className="font-mono text-xs text-muted">{d.ip}</div>
                </div>
                <Badge status={d.status} />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
