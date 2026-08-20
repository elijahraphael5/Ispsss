'use client';

import { useState, useEffect, useMemo } from 'react';
import { api, apiUpload, timeAgo } from '@isp/shared';
import { useRouter } from 'next/navigation';
import { SkeletonTable } from '../../../components/Skeleton';

interface ImportResult {
  created: number;
  skipped: number;
  errors: number;
  total: number;
  rows: { row: number; email: string; name: string; status: string; reason?: string; plan?: string }[];
}

interface ImportJob {
  status: 'running' | 'done' | 'failed';
  stage: string;
  total: number;
  processed: number;
  created: number;
  skipped: number;
  errors: number;
  error?: string;
}

const PAGE_SIZE = 15;

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
  dbOnly?: boolean;
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
  pppoeUsername?: string | null;
}

type Row = RosSubscriber & { _type: 'PPPOE' } | StaticConn & { _type: 'STATIC_IP' };

function badge(label: string, color: string) {
  return <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600, backgroundColor: color + '18', color }}>{label}</span>;
}

function planFee(planId: string, networkType: string): string {
  const p = plans.find((x: any) => x.id === planId);
  if (p?.installationFeeKobo) return String(Math.round(p.installationFeeKobo / 100));
  return networkType === 'FIBER' ? '50000' : '120000';
}

function cell(pad = '7px 12px') {
  return { padding: pad, fontSize: '0.78rem' as const };
}

