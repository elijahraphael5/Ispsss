import { Topnav } from "@/components/Topnav";
import { Card } from "@/components/Card";
import { currentSubscriber } from "@/lib/mock-data";

export default function AccountPage() {
  return (
    <>
      <Topnav greeting="Account" />
      <div className="grid grid-cols-3 gap-5 p-8">
        <Card title="Profile" className="col-span-2">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs text-muted">Full name</label>
              <input defaultValue={currentSubscriber.name} className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm focus:border-brand" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs text-muted">Account ID</label>
              <input defaultValue={currentSubscriber.accountId} disabled className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-muted" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs text-muted">Email</label>
              <input defaultValue="adaeze.okonkwo@example.com" className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm focus:border-brand" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs text-muted">Phone</label>
              <input defaultValue="+234 801 234 5678" className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm focus:border-brand" />
            </div>
          </div>
          <button className="mt-5 rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white hover:opacity-90">
            Save changes
          </button>
        </Card>

        <Card title="Security">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Two-factor auth</div>
                <div className="text-xs text-muted">Extra layer at login</div>
              </div>
              <button className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-bg">
                Enable
              </button>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Password</div>
                <div className="text-xs text-muted">Last changed 3 months ago</div>
              </div>
              <button className="text-xs font-medium text-brand hover:underline">Change</button>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
