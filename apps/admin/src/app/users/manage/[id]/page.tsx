'use client';

import { useEffect, useState } from 'react';
import { api, formatNaira } from '@isp/shared';
import { useParams, useRouter } from 'next/navigation';
import { SkeletonTable } from '../../../../components/Skeleton';
import EditableCustomerFields from '../../../../components/EditableCustomerFields';
import UsageHistoryCard from '../../../../components/UsageHistoryCard';

interface Cpe {
  id: string;
  name: string | null;
  ipAddress: string | null;
  macAddress: string | null;
  status: string;
  connectionType: string;
  installerName: string | null;
  lastSeenAt: string | null;
}

interface CustomerDetail {
  id: string;
  userId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  status: string;
  type: string;
  networkType: string | null;
  plan: string | null;
  planCategory: string | null;
  speedMbps: number | null;
  speedLabel: string | null;
  priceKobo: number | null;
  startedAt: string | null;
  expiresAt: string | null;
  dueAt: string | null;
  dueAmountKobo: number | null;
  dueStatus: string | null;
  cpes: Cpe[];
  createdAt: string;
}

const naira = (kobo: number) => formatNaira(kobo);
const priceDisplay = (kobo: number | null) => (kobo ? naira(kobo) : 'On request');

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: '0.9rem', fontWeight: 600, fontFamily: mono ? 'monospace' : undefined, wordBreak: 'break-word' }}>{value || '—'}</div>
    </div>
  );
}

function badge(label: string, color: string) {
  return <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600, backgroundColor: color + '18', color }}>{label}</span>;
}

