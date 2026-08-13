'use client';

import { useState, useEffect, useMemo } from 'react';
import { api, timeAgo } from '@isp/shared';
import { useRouter } from 'next/navigation';
import { SkeletonTable } from '../../../components/Skeleton';

const PAGE_SIZE = 24;

interface RosSubscriber {
  id: string;
  username: string;
  customer: string;
  plan: string;
  active: boolean;
  service: string;
  lastCallerId: string | null;
  lastDisconnectReason: string | null;
  lastLoggedOut: string | null;
  comment: string | null;
  isOnline?: boolean;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  installerName?: string | null;
  cached?: boolean;
  capturedAt?: string | null;
}

interface SnapshotRow {
  id: string;
  username: string;
  customer: string;
  plan: string | null;
  active: boolean;
  isOnline: boolean;
  lastCallerId: string | null;
  lastDisconnectReason: string | null;
  lastLoggedOut: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  installerName: string | null;
  capturedAt: string;
}

interface StaticConn {
  id: string;
  type: 'STATIC_IP';
  username: string | null;
  ipAddress: string | null;
  status: string;
  subscriberName: string | null;
  lastSeen: string | null;
}

interface Customer {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  networkType: string | null;
  plan: string | null;
  dueAt: string | null;
  dueAmountKobo: number | null;
  dueStatus: string | null;
  cpes: { id: string; name: string | null; ipAddress: string | null; status: string; connectionType: string; installerName: string | null }[];
}

type Row = RosSubscriber & { _type: 'PPPOE' } | StaticConn & { _type: 'STATIC_IP' };

function badge(label: string, color: string) {
  return <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600, backgroundColor: color + '18', color }}>{label}</span>;
}

function cell(pad = '10px 16px') {
  return { padding: pad, fontSize: '0.85rem' as const };
}

