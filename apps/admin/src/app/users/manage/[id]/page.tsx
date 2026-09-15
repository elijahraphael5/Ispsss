'use client';

import { useEffect, useState } from 'react';
import { api, formatNaira, timeAgo } from '@isp/shared';
import { useParams, useRouter } from 'next/navigation';
import { SkeletonTable } from '../../../../components/Skeleton';
import EditableCustomerFields from '../../../../components/EditableCustomerFields';
import { notifyCustomersChanged } from '@isp/shared';
import UsageHistoryCard from '../../../../components/UsageHistoryCard';
import { getCachedCustomer, setCachedCustomer } from '../../../../lib/customer-cache';

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

function getInitials(name: string | null | undefined) {
  if (!name) return '—';
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (p.length === 1) return p[0].slice(0, 2).toUpperCase();
  return (p[0][0] + p[p.length - 1][0]).toUpperCase();
}

function Field({ label, value, mono, icon }: { label: string; value: React.ReactNode; mono?: boolean; icon?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.64rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: 0.6 }}>{icon}{label}</div>
      <div style={{ fontSize: '0.9rem', fontWeight: 600, fontFamily: mono ? 'ui-monospace, SFMono-Regular, monospace' : undefined, wordBreak: 'break-word', color: 'var(--text-dark)', lineHeight: 1.35 }}>{value || <span style={{ color: '#CBD5E1' }}>—</span>}</div>
    </div>
  );
}

function SectionCard({ title, icon, accent, children }: { title: string; icon: React.ReactNode; accent: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #F1F5F9', borderRadius: 18, padding: '16px 16px 14px', boxShadow: '0 4px 20px rgba(15,23,42,0.04)', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 30, height: 30, borderRadius: 10, background: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</div>
        <div style={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: '#334155' }}>{title}</div>
      </div>
      <div style={{ height: 1, background: '#F8FAFC' }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '14px 18px' }}>{children}</div>
    </div>
  );
}