function fmtBytes(b: string | null | undefined): string {
  const n = parseInt(b || '0', 10);
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
}

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [leases, setLeases] = useState<any[]>([]);
  const [wireless, setWireless] = useState<any[]>([]);
  const [addrLists, setAddrLists] = useState<any[]>([]);
  const [pingResult, setPingResult] = useState<string>('');
  const [newPw, setNewPw] = useState('');
  const [pwResult, setPwResult] = useState<{ email: string; newPassword: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<'details' | 'edit'>('details');
  const [statusBusy, setStatusBusy] = useState(false);

  useEffect(() => {
    api<CustomerDetail>(`/users/customers/${params.id}`)
      .then(setCustomer)
      .catch((e: any) => setError(e.message || 'Failed to load customer'))
      .finally(() => setLoading(false));
    api<any[]>('/network/devices')
      .then(devices => {
        const dev = devices.find((d: any) => d.routerosUsername);
        if (!dev) return;
        setDeviceId(dev.id);
        Promise.all([
          api<any[]>('/routeros/devices/' + dev.id + '/dhcp-leases').catch(() => []),
          api<any[]>('/routeros/devices/' + dev.id + '/wireless-clients').catch(() => []),
          api<any[]>('/routeros/devices/' + dev.id + '/address-lists').catch(() => []),
        ]).then(([l, w, a]) => { setLeases(l); setWireless(w); setAddrLists(a); });
      })
      .catch(() => {});
  }, [params.id]);

  async function resetPassword() {
    if (!customer) return;
    setBusy(true);
    setToast('');
    setPwResult(null);
    setCopied(false);
    try {
      const res = await api<{ email: string; newPassword: string }>(`/users/${customer.userId}/reset-password`, {
        method: 'POST',
        body: JSON.stringify(newPw.trim() ? { password: newPw.trim() } : {}),
      });
      setPwResult(res);
      setNewPw('');
    } catch (e: any) {
      setToast(e.message || 'Reset failed');
    } finally {
      setBusy(false);
    }
  }

  async function pingAddress(target: string) {
    if (!deviceId) return;
    setBusy(true);
    setPingResult('Pinging...');
    try {
      const res = await api<any[]>('/routeros/devices/' + deviceId + '/ping', { method: 'POST', body: JSON.stringify({ address: target, count: 3 }) });
      const last = res[res.length - 1];
      setPingResult(`${target} · avg ${last['avg-rtt']} · loss ${last['packet-loss']}% · ${last['sent']}/${last['received']} received`);
    } catch (e: any) {
      setPingResult('Ping failed: ' + (e.message || ''));
    } finally {
      setBusy(false);
    }
  }

  async function blockToggle(entry?: any) {
    if (!deviceId) return;
    const ip = customer?.cpes[0]?.ipAddress;
    if (!ip) return;
    setBusy(true);
    setToast('');
    try {
      if (entry) {
        await api(`/routeros/devices/${deviceId}/address-lists/${encodeURIComponent(entry['.id'])}`, { method: 'DELETE' });
        setToast(`Removed ${ip} from list "${entry.list}"`);
        setAddrLists(addrLists.filter(a => a !== entry));
      } else {
        await api(`/routeros/devices/${deviceId}/address-lists`, {
          method: 'POST',
          body: JSON.stringify({ address: ip, list: 'customer-block', comment: `blocked ${customer?.name || customer?.email || ''}` }),
        });
        setToast(`Added ${ip} to firewall list "customer-block"`);
        setAddrLists(await api<any[]>('/routeros/devices/' + deviceId + '/address-lists').catch(() => addrLists));
      }
    } catch (e: any) {
      setToast(e.message || 'Address-list update failed');
    } finally {
      setBusy(false);
    }
  }

  async function toggleConnection() {
    if (!customer) return;
    setBusy(true);
    setToast('');
    try {
      const cpe = customer.cpes[0];
      if (!cpe) throw new Error('No CPE record to toggle');
      if (cpe.connectionType === 'PPPOE') {
        const dev = (await api<any[]>('/network/devices')).find((d: any) => d.routerosUsername);
        if (!dev) throw new Error('No RouterOS device configured');
        const secret = await api<any>(`/routeros/devices/${dev.id}/subscribers/${encodeURIComponent(cpe.name || '')}`);
        const disabled = secret?.disabled === true;
        await api(`/routeros/devices/${dev.id}/subscribers/${encodeURIComponent(cpe.name || '')}`, {
          method: 'PATCH',
          body: JSON.stringify({ disabled: !disabled }),
        });
      }
      const updated = await api<CustomerDetail>(`/users/customers/${customer.id}`);
      setCustomer(updated);
      setToast(cpe?.connectionType === 'PPPOE' ? 'Connection toggled' : 'Static connections have no toggle endpoint yet');
    } catch (e: any) {
      setToast(e.message || 'Operation failed');
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(next: 'ACTIVE' | 'SUSPENDED') {
    if (!customer) return;
    setStatusBusy(true);
    setToast('');
    try {
      await api(`/subscriptions/${customer.id}/${next === 'SUSPENDED' ? 'suspend' : 'unsuspend'}`, { method: 'POST' });
      const updated = await api<CustomerDetail>(`/users/customers/${customer.id}`);
      setCustomer(updated);
      setToast(next === 'SUSPENDED' ? 'Customer suspended' : 'Customer reactivated');
    } catch (e: any) {
      setToast(e.message || 'Status update failed');
    } finally {
      setStatusBusy(false);
    }
  }

  if (loading) {
    return (
      <main style={{ padding: 24 }}>
        <div className="data-card" style={{ padding: 24, marginTop: 20 }}>
          <SkeletonTable rows={8} cols={4} />
        </div>
      </main>
    );
  }

  if (error || !customer) {
    return (
      <main style={{ padding: 24 }}>
        <div style={{ padding: '12px 16px', background: '#FEE2E2', color: '#DC2626', borderRadius: 12, fontSize: '0.85rem' }}>{error || 'Not found'}</div>
      </main>
    );
  }

  const cpe = customer.cpes[0];

  return (
    <main style={{ padding: 24 }}>
      <button onClick={() => router.push('/users/manage')} style={{ border: 'none', background: 'none', color: 'var(--primary)', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', padding: 0, marginBottom: 12 }}>
        ← Back to customers
      </button>

      <div className="page-title-row" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {customer.name || 'Customer'}
            {badge(customer.status, customer.status === 'ACTIVE' ? '#16A34A' : customer.status === 'SUSPENDED' ? '#DC2626' : '#94A3B8')}
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 4 }}>
            {customer.type} &middot; joined {new Date(customer.createdAt).toLocaleDateString()}
            {customer.dueAt && (
              <span style={{ marginLeft: 8 }}>
                &middot; due {new Date(customer.dueAt).toLocaleDateString()}
                {customer.dueAmountKobo ? ` · ${naira(customer.dueAmountKobo)}` : ''}
                {' '}{customer.dueStatus ? badge(customer.dueStatus, customer.dueStatus === 'OVERDUE' ? '#DC2626' : customer.dueStatus === 'PAID' ? '#16A34A' : '#F59E0B') : null}
              </span>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            placeholder="New login password (blank = auto)"
            value={newPw}
            onChange={e => setNewPw(e.target.value)}
            style={{
              padding: '8px 16px', borderRadius: 20, border: '1px solid var(--border-color)', fontSize: '0.85rem',
              fontFamily: 'monospace', width: 200, outline: 'none', background: 'transparent', color: 'var(--text-dark)',
            }}
          />
          <button onClick={resetPassword} disabled={busy} style={{
            padding: '8px 20px', borderRadius: 20, border: '1px solid var(--primary)', background: 'transparent',
            color: 'var(--primary)', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', opacity: busy ? 0.6 : 1,
          }}>
            {busy ? 'Working...' : 'Reset Password'}
          </button>
          <button onClick={toggleConnection} disabled={busy} style={{
            padding: '8px 20px', borderRadius: 20, border: 'none', background: 'var(--primary)', color: '#fff',
            fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', opacity: busy ? 0.6 : 1,
          }}>
            {busy ? 'Working...' : 'Connect / Disconnect'}
          </button>
        </div>
        {pwResult && (
          <div style={{ marginTop: 12, padding: '12px 16px', background: '#DCFCE7', borderRadius: 12, fontSize: '0.85rem', color: '#166534' }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Give this to the customer for their dashboard login:</div>
            <div style={{ fontFamily: 'monospace', fontSize: '1rem', fontWeight: 700 }}>{pwResult.newPassword}</div>
            <button onClick={() => { navigator.clipboard?.writeText(pwResult.newPassword); setCopied(true); }} style={{
              marginTop: 8, padding: '5px 14px', borderRadius: 20, border: '1px solid #16A34A', background: '#fff',
              color: '#16A34A', fontWeight: 600, fontSize: '0.75rem', cursor: 'pointer',
            }}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        )}
      </div>

      {toast && (
        <div style={{ padding: '10px 16px', background: toast.startsWith('Static') ? '#FEF3C7' : toast.startsWith('Connection toggled') ? '#DCFCE7' : '#FEE2E2', color: toast.startsWith('Connection toggled') ? '#16A34A' : toast.startsWith('Static') ? '#92400E' : '#DC2626', borderRadius: 12, marginBottom: 16, fontSize: '0.85rem' }}>
          {toast}
        </div>
      )}

      <div className="data-card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 700 }}>CUSTOMER DETAILS</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['details', 'edit'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding: '5px 16px', borderRadius: 20, border: tab === t ? 'none' : '1px solid var(--border-color)',
                  background: tab === t ? 'var(--primary)' : 'transparent',
                  color: tab === t ? '#fff' : 'var(--text-muted)', fontWeight: 600, fontSize: '0.75rem', cursor: 'pointer',
                }}
              >
                {t === 'details' ? 'Details' : 'Edit'}
              </button>
            ))}
          </div>
        </div>

        {tab === 'details' ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
              <Field label="Name" value={customer.name} />
              <Field label="Email" value={customer.email} />
              <Field label="Phone" value={customer.phone} />
              <Field label="Address" value={customer.address} />
              <Field label="Network" value={customer.networkType} />
              <Field label="Plan" value={customer.plan} />
              <Field label="Installer" value={customer.cpes[0]?.installerName} />
              <Field label="Due Date" value={customer.dueAt ? new Date(customer.dueAt).toLocaleDateString() : null} />
              <Field label="Status" value={customer.status} />
              <Field label="Unique ID" value={customer.id} mono />
            </div>
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border-color)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
                <Field label="Started" value={customer.startedAt ? new Date(customer.startedAt).toLocaleDateString() : null} />
                <Field label="Expires" value={customer.expiresAt ? new Date(customer.expiresAt).toLocaleDateString() : null} />
                <Field label="Monthly Price" value={priceDisplay(customer.priceKobo)} />
                <Field label="Speed" value={customer.speedLabel || (customer.speedMbps ? `${customer.speedMbps} Mbps` : null)} />
                <Field label="Due Amount" value={customer.dueAmountKobo ? naira(customer.dueAmountKobo) : null} />
              </div>
            </div>
          </>
        ) : (
          <>
            <EditableCustomerFields customer={customer} onSaved={setCustomer} />
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border-color)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
                <div>
                  <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Status</div>
                  <select
                    value={customer.status}
                    disabled={statusBusy}
                    onChange={e => setStatus(e.target.value as 'ACTIVE' | 'SUSPENDED')}
                    style={{
                      width: '100%', boxSizing: 'border-box', padding: '8px 12px', borderRadius: 12,
                      border: '1px solid var(--border-color)', fontSize: '0.85rem', background: '#fff',
                      color: 'var(--text-color)', outline: 'none',
                    }}
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="SUSPENDED">SUSPENDED</option>
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Unique ID</div>
                  <div style={{ padding: '8px 12px', borderRadius: 12, border: '1px solid var(--border-color)', background: '#FAFAFA', fontSize: '0.85rem', fontFamily: 'monospace', color: 'var(--text-muted)' }}>{customer.id}</div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {cpe && (
        <div className="data-card" style={{ padding: 24, marginTop: 16 }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: 16 }}>
            CPE / ROUTER{' '}
            {badge(cpe.status, cpe.status === 'ONLINE' || cpe.status === 'ACTIVE' ? '#16A34A' : '#94A3B8')}
            {' '}{badge(cpe.connectionType, cpe.connectionType === 'PPPOE' ? '#2563EB' : '#F15925')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
            <Field label="Name" value={cpe.name} mono />
            <Field label="IP Address" value={cpe.ipAddress} mono />
            <Field label="MAC Address" value={cpe.macAddress} mono />
            <Field label="Installer" value={cpe.installerName} />
            <Field label="Last Seen" value={cpe.lastSeenAt ? new Date(cpe.lastSeenAt).toLocaleString() : null} />
          </div>
        </div>
      )}

      <div className="data-card" style={{ padding: 24, marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 700 }}>ROUTER LINKS</div>
          {cpe?.ipAddress && (
            <button onClick={() => pingAddress(cpe.ipAddress!)} disabled={busy} style={{
              padding: '6px 16px', borderRadius: 20, border: '1px solid var(--primary)', background: 'transparent',
              color: 'var(--primary)', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer', opacity: busy ? 0.6 : 1,
            }}>
              Ping {cpe.ipAddress}
            </button>
          )}
        </div>
        {pingResult && <p style={{ fontSize: '0.85rem', fontWeight: 600, color: pingResult.startsWith('Ping failed') ? '#DC2626' : '#16A34A', marginBottom: 12 }}>{pingResult}</p>}
        {!cpe?.ipAddress && !cpe?.macAddress ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No CPE IP/MAC to look up on the router.</p>
        ) : (
          <div>
            {(() => {
              const ip = cpe!.ipAddress;
              const mac = cpe!.macAddress;
              const lease = ip ? leases.find(l => l.address === ip) : null;
              const links = wireless.filter(w => (mac && w['mac-address'] === mac) || (ip && w.address === ip));
              const entries = ip ? addrLists.filter(a => a.address === ip) : [];
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {lease && (
                    <div>
                      <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>DHCP LEASE</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
                        <Field label="Address" value={lease.address} mono />
                        <Field label="MAC" value={lease['mac-address']} mono />
                        <Field label="Hostname" value={lease['host-name']} />
                        <Field label="Status" value={lease.status} />
                      </div>
                    </div>
                  )}
                  {links.length > 0 && (
                    <div>
                      <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>WIRELESS LINK</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
                        {links.map(w => (
                          <div key={w['.id']}>
                            <Field label="MAC" value={w['mac-address']} mono />
                            <Field label="Signal" value={w['signal-strength'] ?? w.signal} mono />
                            <Field label="SNR" value={w['signal-to-noise'] ?? w.snr} />
                            <Field label="Rate" value={w['last-tx-rate'] ?? w['tx-rate']} />
                            <Field label="Uptime" value={w.uptime} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div>
                    <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>FIREWALL ADDRESS LISTS</div>
                    {entries.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Not in any firewall list.</p>}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {entries.map(e => (
                        <button key={e['.id']} onClick={() => blockToggle(e)} disabled={busy} style={{
                          padding: '6px 14px', borderRadius: 20, border: '1px solid #DC2626', background: '#FEE2E2',
                          color: '#DC2626', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer', opacity: busy ? 0.6 : 1,
                        }}>
                          {e.list} — remove
                        </button>
                      ))}
                      {ip && entries.length === 0 && (
                        <button onClick={() => blockToggle()} disabled={busy} style={{
                          padding: '6px 14px', borderRadius: 20, border: '1px solid #DC2626', background: 'transparent',
                          color: '#DC2626', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer', opacity: busy ? 0.6 : 1,
                        }}>
                          Block at Firewall
                        </button>
                      )}
                    </div>
                  </div>
                  {!lease && links.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>No DHCP lease or wireless registration found for this CPE.</p>}
                </div>
              );
            })()}
          </div>
        )}
      </div>
      <UsageHistoryCard username={cpe && cpe.connectionType === 'PPPOE' ? cpe.name : undefined} ip={cpe && cpe.connectionType !== 'PPPOE' ? cpe.ipAddress : undefined} planSpeedMbps={customer.speedMbps} />
    </main>
  );
}