const lbl = { display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 } as const;
const inp = { width: '100%', padding: '8px 12px', borderRadius: 12, border: '1px solid var(--border-color)', fontSize: '0.85rem', boxSizing: 'border-box' as const };

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
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [planFilter, setPlanFilter] = useState('All');

  // excel import
  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportJob | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState('');

  // new customer
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createForm, setCreateForm] = useState({
    name: '', email: '', phone: '', address: '',
    planId: '', networkType: 'FIBER', pppoeUsername: '', ipAddress: '',
    expiry: '', fee: '', portalPassword: '', radiusPassword: '', sendWelcome: false, includeInstallation: false,
  });

  async function handleCreateCustomer() {
    const f = createForm;
    if (!f.name.trim() || !f.email.trim()) { setCreateError('Name and email are required'); return; }
    setCreating(true);
    setCreateError('');
    try {
      const password = f.portalPassword || Math.random().toString(36).slice(2, 10);
      const user = await api<{ id: string }>('/users', {
        method: 'POST',
        body: JSON.stringify({ email: f.email.trim().toLowerCase(), password, name: f.name.trim(), phone: f.phone.trim() || undefined }),
      });
      const sub = await api<{ id: string }>('/subscriptions', {
        method: 'POST',
        body: JSON.stringify({ userId: user.id, type: 'RESIDENTIAL', address: f.address.trim() || undefined, pppoeUsername: f.pppoeUsername.trim() || undefined, networkType: f.networkType === 'PPPOE' || f.networkType === 'STATIC_IP' ? undefined : f.networkType }),
      });
      if (f.planId) {
        await api(`/subscriptions/${sub.id}/subscriptions`, {
          method: 'POST',
          body: JSON.stringify({
            planId: f.planId,
            autoRenew: true,
            expiresAt: f.expiry ? new Date(f.expiry).toISOString() : new Date(Date.now() + 30 * 86400000).toISOString(),
            ...(f.includeInstallation && f.fee ? { installationFeeKobo: Math.round(parseFloat(f.fee) * 100) } : {}),
          }),
        });
      }
      if (f.ipAddress.trim()) {
        await api(`/network/subscribers/${sub.id}/cpes`, {
          method: 'POST',
          body: JSON.stringify({ name: f.pppoeUsername.trim() || f.name.trim(), ipAddress: f.ipAddress.trim() }),
        });
      }
      if (f.pppoeUsername.trim()) {
        await api(`/customers/${sub.id}/radius/activate`, {
          method: 'POST',
          body: JSON.stringify({
            ...(f.radiusPassword.trim() ? { password: f.radiusPassword.trim() } : {}),
            ...(f.expiry ? { expiresAt: new Date(f.expiry).toISOString() } : {}),
          }),
        });
      }
      if (f.sendWelcome) {
        await api(`/subscriptions/${sub.id}/send-welcome`, { method: 'POST', body: JSON.stringify({ password }) });
      }
      setShowCreate(false);
      setCreateForm({ name: '', email: '', phone: '', address: '', planId: '', networkType: 'FIBER', pppoeUsername: '', ipAddress: '', expiry: '', fee: '', portalPassword: '', radiusPassword: '', sendWelcome: false, includeInstallation: false });
      await load();
    } catch (e: any) {
      setCreateError(e?.message ?? 'Failed to create customer');
    } finally {
      setCreating(false);
    }
  }

  async function handleImport() {
    if (!importFile) { setImportError('Choose an .xlsx or .csv file first'); return; }
    setImporting(true);
    setImportError('');
    setImportProgress({ status: 'running', stage: 'uploading…', total: 0, processed: 0, created: 0, skipped: 0, errors: 0 });
    try {
      const res = await apiUpload<{ jobId: string }>('/users/import', importFile);
      const poll = async () => {
        try {
          const job = await api<ImportJob>(`/users/import/${res.jobId}`);
          setImportProgress(job);
          if (job.status === 'done') {
            setImportResult(job as unknown as ImportResult);
            setImportFile(null);
            await load();
          } else if (job.status === 'failed') {
            setImportError(job.error ?? 'Import failed');
          } else {
            setTimeout(poll, 1200);
          }
        } catch (e: any) {
          setImportError(e?.message ?? 'Failed to fetch import progress');
        }
      };
      poll();
    } catch (e: any) {
      setImportError(e?.message ?? 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  const allRows: Row[] = useMemo(() => {
    const pppoe: Row[] = subscribers.map(s => ({ ...s, _type: 'PPPOE' as const }));
    const pppoeNames = new Set(pppoe.map(r => r.username.toLowerCase()));
    const dbOnly: Row[] = customers
      .filter(c => c.pppoeUsername
        && !c.cpes.some(cp => cp.connectionType === 'STATIC_IP')
        && !pppoeNames.has(c.pppoeUsername.toLowerCase()))
      .map(c => ({
        id: c.id,
        username: c.pppoeUsername as string,
        customer: c.name || c.pppoeUsername as string,
        plan: c.plan || '—',
        active: c.status === 'ACTIVE',
        service: 'pppoe',
        lastCallerId: null,
        lastDisconnectReason: null,
        lastLoggedOut: null,
        comment: null,
        dbOnly: true,
        isOnline: false,
        name: c.name,
        email: c.email,
        phone: c.phone,
        address: c.address,
        _type: 'PPPOE' as const,
      }));
    const staticIp: Row[] = staticConns.map(s => ({ ...s, _type: 'STATIC_IP' as const }));
    if (filter === 'PPPoE') return [...pppoe, ...dbOnly];
    if (filter === 'Static IP') return staticIp;
    return [...pppoe, ...dbOnly, ...staticIp];
  }, [subscribers, staticConns, customers, filter]);

  function rowActive(row: Row): boolean {
    if (row._type === 'PPPOE') return !!(row.isOnline || row.active);
    return row.status === 'ACTIVE' || row.status === 'ONLINE';
  }
  function rowPlan(row: Row): string | null {
    const cust = matchCustomer(row);
    if (row._type === 'PPPOE') return row.plan || cust?.plan || null;
    return cust?.plan || null;
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const planOptions = new Set<string>();
    for (const row of allRows) {
      const p = rowPlan(row);
      if (p) planOptions.add(p);
    }
    return {
      rows: allRows.filter(row => {
        if (statusFilter !== 'All' && rowActive(row) !== (statusFilter === 'Active')) return false;
        if (planFilter !== 'All' && rowPlan(row) !== planFilter) return false;
        if (!q) return true;
        const cust = matchCustomer(row);
        const hay = [
          cust?.name, row.name, row.customer,
          cust?.email, row.email,
          cust?.phone, row.phone,
          row.username, cust?.pppoeUsername,
          cust?.address, row.address,
        ].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
      }),
      planOptions: [...planOptions].sort(),
    };
  }, [allRows, search, statusFilter, planFilter, customers]);

  const filteredRows = filtered.rows;
  const totalPagesFiltered = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const paged = useMemo(() => filteredRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filteredRows, page]);
  useEffect(() => { setPage(0); }, [search, statusFilter, planFilter, filter]);

  const rosHealth = routerHealth.find(h => h.deviceId === rosDevice?.id);
  const staleDevice = rosHealth && rosHealth.linkStatus !== 'up' ? rosHealth : null;

  useEffect(() => { load(); }, []);

  function matchCustomer(row: Row): Customer | undefined {
    if (row._type === 'PPPOE') {
      const byUser = customers.find(c => c.name === row.username || c.email === row.username || c.pppoeUsername === row.username);
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
      const c = matchCustomer(row);
      if (c && (row as RosSubscriber & { _type: 'PPPOE' }).dbOnly) {
        router.push(`/users/manage/${c.id}`);
        return;
      }
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
            {filteredRows.length} of {allRows.length} shown &middot; {allRows.filter(r => r._type === 'PPPOE' && (r.isOnline || r.active)).length} PPPoE active
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
            &middot; {allRows.filter(r => r._type === 'STATIC_IP' && matchCustomer(r)?.status === 'ACTIVE').length} Static IP active
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={load} disabled={loading} style={{
          padding: '8px 20px', borderRadius: 20, border: '1px solid var(--primary)', background: 'transparent',
          color: 'var(--primary)', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer',
        }}>{loading ? 'Loading...' : 'Refresh'}</button>
        <button onClick={() => { setCreateError(''); setShowCreate(true); }} style={{
          padding: '8px 20px', borderRadius: 20, border: '1px solid var(--primary)', background: 'transparent',
          color: 'var(--primary)', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer',
        }}>New Customer</button>
        <button onClick={() => { setImportResult(null); setImportError(''); setImportFile(null); setShowImport(true); }} style={{
          padding: '8px 20px', borderRadius: 20, border: 'none', background: 'var(--primary)',
          color: '#fff', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer',
        }}>Import Excel</button>
      </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {(['All', 'PPPoE', 'Static IP'] as const).map(f => (
          <button key={f} onClick={() => { setFilter(f); setPage(0); }}
            style={{ padding: '6px 16px', borderRadius: 20, border: '1px solid var(--border-color)', cursor: 'pointer', fontWeight: 600, fontSize: '0.75rem', backgroundColor: filter === f ? 'var(--primary)' : '#fff', color: filter === f ? '#fff' : 'var(--text-color)' }}>
            {f}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); }}
          placeholder="Search name, email, phone, username, address…"
          style={{ flex: '1 1 220px', padding: '8px 14px', borderRadius: 20, border: '1px solid var(--border-color)', fontSize: '0.82rem', minWidth: 0 }}
        />
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); }}
          style={{ padding: '8px 14px', borderRadius: 20, border: '1px solid var(--border-color)', fontSize: '0.82rem', cursor: 'pointer', background: '#fff' }}
        >
          <option value="All">All statuses</option>
          <option value="Active">Active</option>
          <option value="Inactive">Inactive</option>
        </select>
        <select
          value={planFilter}
          onChange={e => { setPlanFilter(e.target.value); }}
          style={{ padding: '8px 14px', borderRadius: 20, border: '1px solid var(--border-color)', fontSize: '0.82rem', cursor: 'pointer', background: '#fff', maxWidth: 220 }}
        >
          <option value="All">All plans</option>
          {filtered.planOptions.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
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

      {filteredRows.length === 0 ? (
        <div className="data-card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          {search || statusFilter !== 'All' || planFilter !== 'All'
            ? 'No customers match your search/filters'
            : filter === 'PPPoE' ? 'No PPPoE subscribers found on RouterOS' : filter === 'Static IP' ? 'No static IP connections found' : 'No subscribers found'}
        </div>
      ) : (
        <div className="data-card" style={{ padding: 0, overflowY: 'auto', overflowX: 'hidden', height: 'calc(100vh - 280px)', minHeight: 360 }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-color)', position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
                  <th style={cell('8px 12px')}>NAME</th>
                  <th style={cell('8px 12px')}>EMAIL</th>
                  <th style={cell('8px 12px')}>PHONE</th>
                  <th style={cell('8px 12px')}>ADDRESS</th>
                  <th style={cell('8px 12px')}>NETWORK</th>
                  <th style={cell('8px 12px')}>PLAN</th>
                  <th style={cell('8px 12px')}>SPEED ↓/↑</th>
                  <th style={cell('8px 12px')}>INSTALLER</th>
                  <th style={cell('8px 12px')}>DUE DATE</th>
                  <th style={cell('8px 12px')}>STATUS</th>
                  <th style={cell('8px 12px')}>UNIQUE ID</th>
                  <th style={cell('8px 12px')}></th>
                </tr>
              </thead>
              <tbody>
                {paged.map(row => {
                  const cust = matchCustomer(row);
                  if (row._type === 'PPPOE') {
                    const s = row as RosSubscriber & { _type: 'PPPOE' };
                    return (
                      <tr key={s.id} onClick={() => openRow(row)} style={{ borderBottom: '1px solid #f0f0f0', cursor: 'pointer' }} onMouseEnter={e => (e.currentTarget.style.background = '#FAFAFA')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                        <td style={{ ...cell(), fontWeight: 600 }}>{cust?.name || s.name || s.customer || '—'}{s.dbOnly && <span title="in the platform DB, not yet seen on RouterOS" style={{ marginLeft: 6, fontSize: '0.62rem', fontWeight: 600, padding: '2px 6px', borderRadius: 8, backgroundColor: '#F1592518', color: '#B33A1D' }}>DB</span>}{s.cached && <span title={`last synced ${s.capturedAt}`} style={{ marginLeft: 6, fontSize: '0.62rem', fontWeight: 600, padding: '2px 6px', borderRadius: 8, backgroundColor: '#F59E0B18', color: '#B45309' }}>cached</span>}</td>
                        <td style={cell()}>{cust?.email || s.email || '—'}</td>
                        <td style={cell()}>{cust?.phone || s.phone || '—'}</td>
                        <td style={{ ...cell(), maxWidth: 190, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={(cust?.address || s.address || '')}>{cust?.address || s.address || '—'}</td>
                        <td style={cell()}>{badge(cust?.networkType || 'PPPoE', '#2563EB')}</td>
                        <td style={cell()}>{badge(s.plan || cust?.plan || '—', '#6366F1')}</td>
                        <td style={cell()}>{speedBadge(row)}</td>
                        <td style={cell()}>{cust?.cpes.find(c => c.name === s.username)?.installerName || s.installerName || '—'}</td>
                        <td style={cell()}>{cust?.dueAt ? new Date(cust.dueAt).toLocaleDateString() : '—'}</td>
                        <td style={cell()}>{s.dbOnly
                          ? badge(cust?.status === 'ACTIVE' ? 'Active' : cust?.status || '—', cust?.status === 'ACTIVE' ? '#16A34A' : '#94A3B8')
                          : s.cached
                            ? badge(s.isOnline ? 'Active' : 'Offline', s.isOnline ? '#16A34A' : '#94A3B8')
                            : badge(s.active ? 'Active' : 'Disabled', s.active ? '#16A34A' : '#94A3B8')}</td>
                        <td style={{ ...cell(), fontFamily: 'monospace', fontSize: '0.7rem', color: 'var(--text-muted)' }}>{s.username}</td>
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
                      <td style={{ ...cell(), maxWidth: 190, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={(cust?.address || '')}>{cust?.address || '—'}</td>
                      <td style={cell()}>{badge(cust?.networkType || 'Static IP', '#F15925')}</td>
                      <td style={cell()}>{badge(cust?.plan || '—', '#6366F1')}</td>
                      <td style={cell()}>{speedBadge(row)}</td>
                      <td style={cell()}>{cpe?.installerName || '—'}</td>
                      <td style={cell()}>{cust?.dueAt ? new Date(cust.dueAt).toLocaleDateString() : '—'}</td>
                      <td style={cell()}>{badge(isActive ? 'Active' : 'Offline', isActive ? '#16A34A' : '#94A3B8')}</td>
                      <td style={{ ...cell(), fontFamily: 'monospace', fontSize: '0.7rem', color: 'var(--text-muted)' }}>{c.id.slice(0, 8)}</td>
                      <td style={cell()}><span style={{ color: 'var(--primary)' }}>→</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {filteredRows.length > PAGE_SIZE && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '14px 24px', backgroundColor: 'var(--bg-card)', borderRadius: 24, border: '1px solid var(--border-color)', marginTop: 20 }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{filteredRows.length} shown — page {page + 1} of {totalPagesFiltered}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
              style={{ padding: '6px 14px', borderRadius: 20, border: '1px solid var(--border-color)', background: '#fff', cursor: 'pointer', fontWeight: 500, fontSize: '0.8rem', opacity: page === 0 ? 0.4 : 1 }}>
              Previous
            </button>
            <button disabled={page >= totalPagesFiltered - 1} onClick={() => setPage(p => p + 1)}
              style={{ padding: '6px 14px', borderRadius: 20, border: '1px solid var(--border-color)', background: '#fff', cursor: 'pointer', fontWeight: 500, fontSize: '0.8rem', opacity: page >= totalPagesFiltered - 1 ? 0.4 : 1 }}>
              Next
            </button>
          </div>
        </div>
      )}

      {showCreate && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}
          onClick={() => setShowCreate(false)}>
          <div style={{ background: 'white', padding: 32, width: 520, maxWidth: '95vw', height: '100vh', overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.1)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>New Customer</h2>
              <span style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setShowCreate(false)}>✕</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={lbl}>Full name *</label>
                <input value={createForm.name} onChange={e => setCreateForm({ ...createForm, name: e.target.value })} style={inp} />
              </div>
              <div>
                <label style={lbl}>Email *</label>
                <input value={createForm.email} onChange={e => setCreateForm({ ...createForm, email: e.target.value })} style={inp} />
              </div>
              <div>
                <label style={lbl}>Phone</label>
                <input value={createForm.phone} onChange={e => setCreateForm({ ...createForm, phone: e.target.value })} style={inp} />
              </div>
              <div>
                <label style={lbl}>Network type</label>
                <select value={createForm.networkType} onChange={e => { const nt = e.target.value; setCreateForm(f => ({ ...f, networkType: nt, ...(f.includeInstallation ? { fee: planFee(f.planId, nt) } : {}) })); }} style={inp}>
                  <option value="FIBER">FIBER</option>
                  <option value="RADIO">RADIO</option>
                  <option value="PPPOE">PPPoE</option>
                  <option value="STATIC_IP">Static IP</option>
                </select>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={lbl}>Home address</label>
                <input value={createForm.address} onChange={e => setCreateForm({ ...createForm, address: e.target.value })} style={inp} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={lbl}>Plan</label>
                <select value={createForm.planId} onChange={e => { const pid = e.target.value; setCreateForm(f => ({ ...f, planId: pid, ...(f.includeInstallation ? { fee: planFee(pid, f.networkType) } : {}) })); }} style={inp}>
                  <option value="">— No plan —</option>
                  {plans.map((p: any) => <option key={p.id} value={p.id}>{p.name} ({p.technology ?? p.type})</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>PPPoE / RADIUS username</label>
                <input value={createForm.pppoeUsername} onChange={e => setCreateForm({ ...createForm, pppoeUsername: e.target.value })} style={inp} placeholder="e.g. HIF-0001" />
              </div>
              <div>
                <label style={lbl}>Static IP address</label>
                <input value={createForm.ipAddress} onChange={e => setCreateForm({ ...createForm, ipAddress: e.target.value })} style={inp} placeholder="e.g. 192.168.1.10" />
              </div>
              <div>
                <label style={lbl}>Expiry date</label>
                <input type="date" value={createForm.expiry} onChange={e => setCreateForm({ ...createForm, expiry: e.target.value })} style={inp} />
              </div>
              <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
                <input type="checkbox" checked={createForm.includeInstallation} onChange={e => { const on = e.target.checked; setCreateForm(f => ({ ...f, includeInstallation: on, fee: on ? planFee(f.planId, f.networkType) : f.fee })); }} style={{ width: 16, height: 16 }} />
                <span>Include installation fee</span>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={lbl}>Installation fee (₦) — optional</label>
                <input value={createForm.fee} disabled={!createForm.includeInstallation} onChange={e => setCreateForm({ ...createForm, fee: e.target.value })} style={{ ...inp, ...(createForm.includeInstallation ? {} : { background: '#F5F5F5', color: 'var(--text-muted)' }) }} placeholder="auto-filled from plan" />
              </div>
              <div>
                <label style={lbl}>Portal password</label>
                <input value={createForm.portalPassword} onChange={e => setCreateForm({ ...createForm, portalPassword: e.target.value })} style={inp} placeholder="random if blank" />
              </div>
              <div>
                <label style={lbl}>RADIUS password</label>
                <input value={createForm.radiusPassword} onChange={e => setCreateForm({ ...createForm, radiusPassword: e.target.value })} style={inp} placeholder="default if blank" />
              </div>
              <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
                <input type="checkbox" checked={createForm.sendWelcome} onChange={e => setCreateForm({ ...createForm, sendWelcome: e.target.checked })} style={{ width: 16, height: 16 }} />
                <span>Send welcome email with login details</span>
              </div>
            </div>

            {createError && (
              <div style={{ padding: '10px 14px', background: '#FEE2E2', color: '#DC2626', borderRadius: 10, marginTop: 12, fontSize: '0.85rem' }}>{createError}</div>
            )}

            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 20 }}>
              <button onClick={() => setShowCreate(false)} className="btn-outline">Cancel</button>
              <button onClick={handleCreateCustomer} disabled={creating} className="btn-primary">
                {creating ? 'Creating…' : 'Create Customer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showImport && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}
          onClick={() => setShowImport(false)}>
          <div style={{ background: 'white', padding: 32, width: 560, maxWidth: '95vw', height: '100vh', overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.1)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>Import Customers from Excel</h2>
              <span style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setShowImport(false)}>✕</span>
            </div>

            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.6 }}>
              Upload an <b>.xlsx</b>, <b>.xls</b> or <b>.csv</b> file. The first row must be headers. Recognized columns (case-insensitive):
              <b>Name</b> (or <b>First Name</b> + <b>Last Name</b>), <b>Email</b> (required), <b>Phone</b>/<b>Contact Number</b>, <b>Address</b> (or <b>Station</b>),
              <b>Plan</b>, <b>Installation Fee</b>, <b>Expiry Date</b>, <b>ID</b>/<b>ID2</b> (PPPoE username), <b>Password</b> (RADIUS), <b>Portal Password</b> (app login),
              <b>User Type</b> (PPPOE/STATIC), <b>IP Address</b>. PPPoE customers are activated on RADIUS immediately with the expiry written to FreeRADIUS so it's enforced the moment the connection starts.
              <br/><b>Warning:</b> uploading wipes ALL existing customer data first — the file is the new source of truth.
            </div>

            <input type="file" accept=".xlsx,.xls,.csv" onChange={e => { setImportFile(e.target.files?.[0] ?? null); setImportResult(null); setImportProgress(null); setImportError(''); }}
              style={{ width: '100%', marginBottom: 12, fontSize: '0.85rem' }} />

            {importProgress && importProgress.status === 'running' && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {importProgress.stage === 'importing' ? 'Importing…' : importProgress.stage === 'uploading…' ? 'Uploading file…' : importProgress.stage}
                  </span>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700 }}>
                    {importProgress.total > 0 ? `${importProgress.processed} / ${importProgress.total}` : ''}
                  </span>
                </div>
                <div style={{ background: '#F1F5F9', borderRadius: 10, height: 10, overflow: 'hidden' }}>
                  <div style={{
                    width: `${importProgress.total > 0 ? Math.round((importProgress.processed / importProgress.total) * 100) : 12}%`,
                    height: '100%', background: '#F15925', borderRadius: 10, transition: 'width 0.4s ease',
                  }} />
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  <span style={{ color: '#16A34A', fontWeight: 600 }}>{importProgress.created} created</span>
                  <span style={{ color: '#B45309', fontWeight: 600 }}>{importProgress.skipped} skipped</span>
                  <span style={{ color: '#DC2626', fontWeight: 600 }}>{importProgress.errors} errors</span>
                </div>
              </div>
            )}

            {importError && (
              <div style={{ padding: '10px 14px', background: '#FEE2E2', color: '#DC2626', borderRadius: 10, marginBottom: 12, fontSize: '0.85rem' }}>{importError}</div>
            )}

            {importResult && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                  <span style={{ padding: '6px 14px', borderRadius: 16, background: '#16A34A18', color: '#16A34A', fontWeight: 700, fontSize: '0.8rem' }}>{importResult.created} created</span>
                  <span style={{ padding: '6px 14px', borderRadius: 16, background: '#F59E0B18', color: '#B45309', fontWeight: 700, fontSize: '0.8rem' }}>{importResult.skipped} skipped</span>
                  <span style={{ padding: '6px 14px', borderRadius: 16, background: '#DC262618', color: '#DC2626', fontWeight: 700, fontSize: '0.8rem' }}>{importResult.errors} errors</span>
                  <span style={{ padding: '6px 14px', borderRadius: 16, background: '#E2E8F0', color: '#334155', fontWeight: 700, fontSize: '0.8rem' }}>{importResult.total} rows</span>
                </div>
                {importResult.rows.length > 0 && (
                  <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 12 }}>
                    <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
                      <thead style={{ position: 'sticky', top: 0, background: '#F8FAFC' }}>
                        <tr>
                          <th style={{ padding: '8px 12px', textAlign: 'left' }}>ROW</th>
                          <th style={{ padding: '8px 12px', textAlign: 'left' }}>NAME</th>
                          <th style={{ padding: '8px 12px', textAlign: 'left' }}>EMAIL</th>
                          <th style={{ padding: '8px 12px', textAlign: 'left' }}>RESULT</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importResult.rows.map(r => (
                          <tr key={r.row} style={{ borderTop: '1px solid #F1F5F9' }}>
                            <td style={{ padding: '6px 12px', color: 'var(--text-muted)' }}>{r.row}</td>
                            <td style={{ padding: '6px 12px' }}>{r.name || '—'}</td>
                            <td style={{ padding: '6px 12px', fontFamily: 'monospace', fontSize: '0.75rem' }}>{r.email || '—'}</td>
                            <td style={{ padding: '6px 12px' }}>
                              <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: '0.7rem', fontWeight: 600,
                                background: r.status === 'created' ? '#16A34A18' : r.status === 'skipped' ? '#F59E0B18' : '#DC262618',
                                color: r.status === 'created' ? '#16A34A' : r.status === 'skipped' ? '#B45309' : '#DC2626' }}>
                                {r.status === 'created' ? `Created${r.plan ? ` · ${r.plan}` : ''}` : r.status}
                              </span>
                              {r.reason && <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginTop: 2 }}>{r.reason}</div>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
              <button onClick={() => setShowImport(false)} className="btn-outline">Close</button>
              <button onClick={handleImport} disabled={importing || !importFile || importProgress?.status === 'running'} className="btn-primary">
                {importing ? 'Importing...' : 'Import File'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