function badge(label: string, color: string) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 99, fontSize: '0.68rem', fontWeight: 700, backgroundColor: color + '14', color, border: `1px solid ${color}22`, letterSpacing: 0.2 }}>{label}</span>;
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
  const [copiedId, setCopiedId] = useState(false);
  const [tab, setTab] = useState<'details' | 'edit'>('details');
  const [statusBusy, setStatusBusy] = useState(false);

  useEffect(() => {
    const cached = getCachedCustomer(params.id);
    if (cached) { setCustomer(cached); setLoading(false); }
    api<CustomerDetail>(`/users/customers/${params.id}`)
      .then(c => { setCustomer(c); setCachedCustomer(params.id, c); })
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

  useEffect(() => {
    if (customer) setCachedCustomer(params.id, customer);
  }, [customer, params.id]);

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
      <main style={{ padding: 0 }}>
        <div className="data-card" style={{ padding: 24 }}>
          <SkeletonTable rows={8} cols={4} />
        </div>
      </main>
    );
  }

  if (error || !customer) {
    return (
      <main style={{ padding: 0 }}>
        <div style={{ padding: '14px 16px', background: '#FEF2F2', color: '#DC2626', borderRadius: 16, fontSize: '0.85rem', border: '1px solid #FECACA' }}>{error || 'Not found'}</div>
      </main>
    );
  }

  const cpe = customer.cpes[0];
  const isActive = customer.status === 'ACTIVE';
  const statusColor = isActive ? '#16A34A' : customer.status === 'SUSPENDED' ? '#DC2626' : '#94A3B8';
  const planPrice = priceDisplay(customer.priceKobo);
  const subProgress = (() => {
    if (!customer.startedAt || !customer.expiresAt) return null;
    const s = new Date(customer.startedAt).getTime();
    const e = new Date(customer.expiresAt).getTime();
    const now = Date.now();
    const total = e - s;
    const elapsed = now - s;
    const pct = Math.max(0, Math.min(100, (elapsed / total) * 100));
    const daysLeft = Math.ceil((e - now) / 86400000);
    return { pct, daysLeft };
  })();

  return (
    <main style={{ padding: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Back + breadcrumb */}
      <button onClick={() => router.push('/users/manage')} style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 8, border: '1px solid #E2E8F0', background: '#fff', color: '#475569', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', padding: '7px 14px', borderRadius: 99, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg> Back to customers
      </button>

      {/* HERO */}
      <div className="data-card" style={{ padding: 0, overflow: 'hidden', border: '1px solid #FFE4D6', boxShadow: '0 8px 30px rgba(241,89,37,0.08)' }}>
        <div style={{ background: 'linear-gradient(135deg, #FFF7ED 0%, #FFECD2 18%, #FFFFFF 60%, #F8FAFC 100%)', padding: '22px 22px 18px', position: 'relative', overflow: 'hidden' }}>
          {/* decor blobs */}
          <div style={{ position: 'absolute', top: -30, right: -20, width: 140, height: 140, borderRadius: '50%', background: 'radial-gradient(circle, #FFD9C2 0%, transparent 70%)', opacity: 0.7, pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', bottom: -40, left: 120, width: 180, height: 180, borderRadius: '50%', background: 'radial-gradient(circle, #DBEAFE 0%, transparent 70%)', opacity: 0.5, pointerEvents: 'none' }} />
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap', position: 'relative' }}>
            <div style={{ width: 64, height: 64, borderRadius: 18, background: 'linear-gradient(135deg, #F15925 0%, #FF8A50 100%)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '1.2rem', letterSpacing: 0.5, boxShadow: '0 8px 20px rgba(241,89,37,0.3)', flexShrink: 0 }}>
              {getInitials(customer.name)}
            </div>
            <div style={{ flex: '1 1 280px', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0F172A', lineHeight: 1.1, letterSpacing: -0.3 }}>{customer.name || 'Customer'}</h1>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 99, fontSize: '0.7rem', fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', background: isActive ? '#DCFCE7' : '#FEE2E2', color: statusColor, border: `1px solid ${statusColor}22` }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor, boxShadow: `0 0 0 4px ${statusColor}22`, display: 'inline-block' }} />{customer.status}
                </span>
                <span style={{ padding: '4px 10px', borderRadius: 99, background: '#fff', border: '1px solid #E2E8F0', fontSize: '0.68rem', fontWeight: 700, color: '#475569' }}>{customer.type} · joined {new Date(customer.createdAt).toLocaleDateString()}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                {customer.phone && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 99, padding: '6px 12px', fontSize: '0.78rem', fontWeight: 600, color: '#334155' }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#F15925" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>{customer.phone}</span>}
                {customer.email && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 99, padding: '6px 12px', fontSize: '0.78rem', fontWeight: 600, color: '#334155', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2"><path d="M4 4h16v16H4z"/><path d="M4 7l8 6 8-6"/></svg><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{customer.email}</span></span>}
                {customer.address && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', border: '1px solid #E2E8F0', borderRadius: 99, padding: '6px 12px', fontSize: '0.75rem', fontWeight: 600, color: '#334155', maxWidth: '100%' }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{customer.address}</span></span>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14, padding: '10px 14px', minWidth: 120, boxShadow: '0 2px 10px rgba(0,0,0,0.03)' }}>
                <div style={{ fontSize: '0.62rem', fontWeight: 700, color: '#94A3B8', letterSpacing: 0.6, textTransform: 'uppercase' }}>Network</div>
                <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#0F172A', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>{customer.networkType?.includes('FIBER') ? <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#2563EB' }} /> : <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#F59E0B' }} />}{customer.networkType || '—'}</div>
                <div style={{ fontSize: '0.7rem', color: '#64748B', marginTop: 1 }}>{customer.plan || 'No plan'} {customer.planCategory ? `· ${customer.planCategory}` : ''}</div>
              </div>
              <div style={{ background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)', color: '#fff', borderRadius: 14, padding: '10px 14px', minWidth: 120, boxShadow: '0 8px 20px rgba(15,23,42,0.15)' }}>
                <div style={{ fontSize: '0.62rem', fontWeight: 700, color: '#94A3B8', letterSpacing: 0.6, textTransform: 'uppercase' }}>Speed</div>
                <div style={{ fontSize: '1.15rem', fontWeight: 800, marginTop: 2, display: 'flex', alignItems: 'baseline', gap: 4 }}>{customer.speedMbps || 1}<span style={{ fontSize: '0.7rem', fontWeight: 600, opacity: 0.7 }}>Mbps</span></div>
                <div style={{ fontSize: '0.68rem', color: '#CBD5E1', marginTop: 1 }}>{customer.speedLabel || `${customer.speedMbps ?? 1} Mbps`} · {customer.plan || 'GOLD'}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Action bar */}
        <div style={{ padding: '14px 16px', background: '#fff', borderTop: '1px solid #FFF1E6', display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 260px', minWidth: 0 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.68rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> New login password (blank = auto)
            </label>
            <div style={{ position: 'relative' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              <input
                type="text"
                placeholder="Leave blank to auto-generate"
                value={newPw}
                onChange={e => setNewPw(e.target.value)}
                style={{
                  width: '100%', padding: '11px 14px 11px 36px', borderRadius: 12, border: '1px solid #E2E8F0', fontSize: '0.85rem',
                  fontFamily: 'ui-monospace, SFMono-Regular, monospace', outline: 'none', background: '#F8FAFC', color: 'var(--text-dark)',
                }}
              />
            </div>
          </div>
          <button onClick={resetPassword} disabled={busy} style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 18px', borderRadius: 12, border: 'none',
            background: 'linear-gradient(135deg, #F15925 0%, #FF7A45 100%)', color: '#fff', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer', opacity: busy ? 0.6 : 1, boxShadow: '0 6px 16px rgba(241,89,37,0.25)', whiteSpace: 'nowrap'
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-9-9"/><path d="M21 3v6h-6"/><path d="M12 7v6l3 2"/></svg> {busy ? 'Working…' : 'Reset Password'}
          </button>
          <button onClick={toggleConnection} disabled={busy} style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 18px', borderRadius: 12, border: `1px solid ${isActive ? '#FECACA' : '#BBF7D0'}`,
            background: isActive ? '#FEF2F2' : '#F0FDF4', color: isActive ? '#DC2626' : '#16A34A', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer', opacity: busy ? 0.6 : 1, whiteSpace: 'nowrap'
          }}>
            {isActive ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>}
            {busy ? 'Working…' : isActive ? 'Disconnect' : 'Reconnect'}
          </button>
        </div>

        {pwResult && (
          <div style={{ margin: '0 16px 16px', padding: '14px 16px', background: 'linear-gradient(135deg, #DCFCE7 0%, #F0FDF4 100%)', border: '1px solid #BBF7D0', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: '0.78rem', color: '#166534', display: 'flex', alignItems: 'center', gap: 6 }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg> New password ready — share with customer</div>
              <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: '1.05rem', fontWeight: 800, color: '#14532D', wordBreak: 'break-all', marginTop: 4 }}>{pwResult.newPassword}</div>
            </div>
            <button onClick={() => { navigator.clipboard?.writeText(pwResult.newPassword); setCopied(true); }} style={{
              padding: '8px 16px', borderRadius: 99, border: '1px solid #16A34A', background: '#fff',
              color: '#16A34A', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v3"/></svg> {copied ? 'Copied ✓' : 'Copy'}
            </button>
          </div>
        )}
      </div>

      {toast && (
        <div style={{ padding: '12px 16px', background: toast.startsWith('Static') ? '#FFFBEB' : toast.toLowerCase().includes('toggled') || toast.toLowerCase().includes('reactivated') ? '#F0FDF4' : '#FEF2F2', color: toast.startsWith('Static') ? '#92400E' : toast.toLowerCase().includes('toggled') ? '#166534' : '#DC2626', border: `1px solid ${toast.startsWith('Static') ? '#FDE68A' : toast.toLowerCase().includes('toggled') ? '#BBF7D0' : '#FECACA'}`, borderRadius: 14, fontSize: '0.82rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: toast.startsWith('Static') ? '#F59E0B' : toast.toLowerCase().includes('toggled') ? '#16A34A' : '#DC2626', flexShrink: 0 }} /> {toast}
        </div>
      )}

      {/* DETAILS TABS */}
      <div className="data-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid #F1F5F9', background: '#FFFCF9', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 9, background: '#FFF1E6', color: '#F15925', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            </div>
            <div style={{ fontSize: '0.78rem', fontWeight: 800, letterSpacing: 0.5, color: '#0F172A' }}>CUSTOMER DETAILS</div>
            <span style={{ fontSize: '0.68rem', color: '#94A3B8', fontWeight: 600, background: '#fff', border: '1px solid #E2E8F0', padding: '3px 8px', borderRadius: 99 }}>{customer.type}</span>
          </div>
          <div style={{ display: 'flex', gap: 6, background: '#F1F5F9', padding: 4, borderRadius: 99 }}>
            {(['details', 'edit'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding: '6px 16px', borderRadius: 99, border: 'none',
                  background: tab === t ? '#fff' : 'transparent',
                  color: tab === t ? '#0F172A' : '#64748B', fontWeight: 700, fontSize: '0.75rem', cursor: 'pointer',
                  boxShadow: tab === t ? '0 2px 8px rgba(0,0,0,0.06)' : 'none', transition: 'all 0.2s'
                }}
              >
                {t === 'details' ? 'Details' : 'Edit'}
              </button>
            ))}
          </div>
        </div>

        {tab === 'details' ? (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14, background: '#F8FAFC' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
              <SectionCard title="Contact" accent="#EFF6FF" icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>}>
                <Field label="Name" value={customer.name} icon={<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>} />
                <Field label="Phone" value={customer.phone ? <a href={`tel:${customer.phone}`} style={{ color: '#2563EB', textDecoration: 'none' }}>{customer.phone}</a> : null} icon={<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>} />
                <Field label="Email" value={customer.email ? <a href={`mailto:${customer.email}`} style={{ color: '#2563EB', textDecoration: 'none', wordBreak: 'break-all' }}>{customer.email}</a> : null} icon={<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2"><path d="M4 4h16v16H4z"/><path d="M4 7l8 6 8-6"/></svg>} />
                <Field label="Address" value={customer.address} icon={<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>} />
              </SectionCard>

              <SectionCard title="Connection" accent="#FFF7ED" icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F15925" strokeWidth="2"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.5 16.5a4 4 0 0 1 7 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>}>
                <Field label="Network" value={customer.networkType ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 99, background: customer.networkType.includes('FIBER') ? '#EFF6FF' : '#FEF3C7', color: customer.networkType.includes('FIBER') ? '#2563EB' : '#92400E', border: `1px solid ${customer.networkType.includes('FIBER') ? '#DBEAFE' : '#FDE68A'}`, fontWeight: 700, fontSize: '0.75rem' }}>{customer.networkType}</span> : null} />
                <Field label="Plan" value={customer.plan ? <span style={{ fontWeight: 800, color: '#F15925' }}>{customer.plan} {customer.planCategory && <span style={{ fontWeight: 600, color: '#94A3B8' }}>· {customer.planCategory}</span>}</span> : null} />
                <Field label="Speed" value={<span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4, fontWeight: 800 }}>{customer.speedMbps ?? 1}<span style={{ fontSize: '0.7rem', color: '#94A3B8' }}>Mbps</span> <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#94A3B8' }}>· {customer.speedLabel || `${customer.speedMbps ?? 1} Mbps`}</span></span>} />
                <Field label="Installer" value={customer.cpes[0]?.installerName || <span style={{ color: '#CBD5E1' }}>— not assigned</span>} icon={<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H4a4 4 0 0 0-4 4v2"/><circle cx="4" cy="7" r="3"/><path d="M22 11v2"/><path d="M14 7a4 4 0 1 0 8 0 4 4 0 0 0-8 0z"/></svg>} />
              </SectionCard>

              <SectionCard title="Billing" accent="#F0FDF4" icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>}>
                <Field label="Monthly Price" value={<span style={{ fontSize: '1rem', fontWeight: 800, color: '#0F172A' }}>{planPrice}</span>} />
                <Field label="Due Amount" value={customer.dueAmountKobo ? <span style={{ color: '#DC2626', fontWeight: 800 }}>{naira(customer.dueAmountKobo)}</span> : <span style={{ color: '#16A34A', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: '#16A34A' }} />All clear</span>} />
                <Field label="Due Date" value={customer.dueAt ? new Date(customer.dueAt).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : null} icon={<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>} />
                <Field label="Status" value={badge(customer.status, statusColor)} />
              </SectionCard>

              <SectionCard title="Subscription" accent="#FAF5FF" icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9333EA" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>}>
                <Field label="Started" value={customer.startedAt ? new Date(customer.startedAt).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : null} />
                <Field label="Expires" value={customer.expiresAt ? new Date(customer.expiresAt).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : null} />
                {subProgress && (
                  <div style={{ gridColumn: '1 / -1', marginTop: 2 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', fontWeight: 700, color: '#64748B', marginBottom: 6 }}>
                      <span>Progress</span><span style={{ color: subProgress.daysLeft < 7 ? '#DC2626' : '#16A34A' }}>{subProgress.daysLeft > 0 ? `${subProgress.daysLeft} days left` : 'Expired'}</span>
                    </div>
                    <div style={{ height: 8, borderRadius: 99, background: '#F1F5F9', overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(100, subProgress.pct)}%`, height: '100%', background: subProgress.daysLeft < 7 ? 'linear-gradient(90deg, #F59E0B, #DC2626)' : 'linear-gradient(90deg, #16A34A, #22C55E)', borderRadius: 99 }} />
                    </div>
                  </div>
                )}
                {!subProgress && <Field label="Period" value={<span style={{ color: '#94A3B8' }}>—</span>} />}
              </SectionCard>
            </div>

            <div style={{ background: '#fff', border: '1.5px dashed #E2E8F0', borderRadius: 14, padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: '0.64rem', fontWeight: 700, color: '#94A3B8', letterSpacing: 0.6, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6 }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Unique ID</div>
                <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginTop: 4, wordBreak: 'break-all' }}>{customer.id}</div>
              </div>
              <button onClick={() => { navigator.clipboard?.writeText(customer.id); setCopiedId(true); setTimeout(() => setCopiedId(false), 2000); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 99, border: '1px solid #E2E8F0', background: copiedId ? '#F0FDF4' : '#fff', color: copiedId ? '#16A34A' : '#475569', fontWeight: 700, fontSize: '0.72rem', cursor: 'pointer' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v3"/></svg> {copiedId ? 'Copied ✓' : 'Copy ID'}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ padding: 16, background: '#F8FAFC' }}>
            <EditableCustomerFields customer={customer} onSaved={u => { setCustomer(u); notifyCustomersChanged(); }} />
            <div style={{ marginTop: 16, padding: '14px 16px', background: '#fff', borderRadius: 14, border: '1px solid #F1F5F9' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
                <div>
                  <div style={{ fontSize: '0.64rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>Status</div>
                  <select
                    value={customer.status}
                    disabled={statusBusy}
                    onChange={e => setStatus(e.target.value as 'ACTIVE' | 'SUSPENDED')}
                    style={{
                      width: '100%', boxSizing: 'border-box', padding: '10px 14px', borderRadius: 12,
                      border: '1px solid #E2E8F0', fontSize: '0.85rem', background: '#fff',
                      color: 'var(--text-color)', outline: 'none', fontWeight: 600
                    }}
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="SUSPENDED">SUSPENDED</option>
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: '0.64rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>Unique ID</div>
                  <div style={{ padding: '10px 14px', borderRadius: 12, border: '1px solid #F1F5F9', background: '#F8FAFC', fontSize: '0.78rem', fontFamily: 'ui-monospace, monospace', color: '#64748B', wordBreak: 'break-all' }}>{customer.id}</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {cpe && (
        <div className="data-card" style={{ padding: 0, overflow: 'hidden', borderLeft: `4px solid ${cpe.status === 'ONLINE' || cpe.status === 'ACTIVE' ? '#16A34A' : '#CBD5E1'}` }}>
          <div style={{ padding: '14px 16px', background: cpe.status === 'ONLINE' || cpe.status === 'ACTIVE' ? '#F0FDF4' : '#F8FAFC', borderBottom: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 10, background: cpe.connectionType === 'PPPOE' ? '#EFF6FF' : '#FFF7ED', color: cpe.connectionType === 'PPPOE' ? '#2563EB' : '#F15925', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {cpe.connectionType === 'PPPOE' ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg> : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 3h-8a2 2 0 0 0-2 2v2h12V5a2 2 0 0 0-2-2z"/><circle cx="7" cy="14" r="1" fill="currentColor"/><circle cx="12" cy="14" r="1" fill="currentColor"/><circle cx="17" cy="14" r="1" fill="currentColor"/></svg>}
              </div>
              <div>
                <div style={{ fontSize: '0.78rem', fontWeight: 800, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 8 }}>
                  CPE / ROUTER
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 99, fontSize: '0.66rem', fontWeight: 800, background: (cpe.status === 'ONLINE' || cpe.status === 'ACTIVE') ? '#DCFCE7' : '#F1F5F9', color: (cpe.status === 'ONLINE' || cpe.status === 'ACTIVE') ? '#16A34A' : '#64748B', border: `1px solid ${(cpe.status === 'ONLINE' || cpe.status === 'ACTIVE') ? '#BBF7D0' : '#E2E8F0'}` }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: (cpe.status === 'ONLINE' || cpe.status === 'ACTIVE') ? '#16A34A' : '#94A3B8', boxShadow: (cpe.status === 'ONLINE' || cpe.status === 'ACTIVE') ? '0 0 0 3px #16A34A22' : 'none' }} /> {cpe.status}
                  </span>
                </div>
                <div style={{ fontSize: '0.7rem', color: '#64748B', fontWeight: 600 }}>{cpe.connectionType} {cpe.name ? `· ${cpe.name}` : ''}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {badge(cpe.connectionType, cpe.connectionType === 'PPPOE' ? '#2563EB' : '#F15925')}
              {cpe.lastSeenAt && <span style={{ fontSize: '0.68rem', color: '#64748B', background: '#fff', border: '1px solid #E2E8F0', padding: '4px 10px', borderRadius: 99, fontWeight: 600 }}>seen {timeAgo(cpe.lastSeenAt)}</span>}
            </div>
          </div>
          <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
            <Field label="Name" value={cpe.name} mono icon={<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2"><rect x="2" y="7" width="20" height="14" rx="2"/></svg>} />
            <Field label="IP Address" value={cpe.ipAddress ? <span style={{ fontFamily: 'ui-monospace, monospace', background: '#F8FAFC', padding: '2px 8px', borderRadius: 6, border: '1px solid #F1F5F9' }}>{cpe.ipAddress}</span> : null} mono />
            <Field label="MAC Address" value={cpe.macAddress ? <span style={{ fontFamily: 'ui-monospace, monospace', background: cpe.macAddress.startsWith('UNASSIGNED') ? '#FFFBEB' : '#F8FAFC', padding: '2px 8px', borderRadius: 6, border: `1px solid ${cpe.macAddress.startsWith('UNASSIGNED') ? '#FDE68A' : '#F1F5F9'}`, color: cpe.macAddress.startsWith('UNASSIGNED') ? '#92400E' : undefined }}>{cpe.macAddress}</span> : null} mono />
            <Field label="Installer" value={cpe.installerName || <span style={{ color: '#CBD5E1' }}>—</span>} />
            <Field label="Last Seen" value={cpe.lastSeenAt ? new Date(cpe.lastSeenAt).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : null} icon={<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>} />
          </div>
        </div>
      )}

      <div className="data-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, borderBottom: '1px solid #F1F5F9', background: '#FFFCF9' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 9, background: '#EFF6FF', color: '#2563EB', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="7" width="20" height="10" rx="2"/><path d="M6 7V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
            <div style={{ fontSize: '0.78rem', fontWeight: 800, color: '#0F172A' }}>ROUTER LINKS</div>
            <span style={{ fontSize: '0.64rem', color: '#94A3B8', fontWeight: 700, background: '#F8FAFC', border: '1px solid #E2E8F0', padding: '3px 8px', borderRadius: 99 }}>live from MikroTik</span>
          </div>
          {cpe?.ipAddress && (
            <button onClick={() => pingAddress(cpe.ipAddress!)} disabled={busy} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 99, border: '1px solid #BFDBFE', background: '#EFF6FF',
              color: '#2563EB', fontWeight: 700, fontSize: '0.75rem', cursor: 'pointer', opacity: busy ? 0.6 : 1,
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg> Ping {cpe.ipAddress}
            </button>
          )}
        </div>
        <div style={{ padding: 16 }}>
          {pingResult && <div style={{ fontSize: '0.78rem', fontWeight: 600, color: pingResult.startsWith('Ping failed') ? '#DC2626' : '#16A34A', background: pingResult.startsWith('Ping failed') ? '#FEF2F2' : '#F0FDF4', border: `1px solid ${pingResult.startsWith('Ping failed') ? '#FECACA' : '#BBF7D0'}`, padding: '10px 14px', borderRadius: 12, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: pingResult.startsWith('Ping failed') ? '#DC2626' : '#16A34A' }} />{pingResult}</div>}
          {!cpe?.ipAddress && !cpe?.macAddress ? (
            <div style={{ textAlign: 'center', padding: '24px 16px', color: '#94A3B8' }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px', color: '#CBD5E1' }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="7" width="20" height="10" rx="2"/><path d="M6 7V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2"/></svg></div>
              <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>No CPE IP/MAC to look up on the router.</div>
              <div style={{ fontSize: '0.75rem', marginTop: 4 }}>Assign an IP or let the RADIUS create one.</div>
            </div>
          ) : (
            <div>
              {(() => {
                const ip = cpe!.ipAddress;
                const mac = cpe!.macAddress;
                const lease = ip ? leases.find(l => l.address === ip) : null;
                const links = wireless.filter(w => (mac && w['mac-address'] === mac) || (ip && w.address === ip));
                const entries = ip ? addrLists.filter(a => a.address === ip) : [];
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {lease && (
                      <div style={{ background: '#F8FAFC', border: '1px solid #F1F5F9', borderRadius: 14, padding: 14 }}>
                        <div style={{ fontSize: '0.64rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H4a4 4 0 0 0-4 4v2"/><circle cx="4" cy="7" r="4"/></svg> DHCP LEASE</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                          <Field label="Address" value={lease.address} mono />
                          <Field label="MAC" value={lease['mac-address']} mono />
                          <Field label="Hostname" value={lease['host-name']} />
                          <Field label="Status" value={<span style={{ padding: '3px 10px', borderRadius: 99, background: lease.status === 'bound' ? '#DCFCE7' : '#FEF3C7', color: lease.status === 'bound' ? '#16A34A' : '#92400E', fontWeight: 700, fontSize: '0.7rem', border: `1px solid ${lease.status === 'bound' ? '#BBF7D0' : '#FDE68A'}` }}>{lease.status}</span>} />
                        </div>
                      </div>
                    )}
                    {links.length > 0 && (
                      <div style={{ background: '#F8FAFC', border: '1px solid #F1F5F9', borderRadius: 14, padding: 14 }}>
                        <div style={{ fontSize: '0.64rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/></svg> WIRELESS LINK</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                          {links.map(w => (
                            <div key={w['.id']} style={{ background: '#fff', borderRadius: 12, padding: 12, border: '1px solid #F1F5F9' }}>
                              <Field label="MAC" value={w['mac-address']} mono />
                              <Field label="Signal" value={w['signal-strength'] ?? w.signal} mono />
                              <Field label="Rate" value={w['last-tx-rate'] ?? w['tx-rate']} />
                              <Field label="Uptime" value={w.uptime} />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div style={{ background: '#fff', border: '1px solid #F1F5F9', borderRadius: 14, padding: 14 }}>
                      <div style={{ fontSize: '0.64rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 }}>FIREWALL ADDRESS LISTS</div>
                      {entries.length === 0 && <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#16A34A', fontSize: '0.8rem', fontWeight: 600, background: '#F0FDF4', border: '1px solid #BBF7D0', padding: '10px 14px', borderRadius: 12 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#16A34A' }} />Not in any firewall list — clean</div>}
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: entries.length ? 10 : 8 }}>
                        {entries.map(e => (
                          <button key={e['.id']} onClick={() => blockToggle(e)} disabled={busy} style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 99, border: '1px solid #FECACA', background: '#FEF2F2',
                            color: '#DC2626', fontWeight: 700, fontSize: '0.75rem', cursor: 'pointer', opacity: busy ? 0.6 : 1,
                          }}>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> {e.list} — remove
                          </button>
                        ))}
                        {ip && entries.length === 0 && (
                          <button onClick={() => blockToggle()} disabled={busy} style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 99, border: '1px solid #FECACA', background: '#fff',
                            color: '#DC2626', fontWeight: 700, fontSize: '0.75rem', cursor: 'pointer', opacity: busy ? 0.6 : 1,
                          }}>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> Block at Firewall
                          </button>
                        )}
                      </div>
                    </div>
                    {!lease && links.length === 0 && <div style={{ textAlign: 'center', padding: '10px 0', color: '#94A3B8', fontSize: '0.78rem', background: '#F8FAFC', borderRadius: 12, border: '1px dashed #E2E8F0' }}>No DHCP lease or wireless registration found for this CPE — waiting for device to come online.</div>}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>
      <UsageHistoryCard username={cpe && cpe.connectionType === 'PPPOE' ? cpe.name : undefined} ip={cpe && cpe.connectionType !== 'PPPOE' ? cpe.ipAddress : undefined} planSpeedMbps={customer.speedMbps} />
    </main>
  );
}
