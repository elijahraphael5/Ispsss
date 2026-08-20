'use client';

import { Fragment, useEffect, useState } from 'react';
import { api, formatNaira } from '@isp/shared';
import { useParams, useRouter } from 'next/navigation';
import { SkeletonTable } from '../../../../../components/Skeleton';
import EditableCustomerFields from '../../../../../components/EditableCustomerFields';
import UsageHistoryCard from '../../../../../components/UsageHistoryCard';

interface Secret {
  id: string;
  username: string;
  profile: string | null;
  comment: string | null;
  disabled: boolean;
  lastCallerId: string | null;
  lastLoggedOut: string | null;
  lastDisconnectReason: string | null;
  cached?: boolean;
  capturedAt?: string | null;
  [k: string]: unknown;
}

interface SnapshotRow {
  id: string;
  username: string;
  customer: string;
  plan: string | null;
  profile: string | null;
  active: boolean;
  lastCallerId: string | null;
  lastDisconnectReason: string | null;
  lastLoggedOut: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  installerName: string | null;
  dueAt: string | null;
  capturedAt: string;
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

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: '0.9rem', fontWeight: 600, fontFamily: mono ? 'monospace' : undefined, wordBreak: 'break-word' }}>{value || '—'}</div>
    </div>
  );
}

export default function PppoeDetailPage() {
  const params = useParams<{ username: string }>();
  const router = useRouter();
  const username = decodeURIComponent(params.username);
  const [secret, setSecret] = useState<Secret | null>(null);
  const [cust, setCust] = useState<any | null>(null);
  const [snapshot, setSnapshot] = useState<SnapshotRow | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [queues, setQueues] = useState<any[]>([]);
  const [leases, setLeases] = useState<any[]>([]);
  const [wireless, setWireless] = useState<any[]>([]);
  const [addrLists, setAddrLists] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any[]>([]);
  const [pingResult, setPingResult] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [newPw, setNewPw] = useState('');
  const [pwResult, setPwResult] = useState<{ email: string; newPassword: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<'details' | 'edit'>('details');
  const [statusBusy, setStatusBusy] = useState(false);
  const [radiusUsage, setRadiusUsage] = useState<any | null>(null);
  const [radiusLoading, setRadiusLoading] = useState(false);
  const [radiusPlan, setRadiusPlan] = useState('');
  const [radiusBusy, setRadiusBusy] = useState(false);

  const radiusCustomerId = cust?.id as string | undefined;

  async function loadRadiusUsage() {
    if (!radiusCustomerId) return;
    setRadiusLoading(true);
    try {
      setRadiusUsage(await api<any>(`/customers/${radiusCustomerId}/radius/usage`));
    } catch {
      setRadiusUsage(null);
    } finally {
      setRadiusLoading(false);
    }
  }

  useEffect(() => {
    if (radiusCustomerId) {
      void loadRadiusUsage();
    }
  }, [radiusCustomerId]);

  async function radiusAction(action: 'activate' | 'deactivate') {
    if (!radiusCustomerId) return;
    setRadiusBusy(true);
    try {
      await api(`/customers/${radiusCustomerId}/radius/${action}`, { method: 'POST', body: '{}' });
      setToast(`${action === 'activate' ? 'Activated' : 'Deactivated'} on RADIUS`);
      void loadRadiusUsage();
    } catch (e: any) {
      setToast(`${action} failed: ${e?.message ?? e}`);
    } finally {
      setRadiusBusy(false);
    }
  }

  async function radiusApplyPlan() {
    if (!radiusCustomerId || !radiusPlan.trim()) return;
    setRadiusBusy(true);
    try {
      await api(`/customers/${radiusCustomerId}/radius/change-plan`, {
        method: 'POST',
        body: JSON.stringify({ rateLimit: radiusPlan.trim() }),
      });
      setToast(`Rate limit set to ${radiusPlan.trim()}`);
      setRadiusPlan('');
      void loadRadiusUsage();
    } catch (e: any) {
      setToast(`change-plan failed: ${e?.message ?? e}`);
    } finally {
      setRadiusBusy(false);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const devices = await api<any[]>('/network/devices');
        const dev = devices.find((d: any) => d.routerosUsername);
        if (!dev) throw new Error('No RouterOS device configured');
        setDeviceId(dev.id);
        const [customers, snapshots] = await Promise.all([
          api<any[]>('/users/customers').catch(() => []),
          api<SnapshotRow[]>('/routeros/snapshots').catch(() => []),
        ]);
        const snap = snapshots.find(s => s.username === username) || null;
        setSnapshot(snap);
        setCust(customers.find(c => c.name === username || c.email === username || c.cpes?.some((cp: any) => cp.name === username)) || null);
        try {
          const subs = await api<Secret[]>(`/routeros/devices/${dev.id}/subscribers`);
          const found = subs.find(s => s.username === username);
          if (found) {
            setSecret(found);
            setLoading(false);
            return;
          }
          throw new Error(`No PPPoE subscriber "${username}"`);
        } catch {
          if (snap) {
            setSecret({
              id: snap.id,
              username: snap.username,
              profile: snap.profile || snap.plan,
              comment: snap.customer,
              disabled: !snap.active,
              lastCallerId: snap.lastCallerId,
              lastLoggedOut: snap.lastLoggedOut,
              lastDisconnectReason: snap.lastDisconnectReason,
              cached: true,
              capturedAt: snap.capturedAt,
            } as unknown as Secret);
          } else {
            throw new Error(`No PPPoE subscriber "${username}" and no snapshot`);
          }
        }
      } catch (e: any) {
        setError(e.message || 'Failed to load subscriber');
      } finally {
        setLoading(false);
      }
    })();
  }, [username]);

  useEffect(() => {
    if (!deviceId) return;
    (async () => {
      const [s, q, l, w, a, lg, m] = await Promise.all([
        api<any[]>('/routeros/devices/' + deviceId + '/sessions').catch(() => []),
        api<any[]>('/routeros/devices/' + deviceId + '/queues').catch(() => []),
        api<any[]>('/routeros/devices/' + deviceId + '/dhcp-leases').catch(() => []),
        api<any[]>('/routeros/devices/' + deviceId + '/wireless-clients').catch(() => []),
        api<any[]>('/routeros/devices/' + deviceId + '/address-lists').catch(() => []),
        api<any[]>('/routeros/devices/' + deviceId + '/logs?limit=100').catch(() => []),
        api<any[]>('/routeros/metrics?username=' + encodeURIComponent(username) + '&limit=30').catch(() => []),
      ]);
      setSessions(s); setQueues(q); setLeases(l); setWireless(w); setAddrLists(a); setLogs(lg); setMetrics(m);
    })();
  }, [deviceId, username]);

  async function saveSnapshotProfile() {
    if (!snapshot) return;
    setBusy(true);
    setToast('');
    try {
      const updated = await api<SnapshotRow>(`/routeros/snapshots/${encodeURIComponent(username)}`, {
        method: 'PATCH',
        body: JSON.stringify(snapshotProfile),
      });
      setSnapshot(s => s ? { ...s, ...updated } : s);
      setToast('Saved to database');
    } catch (e: any) {
      setToast(e.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  const [snapshotProfile, setSnapshotProfile] = useState({ name: '', email: '', phone: '', address: '', installerName: '', plan: '', dueAt: '' });
  const [plans, setPlans] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<any[]>([]);

  useEffect(() => {
    api<any[]>('/subscriptions/plans').then(setPlans).catch(() => {});
  }, []);

  useEffect(() => {
    if (deviceId) api<any[]>('/routeros/devices/' + deviceId + '/ppp-profiles').then(setProfiles).catch(() => {});
  }, [deviceId]);

  const profileSpeed = (name: string | null | undefined): string | null => {
    if (!name) return null;
    const p = profiles.find(x => x.name === name);
    const first = p?.['rate-limit'] ? String(p['rate-limit']).split(' ')[0] : null;
    return first || null;
  };

  const fmtLimit = (v: string | null | undefined): string | null => {
    if (!v) return null;
    return String(v).split('/').map(s => {
      const n = parseInt(s, 10);
      return n && n % 1e6 === 0 ? `${n / 1e6}M` : s;
    }).join('/');
  };

  async function updateSpeed(next: string) {
    if (!secret || !deviceId) return;
    setStatusBusy(true);
    setToast('');
    try {
      const res = await api<any>(`/routeros/devices/${deviceId}/subscribers/${encodeURIComponent(secret.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ profile: next }),
      });
      const myq = myQueues[0];
      const pair = profileSpeed(next);
      if (myq?.['.id'] && myq?.dynamic !== 'true' && pair) {
        await api(`/routeros/devices/${deviceId}/queues/${encodeURIComponent(myq['.id'])}`, {
          method: 'PATCH',
          body: JSON.stringify({ 'max-limit': pair }),
        }).catch(() => {});
      }
      setSecret({ ...secret, profile: next });
      setToast(res?.status === 'pending'
        ? 'Speed change queued — router appears offline, it will apply when the router is back'
        : `Speed updated — profile "${next}" applied on the router`);
    } catch (e: any) {
      setToast(e.message || 'Speed update failed');
    } finally {
      setStatusBusy(false);
    }
  }

  useEffect(() => {
    if (snapshot) {
      setSnapshotProfile({
        name: snapshot.name ?? '',
        email: snapshot.email ?? '',
        phone: snapshot.phone ?? '',
        address: snapshot.address ?? '',
        installerName: snapshot.installerName ?? '',
        plan: snapshot.plan ?? '',
        dueAt: snapshot.dueAt ? new Date(snapshot.dueAt).toISOString().slice(0, 10) : '',
      });
    }
  }, [snapshot]);

  async function toggleDisabled() {
    if (!secret || !deviceId) return;
    setBusy(true);
    setToast('');
    try {
      const updated = await api<Secret>(`/routeros/devices/${deviceId}/subscribers/${encodeURIComponent(secret.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ disabled: secret.disabled ? 'false' : 'true' }),
      });
      setSecret({ ...secret, disabled: updated.disabled ?? !secret.disabled });
      setToast(updated.disabled ? 'Subscriber suspended' : 'Subscriber re-enabled');
    } catch (e: any) {
      setToast(e.message || 'Operation failed');
    } finally {
      setBusy(false);
    }
  }

  async function setSecretStatus(next: 'ACTIVE' | 'SUSPENDED') {
    if (!secret || !deviceId) return;
    setStatusBusy(true);
    setToast('');
    try {
      const updated = await api<Secret>(`/routeros/devices/${deviceId}/subscribers/${encodeURIComponent(secret.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ disabled: next === 'SUSPENDED' ? 'true' : 'false' }),
      });
      setSecret({ ...secret, disabled: updated.disabled ?? next === 'SUSPENDED' });
      setToast(next === 'SUSPENDED' ? 'Subscriber suspended' : 'Subscriber re-enabled');
    } catch (e: any) {
      setToast(e.message || 'Operation failed');
    } finally {
      setStatusBusy(false);
    }
  }

  async function disconnectSession() {
    if (!deviceId) return;
    const sess = mySession;
    if (!sess) return;
    setBusy(true);
    setToast('');
    try {
      await api(`/routeros/devices/${deviceId}/sessions/${encodeURIComponent(sess['.id'] || sess['session-id'])}/disconnect`, { method: 'POST' });
      setToast('Session disconnected');
      setSessions(sessions.filter(s => s !== sess));
    } catch (e: any) {
      setToast(e.message || 'Disconnect failed');
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(next: 'ACTIVE' | 'SUSPENDED') {
    if (!cust) return;
    setStatusBusy(true);
    setToast('');
    try {
      await api(`/subscriptions/${cust.id}/${next === 'SUSPENDED' ? 'suspend' : 'unsuspend'}`, { method: 'POST' });
      const updated = await api<any>(`/users/customers/${cust.id}`);
      setCust(updated);
      setToast(next === 'SUSPENDED' ? 'Customer suspended' : 'Customer reactivated');
    } catch (e: any) {
      setToast(e.message || 'Status update failed');
    } finally {
      setStatusBusy(false);
    }
  }

  async function resetDashboardPassword() {
    const uid = cust?.userId;
    if (!uid) {
      setToast('No linked dashboard account found for this subscriber');
      return;
    }
    setBusy(true);
    setToast('');
    setPwResult(null);
    setCopied(false);
    try {
      const res = await api<{ email: string; newPassword: string }>(`/users/${uid}/reset-password`, {
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

  async function resetRouterPassword() {
    if (!secret || !deviceId) return;
    const gen = Array.from({ length: 10 }, () => 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 58)]).join('');
    const pw = window.prompt(`New PPPoE secret password for ${secret.username} (leave empty to cancel):`, gen);
    if (!pw) return;
    setBusy(true);
    setToast('');
    try {
      await api(`/routeros/devices/${deviceId}/subscribers/${encodeURIComponent(secret.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ password: pw }),
      });
      setToast(`Router PPPoE password updated for ${secret.username}`);
    } catch (e: any) {
      setToast(e.message || 'Password update failed');
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
    const ip = mySession?.address || secret?.lastCallerId;
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
          body: JSON.stringify({ address: ip, list: 'customer-block', comment: `blocked ${username}` }),
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

  const mySession = sessions.find(s => s.name === username) || null;
  const myIp = mySession?.address || secret?.lastCallerId || null;
  const myQueues = queues.filter(q => (q.target || '').includes(myIp || '______') || (q.name || '').toLowerCase().includes(username.toLowerCase()));
  const myLease = leases.find(l => l.address === myIp || (l['host-name'] || '').toLowerCase() === username.toLowerCase()) || null;
  const myWireless = wireless.filter(w => (myLease && myLease['mac-address'] ? w['mac-address'] === myLease['mac-address'] : false) || (myIp && w.address === myIp));
  const myAddrEntries = addrLists.filter(a => myIp && a.address === myIp);
  const myLogs = logs.filter(l => (l.message || '').toLowerCase().includes(username.toLowerCase()) || (myIp && (l.message || '').includes(myIp)));

  if (loading) {    return (
      <main style={{ padding: 24 }}>
        <div className="data-card" style={{ padding: 24, marginTop: 20 }}>
          <SkeletonTable rows={8} cols={4} />
        </div>
      </main>
    );
  }

  if (error || !secret) {
    return (
      <main style={{ padding: 24 }}>
        <div style={{ padding: '12px 16px', background: '#FEE2E2', color: '#DC2626', borderRadius: 12, fontSize: '0.85rem' }}>{error || 'Not found'}</div>
      </main>
    );
  }

  return (
    <main style={{ padding: 24 }}>
      <button onClick={() => router.push('/users/manage')} style={{ border: 'none', background: 'none', color: 'var(--primary)', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', padding: 0, marginBottom: 12 }}>
        ← Back to customers
      </button>

      <div className="page-title-row" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: 'monospace' }}>{secret.username}</span>
            {badge(secret.disabled ? 'Disabled' : 'Active', secret.disabled ? '#94A3B8' : '#16A34A')}
            {badge('PPPoE', '#2563EB')}
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 4 }}>
            RouterOS PPPoE secret
            {secret.cached && secret.capturedAt && (
              <span style={{ marginLeft: 8, fontSize: '0.68rem', fontWeight: 600, padding: '2px 8px', borderRadius: 10, backgroundColor: '#F59E0B18', color: '#B45309' }}>
                cached · last synced {new Date(secret.capturedAt).toLocaleString()}
              </span>
            )}
          </p>
        </div>
      </div>

      {toast && (
        <div style={{ padding: '10px 16px', background: toast.includes('failed') ? '#FEE2E2' : '#DCFCE7', color: toast.includes('failed') ? '#DC2626' : '#16A34A', borderRadius: 12, marginBottom: 16, fontSize: '0.85rem' }}>
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

        {cust ? (
          tab === 'details' ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
                <Field label="Name" value={cust.name} />
                <Field label="Email" value={cust.email} />
                <Field label="Phone" value={cust.phone} />
                <Field label="Address" value={cust.address} />
                <Field label="Network" value={cust.networkType} />
                <Field label="Plan" value={cust.plan} />
                <Field label="Speed" value={profileSpeed(secret.profile) ? `${profileSpeed(secret.profile)} (${secret.profile})` : cust.speedLabel || null} />
                <Field label="Live Limit" value={myQueues[0]?.['max-limit'] ? fmtLimit(myQueues[0]['max-limit']) : null} mono />
                <Field label="Installer" value={cust.cpes?.[0]?.installerName} />
                <Field label="Due Date" value={cust.dueAt ? new Date(cust.dueAt).toLocaleDateString() : null} />
                <Field label="Status" value={cust.status} />
                <Field label="Unique ID" value={cust.id} mono />
              </div>
              <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border-color)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
                  <Field label="Started" value={cust.startedAt ? new Date(cust.startedAt).toLocaleDateString() : null} />
                  <Field label="Expires" value={cust.expiresAt ? new Date(cust.expiresAt).toLocaleDateString() : null} />
                  <Field label="Monthly Price" value={cust.priceKobo ? formatNaira(cust.priceKobo) : 'On request'} />
                  <Field label="Speed" value={cust.speedLabel || (cust.speedMbps ? `${cust.speedMbps} Mbps` : null)} />
                  <Field label="Due Amount" value={cust.dueAmountKobo ? formatNaira(cust.dueAmountKobo) : null} />
                </div>
              </div>
            </>
          ) : (
            <>
              <EditableCustomerFields customer={cust} onSaved={setCust} />
              <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border-color)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
                  <div>
                    <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Speed</div>
                    <select
                      value={secret.profile || ''}
                      disabled={statusBusy || profiles.length === 0}
                      onChange={e => updateSpeed(e.target.value)}
                      style={{
                        width: '100%', boxSizing: 'border-box', padding: '8px 12px', borderRadius: 12,
                        border: '1px solid var(--border-color)', fontSize: '0.85rem', background: '#fff',
                        color: 'var(--text-color)', outline: 'none',
                      }}
                    >
                      {profiles.filter((p: any) => p['rate-limit']).map((p: any) => (
                        <option key={p.name} value={p.name}>
                          {p.name}{profileSpeed(p.name) ? ` · ${profileSpeed(p.name)}` : ''}
                        </option>
                      ))}
                    </select>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>Applies profile + live queue limit on the router</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Status</div>
                    <select
                      value={cust.status}
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
                    <div style={{ padding: '8px 12px', borderRadius: 12, border: '1px solid var(--border-color)', background: '#FAFAFA', fontSize: '0.85rem', fontFamily: 'monospace', color: 'var(--text-muted)' }}>{cust.id}</div>
                  </div>
                </div>
              </div>
            </>
          )
        ) : snapshot ? (
          tab === 'details' ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
                <Field label="Name" value={snapshot.name} />
                <Field label="Email" value={snapshot.email} />
                <Field label="Phone" value={snapshot.phone} />
                <Field label="Address" value={snapshot.address} />
                <Field label="Network" value="PPPoE" />
                <Field label="Plan" value={snapshot.plan || secret.profile} />
                <Field label="Speed" value={profileSpeed(secret.profile) ? `${profileSpeed(secret.profile)} (${secret.profile})` : null} />
                <Field label="Live Limit" value={myQueues[0]?.['max-limit'] ? fmtLimit(myQueues[0]['max-limit']) : null} mono />
                <Field label="Installer" value={snapshot.installerName} />
                <Field label="Due Date" value={snapshot.dueAt ? new Date(snapshot.dueAt).toLocaleDateString() : null} />
                <Field label="Status" value={secret.disabled ? 'Suspended' : 'Active'} />
                <Field label="Unique ID" value={snapshot.username} mono />
              </div>
              <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border-color)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
                  <Field label="Routeros Comment" value={snapshot.customer} />
                  <Field label="Last Caller ID" value={snapshot.lastCallerId} mono />
                  <Field label="Last Disconnect" value={snapshot.lastDisconnectReason} />
                  <Field label="Last Online" value={snapshot.capturedAt ? new Date(snapshot.capturedAt).toLocaleString() : null} />
                </div>
              </div>
            </>
          ) : (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
                {([
                  ['name', 'Name'], ['email', 'Email'], ['phone', 'Phone'], ['address', 'Address'], ['installerName', 'Installer Name'],
                ] as const).map(([key, label]) => (
                  <div key={key}>
                    <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
                    <input
                      value={snapshotProfile[key]}
                      onChange={e => setSnapshotProfile(p => ({ ...p, [key]: e.target.value }))}
                      style={{ width: '100%', boxSizing: 'border-box', padding: '8px 12px', borderRadius: 12, border: '1px solid var(--border-color)', fontSize: '0.85rem', background: '#fff', color: 'var(--text-color)', outline: 'none' }}
                    />
                  </div>
                ))}
                <div>
                  <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Plan</div>
                  <select
                    value={snapshotProfile.plan}
                    onChange={e => setSnapshotProfile(p => ({ ...p, plan: e.target.value }))}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '8px 12px', borderRadius: 12, border: '1px solid var(--border-color)', fontSize: '0.85rem', background: '#fff', color: 'var(--text-color)', outline: 'none' }}
                  >
                    {(() => {
                      const current = snapshotProfile.plan;
                      const has = plans.some(p => p.name === current);
                      const opts = has ? plans : [{ name: current || '', speedLabel: null, priceKobo: 0 }, ...plans];
                      return opts.map(p => (
                        <option key={p.name} value={p.name}>
                          {p.name || '— Select plan —'}{p.speedLabel ? ` · ${p.speedLabel}` : ''}{p.priceKobo ? ` · ${formatNaira(p.priceKobo)}` : ' · On request'}
                        </option>
                      ));
                    })()}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Network</div>
                  <div style={{ padding: '8px 12px', borderRadius: 12, border: '1px solid var(--border-color)', background: '#FAFAFA', fontSize: '0.85rem', color: 'var(--text-muted)' }}>PPPoE</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Due Date</div>
                  <input
                    type="date"
                    value={snapshotProfile.dueAt}
                    onChange={e => setSnapshotProfile(p => ({ ...p, dueAt: e.target.value }))}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '8px 12px', borderRadius: 12, border: '1px solid var(--border-color)', fontSize: '0.85rem', background: '#fff', color: 'var(--text-color)', outline: 'none' }}
                  />
                </div>
                <div>
                  <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Speed</div>
                  <select
                    value={secret.profile || ''}
                    disabled={statusBusy || profiles.length === 0}
                    onChange={e => updateSpeed(e.target.value)}
                    style={{
                      width: '100%', boxSizing: 'border-box', padding: '8px 12px', borderRadius: 12,
                      border: '1px solid var(--border-color)', fontSize: '0.85rem', background: '#fff',
                      color: 'var(--text-color)', outline: 'none',
                    }}
                  >
                    {profiles.filter((p: any) => p['rate-limit']).map((p: any) => (
                      <option key={p.name} value={p.name}>
                        {p.name}{profileSpeed(p.name) ? ` · ${profileSpeed(p.name)}` : ''}
                      </option>
                    ))}
                  </select>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>Applies profile + live queue limit on the router</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Status</div>
                  <select
                    value={secret.disabled ? 'SUSPENDED' : 'ACTIVE'}
                    disabled={statusBusy}
                    onChange={e => setSecretStatus(e.target.value as 'ACTIVE' | 'SUSPENDED')}
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
                  <div style={{ padding: '8px 12px', borderRadius: 12, border: '1px solid var(--border-color)', background: '#FAFAFA', fontSize: '0.85rem', fontFamily: 'monospace', color: 'var(--text-muted)' }}>{username}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
                <button onClick={saveSnapshotProfile} disabled={busy} style={{
                  padding: '8px 24px', borderRadius: 20, border: 'none', background: 'var(--primary)', color: '#fff',
                  fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', opacity: busy ? 0.6 : 1,
                }}>
                  {busy ? 'Saving...' : 'Save'}
                </button>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Stored in DB — survives router outages
                </span>
              </div>
            </div>
          )
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            No linked customer record — this PPPoE secret is not connected to a CRM subscriber.
          </p>
        )}
        {cust && (
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={() => router.push(`/users/manage/${cust.id}`)} style={{ padding: '6px 16px', borderRadius: 20, border: '1px solid var(--primary)', background: 'transparent', color: 'var(--primary)', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer' }}>
              Open customer →
            </button>
          </div>
        )}
      </div>

      <div className="data-card" style={{ padding: 24, marginTop: 16 }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: 16 }}>ROUTEROS SECRET</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
          <Field label="Username" value={secret.username} mono />
          <Field label="Profile / Plan" value={secret.profile} />
          <Field label="Comment" value={secret.comment} />
          <Field label="Secret ID" value={secret.id} mono />
          <Field label="Last Caller ID" value={secret.lastCallerId} mono />
          <Field label="Last Logged Out" value={secret.lastLoggedOut} />
          <Field label="Last Disconnect Reason" value={secret.lastDisconnectReason} />
        </div>
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-color)', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <button onClick={toggleDisabled} disabled={busy} style={{
            padding: '8px 20px', borderRadius: 20, border: 'none', background: secret.disabled ? 'var(--primary)' : '#FEE2E2',
            color: secret.disabled ? '#fff' : '#DC2626', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', opacity: busy ? 0.6 : 1,
          }}>
            {busy ? 'Working...' : secret.disabled ? 'Re-enable' : 'Suspend'}
          </button>
          <input
            type="text"
            placeholder="New dashboard login password (blank = auto)"
            value={newPw}
            onChange={e => setNewPw(e.target.value)}
            style={{
              padding: '8px 16px', borderRadius: 20, border: '1px solid var(--border-color)', fontSize: '0.85rem',
              fontFamily: 'monospace', width: 240, outline: 'none', background: 'transparent', color: 'var(--text-dark)',
            }}
          />
          <button onClick={resetDashboardPassword} disabled={busy} style={{
            padding: '8px 20px', borderRadius: 20, border: '1px solid var(--primary)', background: 'transparent',
            color: 'var(--primary)', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', opacity: busy ? 0.6 : 1,
          }}>
            {busy ? 'Working...' : 'Reset Dashboard Login'}
          </button>
          <button onClick={resetRouterPassword} disabled={busy} style={{
            padding: '8px 20px', borderRadius: 20, border: '1px dashed #64748B', background: 'transparent',
            color: '#64748B', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer', opacity: busy ? 0.6 : 1,
          }}>
            Set Router PPPoE Password
          </button>
          {myAddrEntries.map(entry => (
            <button key={entry['.id']} onClick={() => blockToggle(entry)} disabled={busy} style={{
              padding: '8px 20px', borderRadius: 20, border: '1px solid #DC2626', background: '#FEE2E2',
              color: '#DC2626', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', opacity: busy ? 0.6 : 1,
            }}>
              Unblock ({entry.list})
            </button>
          ))}
          {myIp && myAddrEntries.length === 0 && (
            <button onClick={() => blockToggle()} disabled={busy} style={{
              padding: '8px 20px', borderRadius: 20, border: '1px solid #DC2626', background: 'transparent',
              color: '#DC2626', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', opacity: busy ? 0.6 : 1,
            }}>
              Block at Firewall
            </button>
          )}
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

      <div className="data-card" style={{ padding: 24, marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 700 }}>LIVE SESSION</div>
          {mySession && (
            <button onClick={disconnectSession} disabled={busy} style={{
              padding: '6px 16px', borderRadius: 20, border: 'none', background: '#DC2626', color: '#fff',
              fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer', opacity: busy ? 0.6 : 1,
            }}>
              Disconnect
            </button>
          )}
        </div>
        {mySession ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
            <Field label="IP Address" value={mySession.address} mono />
            <Field label="Uptime" value={mySession.uptime} />
            <Field label="Caller ID" value={mySession['caller-id']} mono />
            <Field label="Session ID" value={mySession['session-id'] || mySession['.id']} mono />
            <Field label="Service" value={mySession.service} />
          </div>
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{secret.disabled ? 'Subscriber is suspended.' : 'Not currently connected.'}</p>
        )}
      </div>

      <div className="data-card" style={{ padding: 24, marginTop: 16 }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: 16 }}>BANDWIDTH QUEUES</div>
        {myQueues.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No matching queues on the router.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {myQueues.map(q => (
              <div key={q['.id']} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: 12, background: '#F8F8F8' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{q.name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{q.target} · {q['max-limit']}</div>
                </div>
                <div style={{ textAlign: 'right', fontSize: '0.75rem' }}>
                  <div>↓ {q['rate']?.split('/')[0] || '—'}</div>
                  <div>↑ {q['rate']?.split('/')[1] || '—'}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <UsageHistoryCard username={username} />

      <div className="data-card" style={{ padding: 24, marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 700 }}>RADIUS (FreeRADIUS)</span>
            {radiusUsage && badge(radiusUsage.online ? 'LIVE' : 'OFFLINE', radiusUsage.online ? '#16A34A' : '#94A3B8')}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {radiusCustomerId && (
              <>
                <input
                  value={radiusPlan}
                  onChange={(e) => setRadiusPlan(e.target.value)}
                  placeholder="10M/10M"
                  style={{ padding: '6px 10px', borderRadius: 10, border: '1px solid #E5E7EB', fontSize: '0.8rem', fontFamily: 'monospace', width: 110 }}
                />
                <button onClick={radiusApplyPlan} disabled={radiusBusy || !radiusPlan.trim()}
                  style={{ padding: '7px 12px', borderRadius: 20, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}>
                  Apply plan
                </button>
                <button onClick={() => radiusAction('deactivate')} disabled={radiusBusy}
                  style={{ padding: '7px 12px', borderRadius: 20, border: 'none', background: '#DC2626', color: '#fff', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}>
                  Deactivate
                </button>
                <button onClick={() => radiusAction('activate')} disabled={radiusBusy}
                  style={{ padding: '7px 12px', borderRadius: 20, border: 'none', background: '#16A34A', color: '#fff', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}>
                  Activate
                </button>
              </>
            )}
            <button onClick={loadRadiusUsage} disabled={radiusLoading}
              style={{ padding: '7px 12px', borderRadius: 20, border: '1px solid #E5E7EB', background: '#fff', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}>
              Refresh
            </button>
          </div>
        </div>

        {radiusLoading && <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Loading usage…</div>}

        {!radiusLoading && radiusUsage && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, marginBottom: 16 }}>
              <Field label="Session" value={radiusUsage.activeSession ? (
                <span style={{ fontFamily: 'monospace' }}>#{radiusUsage.activeSession.acctsessionid}</span>
              ) : '—'} mono />
              <Field label="Started" value={radiusUsage.activeSession?.acctstarttime ? new Date(radiusUsage.activeSession.acctstarttime).toLocaleString() : '—'} />
              <Field label="IP" value={radiusUsage.activeSession?.framedipaddress || '—'} mono />
              <Field label="Data in" value={fmtBytes(String(radiusUsage.totals.inputBytes))} />
              <Field label="Data out" value={fmtBytes(String(radiusUsage.totals.outputBytes))} />
              <Field label="Sessions" value={String(radiusUsage.totals.sessions)} />
            </div>
            <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
              Recent accounting
            </div>
            {radiusUsage.recent?.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {radiusUsage.recent.slice(0, 5).map((r: any) => (
                  <div key={r.acctsessionid} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderRadius: 10, background: '#F8F8F8', fontSize: '0.75rem' }}>
                    <span style={{ fontFamily: 'monospace' }}>{r.framedipaddress || '—'}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{r.acctstarttime ? new Date(r.acctstarttime).toLocaleString() : '—'}</span>
                    <span style={{ color: r.acctstoptime ? 'var(--text-muted)' : '#16A34A', fontWeight: 600 }}>{r.acctstoptime ? 'ended' : 'live'}</span>
                    <span>↓ {fmtBytes(String(r.acctinputoctets))}</span>
                    <span>↑ {fmtBytes(String(r.acctoutputoctets))}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>No accounting records yet — appears once the MikroTik starts authenticating this user.</div>
            )}
          </>
        )}

        {!radiusLoading && !radiusUsage && radiusCustomerId && (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            No usage data (subscriber has no PPPoE username assigned, or radius-service unavailable).
          </div>
        )}

        {!radiusLoading && !radiusUsage && !radiusCustomerId && (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            This username is not linked to a subscriber — assign a PPPoE username in the customer profile to manage it via RADIUS.
          </div>
        )}
      </div>

      <div className="data-card" style={{ padding: 24, marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 700 }}>DIAGNOSTICS</div>
          {myIp && (
            <button onClick={() => pingAddress(myIp)} disabled={busy} style={{
              padding: '6px 16px', borderRadius: 20, border: '1px solid var(--primary)', background: 'transparent',
              color: 'var(--primary)', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer', opacity: busy ? 0.6 : 1,
            }}>
              Ping {myIp}
            </button>
          )}
        </div>
        {pingResult && <p style={{ fontSize: '0.85rem', fontWeight: 600, color: pingResult.startsWith('Ping failed') ? '#DC2626' : '#16A34A', marginBottom: 12 }}>{pingResult}</p>}
        {myLease && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>DHCP LEASE</div>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              <Field label="Address" value={myLease.address} mono />
              <Field label="MAC" value={myLease['mac-address']} mono />
              <Field label="Hostname" value={myLease['host-name']} />
              <Field label="Status" value={myLease.status} />
              <Field label="Server" value={myLease.server} />
            </div>
          </div>
        )}
        {myWireless.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>WIRELESS LINK</div>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              {myWireless.map(w => (
                <Fragment key={w['.id']}>
                  <Field label="MAC" value={w['mac-address']} mono />
                  <Field label="Signal" value={w['signal-strength'] ?? w.signal} mono />
                  <Field label="SNR" value={w['signal-to-noise'] ?? w.snr} />
                  <Field label="Rate" value={w['last-tx-rate'] ?? w['tx-rate']} />
                  <Field label="Uptime" value={w.uptime} />
                </Fragment>
              ))}
            </div>
          </div>
        )}
        <div>
          <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>RECENT LOGS ({myLogs.length})</div>
          {myLogs.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>No log entries for this user.</p>
          ) : (
            <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {myLogs.slice(-10).reverse().map(l => (
                <div key={l['.id']} style={{ fontSize: '0.78rem', fontFamily: 'monospace', color: (l.message || '').toLowerCase().includes('error') || (l.message || '').toLowerCase().includes('fail') ? '#DC2626' : 'var(--text-muted)' }}>
                  {l.time} {l.topics} — {l.message}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