export default function CustomerPage() {
  const router = useRouter();
  const [subscribers, setSubscribers] = useState<RosSubscriber[]>([]);
  const [staticConns, setStaticConns] = useState<StaticConn[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [rosDevice, setRosDevice] = useState<{ id: string } | null>(null);
  const [routerHealth, setRouterHealth] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [queues, setQueues] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cached, setCached] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<'All' | 'PPPoE' | 'Static IP'>('All');

  const allRows: Row[] = useMemo(() => {
    const pppoe: Row[] = subscribers.map(s => ({ ...s, _type: 'PPPOE' as const }));
    const staticIp: Row[] = staticConns.map(s => ({ ...s, _type: 'STATIC_IP' as const }));
    if (filter === 'PPPoE') return pppoe;
    if (filter === 'Static IP') return staticIp;
    return [...pppoe, ...staticIp];
  }, [subscribers, staticConns, filter]);

  const totalPages = Math.ceil(allRows.length / PAGE_SIZE);
  const paged = useMemo(() => allRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [allRows, page]);

  const rosHealth = routerHealth.find(h => h.deviceId === rosDevice?.id);
  const staleDevice = rosHealth && rosHealth.linkStatus !== 'up' ? rosHealth : null;

  useEffect(() => { load(); }, []);

  function matchCustomer(row: Row): Customer | undefined {
    if (row._type === 'PPPOE') {
      const byUser = customers.find(c => c.name === row.username || c.email === row.username);
      if (byUser) return byUser;
      return customers.find(c => c.cpes.some(x => x.name === row.username));
    }
    const c = row as StaticConn;
    if (c.subscriberName) {
      const byName = customers.find(x => x.name === c.subscriberName);
      if (byName) return byName;
    }
    if (c.ipAddress) {
      return customers.find(x => x.cpes.some(cp => cp.ipAddress === c.ipAddress));
    }
    return undefined;
  }

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [devices, connections, health, cust, planList] = await Promise.all([
        api<any[]>('/network/devices'),
        api<{ connections: StaticConn[] }>('/network/connections'),
        api<any[]>('/router-health').catch(() => []),
        api<Customer[]>('/users/customers'),
        api<any[]>('/subscriptions/plans').catch(() => []),
      ]);
      setPlans(planList);
      setStaticConns(connections.connections.filter(c => c.type === 'STATIC_IP'));
      setRouterHealth(health);
      setCustomers(cust);
      const ros = devices.find(d => d.routerosUsername);
      if (!ros) {
        const sessions = await api<any[]>('/network/sessions').catch(() => []);
        const byUsername = new Map<string, any>();
        for (const s of sessions) byUsername.set(s.username, s);
        setSubscribers([...byUsername.values()].map((s: any): RosSubscriber => ({
          id: s.id,
          username: s.username,
          customer: s.profile ?? s.username,
          plan: s.profile ?? 'PPPoE',
          active: !!s.isActive,
          service: s.serviceType ?? 'pppoe',
          lastCallerId: s.callingStationId ?? null,
          lastDisconnectReason: null,
          lastLoggedOut: null,
          comment: null,
        })));
        setPage(0);
        setLoading(false);
        return;
      }
      setRosDevice({ id: ros.id });
      try {
        const [data, profs, qs] = await Promise.all([
          api<RosSubscriber[]>(`/routeros/devices/${ros.id}/subscribers`),
          api<any[]>(`/routeros/devices/${ros.id}/ppp-profiles`).catch(() => []),
          api<any[]>(`/routeros/devices/${ros.id}/queues`).catch(() => []),
        ]);
        setSubscribers(data);
        setProfiles(profs);
        setQueues(qs);
        setCached(null);
      } catch {
        const snapshots = await api<SnapshotRow[]>('/routeros/snapshots');
        setSubscribers(snapshots.map((s): RosSubscriber => ({
          id: s.id,
          username: s.username,
          customer: s.customer || s.username,
          plan: s.plan || 'PPPoE',
          active: s.active,
          isOnline: s.isOnline,
          service: 'pppoe',
          lastCallerId: s.lastCallerId,
          lastDisconnectReason: s.lastDisconnectReason,
          lastLoggedOut: s.lastLoggedOut,
          comment: s.customer,
          name: s.name,
          email: s.email,
          phone: s.phone,
          address: s.address,
          installerName: s.installerName,
          cached: true,
          capturedAt: s.capturedAt,
        })));
        setCached('router unreachable — showing last known data from DB');
      }
      setPage(0);
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }

  function profileSpeed(profileName: string | null): string | null {
    if (!profileName) return null;
    const p = profiles.find(x => x.name === profileName);
    const first = p?.['rate-limit'] ? String(p['rate-limit']).split(' ')[0] : null;
    return first || null;
  }

  function fmtLimit(v: string | null | undefined): string | null {
    if (!v) return null;
    return String(v).split('/').map(s => {
      const n = parseInt(s, 10);
      return n && n % 1e6 === 0 ? `${n / 1e6}M` : s;
    }).join('/');
  }

  function speedFor(row: Row): string | null {
    if (row._type === 'PPPOE') {
      const fromProfile = profileSpeed(row.plan || null);
      if (fromProfile) return fromProfile;
      const cust = matchCustomer(row);
      const plan = plans.find(p => p.name === cust?.plan);
      return plan && plan.speedMbps > 0 ? `${plan.speedMbps}/${plan.speedMbps}` : null;
    }
    const c = row as StaticConn & { _type: 'STATIC_IP' };
    const cust = matchCustomer(row);
    const candidates = [cust?.name, c.subscriberName, cust?.cpes.find(cp => cp.ipAddress === c.ipAddress)?.name];
    for (const cand of candidates) {
      if (!cand) continue;
      const q = queues.find(q => q.name === cand);
      if (q?.['max-limit'] && q?.dynamic !== 'true') return fmtLimit(q['max-limit']);
    }
    const plan = plans.find(p => p.name === cust?.plan);
    if (plan && plan.speedMbps > 0) return `${plan.speedMbps}/${plan.speedMbps}`;
    return null;
  }

  function speedBadge(row: Row) {
    const sp = speedFor(row);
    if (!sp) return <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>—</span>;
    const [down, up] = sp.split('/');
    return (
      <span style={{ fontSize: '0.75rem', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
        <span style={{ color: '#2563EB' }}>↓{down || '?'}</span>
        <span style={{ color: 'var(--text-muted)' }}> / </span>
        <span style={{ color: '#F15925' }}>↑{up || '?'}</span>
      </span>
    );
  }

  function openRow(row: Row) {
    if (row._type === 'PPPOE') {
      router.push(`/users/manage/pppoe/${encodeURIComponent(row.username)}`);
      return;
    }
    const c = matchCustomer(row);
    if (c) router.push(`/users/manage/${c.id}`);
  }

  if (loading) {
    return (
      <main style={{ padding: 24 }}>
        <h1 className="page-title">Customers</h1>
        <div className="data-card" style={{ padding: 24, marginTop: 20 }}>
          <SkeletonTable rows={10} cols={9} />
        </div>
      </main>
    );
  }

  return (
    <>
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Customers</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 4 }}>
            {allRows.length} total &middot; {subscribers.filter(s => s.active).length} PPPoE active
            {cached && (
              <span style={{ marginLeft: 6, fontSize: '0.68rem', fontWeight: 600, padding: '2px 8px', borderRadius: 10, backgroundColor: '#F59E0B18', color: '#B45309' }}>
                cached · {timeAgo(subscribers[0]?.capturedAt)}
              </span>
            )}
            {staleDevice && (
              <span title={`Last seen ${staleDevice.lastSeenAt}`} style={{ marginLeft: 6, fontSize: '0.68rem', fontWeight: 600, padding: '2px 8px', borderRadius: 10, backgroundColor: '#F1592518', color: '#B33A1D' }}>
                stale · {timeAgo(staleDevice.lastSeenAt)}
              </span>
            )}
            &middot; {staticConns.filter(s => s.status === 'ACTIVE' || s.status === 'ONLINE').length} Static IP active
          </p>
        </div>
        <button onClick={load} disabled={loading} style={{
          padding: '8px 20px', borderRadius: 20, border: '1px solid var(--primary)', background: 'transparent',
          color: 'var(--primary)', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer',
        }}>{loading ? 'Loading...' : 'Refresh'}</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {(['All', 'PPPoE', 'Static IP'] as const).map(f => (
          <button key={f} onClick={() => { setFilter(f); setPage(0); }}
            style={{ padding: '6px 16px', borderRadius: 20, border: '1px solid var(--border-color)', cursor: 'pointer', fontWeight: 600, fontSize: '0.75rem', backgroundColor: filter === f ? 'var(--primary)' : '#fff', color: filter === f ? '#fff' : 'var(--text-color)' }}>
            {f}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ padding: '12px 16px', background: '#FEE2E2', color: '#DC2626', borderRadius: 12, marginBottom: 16, fontSize: '0.85rem' }}>
          {error}
        </div>
      )}

      {cached && (
        <div style={{ padding: '10px 16px', background: '#FEF3C7', color: '#92400E', borderRadius: 12, marginBottom: 16, fontSize: '0.85rem', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span>⚠</span>
          <span>{cached}{subscribers[0]?.capturedAt ? ` · captured ${new Date(subscribers[0].capturedAt).toLocaleString()}` : ''}. Fields you edit are saved to the DB and will sync to the router when it is back.</span>
        </div>
      )}

      {allRows.length === 0 ? (
        <div className="data-card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          {filter === 'PPPoE' ? 'No PPPoE subscribers found on RouterOS' : filter === 'Static IP' ? 'No static IP connections found' : 'No subscribers found'}
        </div>
      ) : (
        <div className="data-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>
                  <th style={cell('12px 16px')}>NAME</th>
                  <th style={cell('12px 16px')}>EMAIL</th>
                  <th style={cell('12px 16px')}>PHONE</th>
                  <th style={cell('12px 16px')}>ADDRESS</th>
                  <th style={cell('12px 16px')}>NETWORK</th>
                  <th style={cell('12px 16px')}>PLAN</th>
                  <th style={cell('12px 16px')}>SPEED ↓/↑</th>
                  <th style={cell('12px 16px')}>INSTALLER</th>
                  <th style={cell('12px 16px')}>DUE DATE</th>
                  <th style={cell('12px 16px')}>STATUS</th>
                  <th style={cell('12px 16px')}>UNIQUE ID</th>
                  <th style={cell('12px 16px')}></th>
                </tr>
              </thead>
              <tbody>
                {paged.map(row => {
                  const cust = matchCustomer(row);
                  if (row._type === 'PPPOE') {
                    const s = row as RosSubscriber & { _type: 'PPPOE' };
                    return (
                      <tr key={s.id} onClick={() => openRow(row)} style={{ borderBottom: '1px solid #f0f0f0', cursor: 'pointer' }} onMouseEnter={e => (e.currentTarget.style.background = '#FAFAFA')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                        <td style={{ ...cell(), fontWeight: 600 }}>{cust?.name || s.name || s.customer || '—'}{s.cached && <span title={`last synced ${s.capturedAt}`} style={{ marginLeft: 6, fontSize: '0.62rem', fontWeight: 600, padding: '2px 6px', borderRadius: 8, backgroundColor: '#F59E0B18', color: '#B45309' }}>cached</span>}</td>
                        <td style={cell()}>{cust?.email || s.email || '—'}</td>
                        <td style={cell()}>{cust?.phone || s.phone || '—'}</td>
                        <td style={cell()}>{cust?.address || s.address || '—'}</td>
                        <td style={cell()}>{badge(cust?.networkType || 'PPPoE', '#2563EB')}</td>
                        <td style={cell()}>{badge(s.plan || cust?.plan || '—', '#6366F1')}</td>
                        <td style={cell()}>{speedBadge(row)}</td>
                        <td style={cell()}>{cust?.cpes.find(c => c.name === s.username)?.installerName || s.installerName || '—'}</td>
                        <td style={cell()}>{cust?.dueAt ? new Date(cust.dueAt).toLocaleDateString() : '—'}</td>
                        <td style={cell()}>{s.cached
                          ? badge(s.isOnline ? 'Active' : 'Offline', s.isOnline ? '#16A34A' : '#94A3B8')
                          : badge(s.active ? 'Active' : 'Disabled', s.active ? '#16A34A' : '#94A3B8')}</td>
                        <td style={{ ...cell(), fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--text-muted)' }}>{s.username}</td>
                        <td style={cell()}><span style={{ color: 'var(--primary)' }}>→</span></td>
                      </tr>
                    );
                  }
                  const c = row as StaticConn & { _type: 'STATIC_IP' };
                  const isActive = c.status === 'ACTIVE' || c.status === 'ONLINE';
                  const cpe = cust?.cpes.find(cp => cp.ipAddress === c.ipAddress);
                  return (
                    <tr key={c.id} onClick={() => openRow(row)} style={{ borderBottom: '1px solid #f0f0f0', cursor: 'pointer' }} onMouseEnter={e => (e.currentTarget.style.background = '#FAFAFA')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <td style={{ ...cell(), fontWeight: 600 }}>{cust?.name || c.subscriberName || '—'}</td>
                      <td style={cell()}>{cust?.email || '—'}</td>
                      <td style={cell()}>{cust?.phone || '—'}</td>
                      <td style={cell()}>{cust?.address || '—'}</td>
                      <td style={cell()}>{badge(cust?.networkType || 'Static IP', '#F15925')}</td>
                      <td style={cell()}>{badge(cust?.plan || '—', '#6366F1')}</td>
                      <td style={cell()}>{speedBadge(row)}</td>
                      <td style={cell()}>{cpe?.installerName || '—'}</td>
                      <td style={cell()}>{cust?.dueAt ? new Date(cust.dueAt).toLocaleDateString() : '—'}</td>
                      <td style={cell()}>{badge(isActive ? 'Active' : 'Offline', isActive ? '#16A34A' : '#94A3B8')}</td>
                      <td style={{ ...cell(), fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--text-muted)' }}>{c.id.slice(0, 8)}</td>
                      <td style={cell()}><span style={{ color: 'var(--primary)' }}>→</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {allRows.length > PAGE_SIZE && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 24px', backgroundColor: 'var(--bg-card)', borderRadius: 24, border: '1px solid var(--border-color)', marginTop: 20 }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{allRows.length} total — page {page + 1} of {totalPages}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
              style={{ padding: '6px 14px', borderRadius: 20, border: '1px solid var(--border-color)', background: '#fff', cursor: 'pointer', fontWeight: 500, fontSize: '0.8rem', opacity: page === 0 ? 0.4 : 1 }}>
              Previous
            </button>
            <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}
              style={{ padding: '6px 14px', borderRadius: 20, border: '1px solid var(--border-color)', background: '#fff', cursor: 'pointer', fontWeight: 500, fontSize: '0.8rem', opacity: page >= totalPages - 1 ? 0.4 : 1 }}>
              Next
            </button>
          </div>
        </div>
      )}
    </>
  );
}
