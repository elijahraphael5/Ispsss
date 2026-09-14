'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { api, apiUpload, timeAgo, onCustomersChanged, notifyCustomersChanged } from '@isp/shared';
import { useRouter } from 'next/navigation';
import { setCachedCustomer } from '../../../lib/customer-cache';
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
  customer?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
}

interface Customer {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  status: string | null;
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

function planFee(plans: any[], planId: string, networkType: string): string {
  const p = plans.find((x: any) => x.id === planId);
  if (p?.installationFeeKobo) return String(Math.round(p.installationFeeKobo / 100));
  return networkType === 'FIBER' ? '50000' : '120000';
}

function cell(pad = '7px 12px') {
  return { padding: pad, fontSize: '0.78rem' as const };
}

const lbl = { display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 } as const;
const inp = { width: '100%', padding: '8px 12px', borderRadius: 12, border: '1px solid var(--border-color)', fontSize: '0.85rem', boxSizing: 'border-box' as const };

function snapshotRows(snapshots: SnapshotRow[]): RosSubscriber[] {
  return snapshots.map((s): RosSubscriber => ({
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
  }));
}

interface CustomersPageCache {
  subscribers: RosSubscriber[];
  staticConns: StaticConn[];
  customers: Customer[];
  routerHealth: any[];
  plans: any[];
}

// Module scope survives client-side navigation: revisiting the page paints the
// previous rows instantly while the requests revalidate in the background.
let pageCache: CustomersPageCache | null = null;

export default function CustomerPage() {
  const router = useRouter();
  const [subscribers, setSubscribers] = useState<RosSubscriber[]>(() => pageCache?.subscribers ?? []);
  const [staticConns, setStaticConns] = useState<StaticConn[]>(() => pageCache?.staticConns ?? []);
  const [customers, setCustomers] = useState<Customer[]>(() => pageCache?.customers ?? []);
  const [rosDevice, setRosDevice] = useState<{ id: string } | null>(null);
  const [routerHealth, setRouterHealth] = useState<any[]>(() => pageCache?.routerHealth ?? []);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [queues, setQueues] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>(() => pageCache?.plans ?? []);
  const [loading, setLoading] = useState(() => !pageCache);
  const [error, setError] = useState('');
  const [cached, setCached] = useState<string | null>(null);
  const [routerLoading, setRouterLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<'All' | 'Active' | 'Non Active'>('All');
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('All');

  // excel import
  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportJob | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [showColumnsHelp, setShowColumnsHelp] = useState(false);

  // new customer
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createSuccess, setCreateSuccess] = useState('');

  // purge customers
  const [showPurge, setShowPurge] = useState(false);
  const [purging, setPurging] = useState(false);
  const [purgeConfirmText, setPurgeConfirmText] = useState('');

  // delete selected customers
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: '', email: '', phone: '', address: '',
    planId: '', networkType: 'FIBER', pppoeUsername: '', ipAddress: '',
    expiry: '', fee: '50000', portalPassword: '', radiusPassword: '', sendWelcome: false, includeInstallation: true,
  });

  async function handleCreateCustomer() {
    const f = createForm;
    if (!f.name.trim() || !f.email.trim()) { setCreateError('Name and email are required'); return; }
    setCreating(true);
    setCreateError('');
    setCreateSuccess('');
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
      // Independent follow-ups — run together instead of one after another.
      // A RADIUS/CPE/email hiccup must not fail the whole creation: the
      // customer already exists, so report what needs a retry instead.
      const followUps: { label: string; run: Promise<unknown> }[] = [];
      if (f.ipAddress.trim()) {
        followUps.push({
          label: 'CPE',
          run: api(`/network/subscribers/${sub.id}/cpes`, {
            method: 'POST',
            body: JSON.stringify({ name: f.pppoeUsername.trim() || f.name.trim(), ipAddress: f.ipAddress.trim() }),
          }),
        });
      }
      if (f.pppoeUsername.trim()) {
        followUps.push({
          label: 'RADIUS activation',
          run: api(`/customers/${sub.id}/radius/activate`, {
            method: 'POST',
            body: JSON.stringify({
              ...(f.radiusPassword.trim() ? { password: f.radiusPassword.trim() } : {}),
              ...(f.expiry ? { expiresAt: new Date(f.expiry).toISOString() } : {}),
            }),
          }),
        });
      }
      if (f.sendWelcome) {
        followUps.push({
          label: 'welcome email',
          run: api(`/subscriptions/${sub.id}/send-welcome`, { method: 'POST', body: JSON.stringify({ password }) }),
        });
      }
      const settled = await Promise.allSettled(followUps.map(x => x.run));
      const failed = settled.flatMap((r, i) => (r.status === 'rejected' ? [followUps[i].label] : []));
      setShowCreate(false);
      setCreateForm({ name: '', email: '', phone: '', address: '', planId: '', networkType: 'FIBER', pppoeUsername: '', ipAddress: '', expiry: '', fee: '50000', portalPassword: '', radiusPassword: '', sendWelcome: false, includeInstallation: true });
      setCreateSuccess(
        failed.length
          ? `Customer created, but ${failed.join(' and ')} failed — open the customer from the KYC tab to retry.`
          : 'Customer created — it will appear in the Customers list after KYC approval (see the KYC tab).',
      );
      void load(true);
    } catch (e: any) {
      setCreateError(e?.message ?? 'Failed to create customer');
    } finally {
      setCreating(false);
    }
  }

  async function handleImport() {
    if (!importFile) { setImportError('Choose an .xlsx, .xls or .csv file first'); return; }
    const name = importFile.name.toLowerCase();
    if (!/\.(xlsx|xls|csv)$/.test(name)) {
      setImportError(`"${importFile.name}" is not an .xlsx, .xls or .csv file`);
      return;
    }
    if (importFile.size > 25 * 1024 * 1024) {
      setImportError(`File is ${Math.round(importFile.size / 1024 / 1024)} MB — the limit is 25 MB`);
      return;
    }
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
            if (importInputRef.current) importInputRef.current.value = '';
            await load(true);
          } else if (job.status === 'failed') {
            setImportProgress(null);
            setImportError(job.error ?? 'Import failed');
          } else {
            setTimeout(poll, 1200);
          }
        } catch (e: any) {
          setImportProgress(null);
          setImportError(e?.message ?? 'Failed to fetch import progress');
        }
      };
      poll();
    } catch (e: any) {
      setImportProgress(null);
      setImportError(e?.message ?? 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  async function handlePurge() {
    setPurging(true);
    setError('');
    try {
      const res = await api<{ removedSubscribers: number }>('/users/purge-customers', { method: 'POST', body: '{}' });
      setShowPurge(false);
      setPurgeConfirmText('');
      setCreateSuccess(`All ${res.removedSubscribers} customers purged — the customer table is now empty.`);
      await load(true);
    } catch (e: any) {
      setError(e?.message ?? 'Purge failed');
    } finally {
      setPurging(false);
    }
  }

  // Selection key per row: DB customers (`sub:<id>`) and cached RouterOS
  // snapshots (`snap:<id>`) can be deleted; live router-only rows cannot.
  function rowKey(row: Row): string | null {
    const cust = matchCustomer(row);
    if (cust) return `sub:${cust.id}`;
    if (row._type === 'PPPOE' && (row as RosSubscriber & { _type: 'PPPOE' }).cached) return `snap:${row.id}`;
    return null;
  }

  function toggleRow(key: string) {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function togglePage() {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      const pageKeys = [...selectableKeys];
      const allSelected = pageKeys.length > 0 && pageKeys.every(k => next.has(k));
      for (const k of pageKeys) {
        if (allSelected) next.delete(k); else next.add(k);
      }
      return next;
    });
  }

  async function handleDeleteSelected() {
    setDeleting(true);
    setError('');
    setCreateSuccess('');
    let done = 0, failed = 0;
    for (const key of Array.from(selectedKeys)) {
      try {
        if (key.startsWith('sub:')) {
          await api(`/subscriptions/${key.slice(4)}`, { method: 'DELETE' });
        } else if (key.startsWith('snap:')) {
          await api(`/routeros/snapshots/${key.slice(5)}`, { method: 'DELETE' });
        }
        done++;
      } catch {
        failed++;
      }
    }
    setSelectedKeys(new Set());
    setDeleteOpen(false);
    setCreateSuccess(failed
      ? `${done} deleted, ${failed} failed — refresh and retry the rest.`
      : `${done} customer${done === 1 ? '' : 's'} deleted.`);
    notifyCustomersChanged();
    await load();
    setDeleting(false);
  }

  const allRows: Row[] = useMemo(() => {
    const pppoe: Row[] = subscribers.map(s => ({ ...s, _type: 'PPPOE' as const }));
    const pppoeNames = new Set(pppoe.map(r => r.username.toLowerCase()));
    const staticIp: Row[] = staticConns.map(s => ({ ...s, _type: 'STATIC_IP' as const }));

    const matchPppoe = (username: string): Customer | undefined => {
      const byUser = customers.find(c => c.name === username || c.email === username || c.pppoeUsername === username);
      if (byUser) return byUser;
      return customers.find(c => c.cpes.some(x => x.name === username));
    };
    const dbRow = (c: Customer, username: string): Row => ({
      id: c.id,
      username,
      customer: c.name || username,
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
      installerName: c.cpes[0]?.installerName ?? null,
      _type: 'PPPOE' as const,
    });

    const dbOnly: Row[] = customers
      .filter(c => c.pppoeUsername
        && !c.cpes.some(cp => cp.connectionType === 'STATIC_IP')
        && !pppoeNames.has(c.pppoeUsername.toLowerCase()))
      .map(c => dbRow(c, c.pppoeUsername as string));

    // Customers already represented by a RouterOS secret row or a static
    // connection row must not be listed a second time. Everyone else (e.g.
    // freshly created accounts with no PPPoE username yet) gets a DB-only row
    // so they still show up in the list.
    const shown = new Set<string>(dbOnly.map(r => r.id));
    for (const r of pppoe) { const c = matchPppoe(r.username); if (c) shown.add(c.id); }
    for (const sc of staticIp) {
      const s = sc as StaticConn;
      const c = customers.find(x => (s.subscriberName && x.name === s.subscriberName) || (s.ipAddress && x.cpes.some(cp => cp.ipAddress === s.ipAddress)));
      if (c) shown.add(c.id);
    }
    const portalOnly: Row[] = customers
      .filter(c => !shown.has(c.id))
      .map(c => dbRow(c, c.pppoeUsername || c.cpes[0]?.name || c.name || `portal-${c.id.slice(0, 8)}`));

    return [...pppoe, ...dbOnly, ...portalOnly, ...staticIp];
  }, [subscribers, staticConns, customers]);

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
        if (filter !== 'All' && rowActive(row) !== (filter === 'Active')) return false;
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
  }, [allRows, search, filter, planFilter, customers]);

  const filteredRows = filtered.rows;
  const totalPagesFiltered = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const paged = useMemo(() => filteredRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filteredRows, page]);
  useEffect(() => { setPage(0); }, [search, filter, planFilter]);

  // Selection keys for the current page (rows without a platform DB record or
  // snapshot, e.g. live RouterOS-only secrets, are not deletable here).
  const selectableKeys = useMemo(() => new Set(
    paged.map(rowKey).filter((v): v is string => !!v),
  ), [paged, customers]);

  const rosHealth = routerHealth.find(h => h.deviceId === rosDevice?.id);
  const staleDevice = rosHealth && rosHealth.linkStatus !== 'up' ? rosHealth : null;

  useEffect(() => { load(!!pageCache); }, []);

  // Keep the table fresh when customer data changes elsewhere (detail-page
  // edits, KYC approvals) — Next's router cache would otherwise serve stale
  // rows after navigating back. Also reload when the window regains focus.
  useEffect(() => {
    // Silent reloads: never blank the page (the file picker fires `focus`).
    const off = onCustomersChanged(() => load(true));
    const onFocus = () => load(true);
    window.addEventListener('focus', onFocus);
    return () => { off(); window.removeEventListener('focus', onFocus); };
  }, []);

  // Keep the module cache in sync so revisiting the page paints instantly.
  useEffect(() => {
    pageCache = { subscribers, staticConns, customers, routerHealth, plans };
  }, [subscribers, staticConns, customers, routerHealth, plans]);

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

  async function load(silent = false) {
    if (!silent) setLoading(true);
    setError('');
    try {
      // Fire every request independently so each section paints as soon as its
      // data lands instead of waiting for the slowest endpoint.
      const pDevices = api<any[]>('/network/devices').catch(() => [] as any[]);
      void api<{ connections: StaticConn[] }>('/network/connections')
        .then(c => setStaticConns((c.connections ?? []).filter(x => x.type === 'STATIC_IP')))
        .catch(() => {});
      void api<any[]>('/router-health').then(setRouterHealth).catch(() => {});
      void api<Customer[]>('/users/customers').then(setCustomers).catch(() => {});
      void api<any[]>('/subscriptions/plans').then(setPlans).catch(() => {});
      void api<SnapshotRow[]>('/routeros/snapshots')
        .then(s => { if (s.length) setSubscribers(snapshotRows(s)); })
        .catch(() => {});

      const devices = await pDevices;
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
        return;
      }
      setRosDevice({ id: ros.id });
      setCached(null);
      setPage(0);
      setRouterLoading(true);

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
        // Only warn about stale data when there actually is cached data to
        // show — an empty table (e.g. after a purge) has nothing to explain.
        setCached('router unreachable — showing last known data from DB');
      } finally {
        setRouterLoading(false);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
    } finally {
      if (!silent) setLoading(false);
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
        setCachedCustomer(c.id, c);
        router.push(`/users/manage/${c.id}`);
        return;
      }
      router.push(`/users/manage/pppoe/${encodeURIComponent(row.username)}`);
      return;
    }
    const c = matchCustomer(row);
    if (c) { setCachedCustomer(c.id, c); router.push(`/users/manage/${c.id}`); }
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
        <button className="btn-primary" onClick={() => { setCreateError(''); setShowCreate(true); }}>
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Customer
        </button>
      </div>

      <div className="data-card" style={{ marginBottom: 16 }}>
        <div style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div className="badge-tabs">
            {(['All', 'Active', 'Non Active'] as const).map(f => (
              <button key={f} onClick={() => { setFilter(f); setPage(0); }}
                className={`tab-item${filter === f ? ' active' : ''}`}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit', fontWeight: 600 }}>
                {f}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn-sm-outline" onClick={() => load()} disabled={loading}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px' }}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
            <button className="btn-sm-outline" onClick={() => { setImportResult(null); setImportError(''); setImportFile(null); setShowImport(true); }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px' }}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Import Excel
            </button>
            <button className="btn-sm-outline" onClick={() => { setPurgeConfirmText(''); setShowPurge(true); }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', color: '#DC2626', borderColor: '#FCA5A5' }}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              Purge
            </button>
            <button className="btn-sm" onClick={() => setDeleteOpen(true)} disabled={selectedKeys.size === 0}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: selectedKeys.size ? '#DC2626' : '#CBD5E1', cursor: selectedKeys.size ? 'pointer' : 'not-allowed', opacity: selectedKeys.size ? 1 : 0.8 }}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              Delete{selectedKeys.size ? ` (${selectedKeys.size})` : ''}
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, padding: '0 18px 16px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="search-box" style={{ flex: '1 1 260px', width: 'auto' }}>
            <svg width="16" height="16" fill="none" stroke="var(--text-muted)" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); }}
              placeholder="Search name, email, phone, username, address…"
            />
          </div>
          <select
            value={planFilter}
            onChange={e => { setPlanFilter(e.target.value); }}
            style={{ padding: '8px 14px', borderRadius: 20, border: '1px solid var(--border-color)', fontSize: '0.82rem', cursor: 'pointer', background: '#fff', maxWidth: 220 }}
          >
            <option value="All">All plans</option>
            {filtered.planOptions.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>

      {error && (
        <div style={{ padding: '12px 16px', background: '#FEE2E2', color: '#DC2626', borderRadius: 12, marginBottom: 16, fontSize: '0.85rem' }}>
          {error}
        </div>
      )}

      {createSuccess && (
        <div style={{ padding: '12px 16px', background: '#DCFCE7', color: '#166534', borderRadius: 12, marginBottom: 16, fontSize: '0.85rem' }}>
          {createSuccess}
        </div>
      )}

      {cached && (
        <div style={{ padding: '10px 16px', background: '#FEF3C7', color: '#92400E', borderRadius: 12, marginBottom: 16, fontSize: '0.85rem', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span>⚠</span>
          <span>{cached}{subscribers[0]?.capturedAt ? ` · captured ${new Date(subscribers[0].capturedAt).toLocaleString()}` : ''}. Fields you edit are saved to the DB and will sync to the router when it is back.</span>
        </div>
      )}

      {routerLoading && !cached && (
        <div style={{ padding: '10px 16px', background: '#EFF6FF', color: '#1D4ED8', borderRadius: 12, marginBottom: 16, fontSize: '0.85rem' }}>
          {subscribers.length ? 'Loading live data from the router… showing cached data meanwhile.' : 'Loading data from the router…'}
        </div>
      )}

      {loading && allRows.length === 0 ? (
        <div className="data-card" style={{ padding: 24 }}>
          <SkeletonTable rows={10} cols={9} />
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="data-card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          {search || filter !== 'All' || planFilter !== 'All'
            ? 'No customers match your search/filters'
            : 'No subscribers found'}
        </div>
      ) : (
        <div className="data-card" style={{ padding: 0, overflow: 'hidden', height: 'calc(100vh - 280px)', minHeight: 360 }}>
          <div className="h-scroll" style={{ height: '100%', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-color)', position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
                  <th style={{ ...cell('8px 12px'), width: 40 }}>
                    <input type="checkbox" checked={selectableKeys.size > 0 && [...selectableKeys].every(k => selectedKeys.has(k))} onChange={togglePage} title="Select all on this page" style={{ width: 15, height: 15, cursor: 'pointer' }} />
                  </th>
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
                        <td style={cell()} onClick={e => e.stopPropagation()}>
                          <input type="checkbox" disabled={!rowKey(row)} checked={!!(rowKey(row) && selectedKeys.has(rowKey(row)!))} onChange={() => { const k = rowKey(row); if (k) toggleRow(k); }} title={rowKey(row) ? 'Select for deletion' : 'No customer record in the platform DB'} style={{ width: 15, height: 15, cursor: rowKey(row) ? 'pointer' : 'not-allowed' }} />
                        </td>
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
                      <td style={cell()} onClick={e => e.stopPropagation()}>
                        <input type="checkbox" disabled={!rowKey(row)} checked={!!(rowKey(row) && selectedKeys.has(rowKey(row)!))} onChange={() => { const k = rowKey(row); if (k) toggleRow(k); }} title={rowKey(row) ? 'Select for deletion' : 'No customer record in the platform DB'} style={{ width: 15, height: 15, cursor: rowKey(row) ? 'pointer' : 'not-allowed' }} />
                      </td>
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

            <div className="grid-2" style={{ gap: 12 }}>
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
                <select value={createForm.networkType} onChange={e => { const nt = e.target.value; setCreateForm(f => ({ ...f, networkType: nt, ...(f.includeInstallation ? { fee: planFee(plans, f.planId, nt) } : {}) })); }} style={inp}>
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
                <select value={createForm.planId} onChange={e => { const pid = e.target.value; setCreateForm(f => ({ ...f, planId: pid, ...(f.includeInstallation ? { fee: planFee(plans, pid, f.networkType) } : {}) })); }} style={inp}>
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
                <input type="checkbox" checked={createForm.includeInstallation} onChange={e => { const on = e.target.checked; setCreateForm(f => ({ ...f, includeInstallation: on, fee: on ? planFee(plans, f.planId, f.networkType) : f.fee })); }} style={{ width: 16, height: 16 }} />
                <span>Include installation fee</span>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={lbl}>Installation fee (₦)</label>
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
          <div style={{ background: 'white', padding: 32, width: 560, maxWidth: '95vw', height: '100vh', overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'column' }}
            onClick={e => e.stopPropagation()}>
            {/* Header — sideways drawer, consistent with New Customer */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: '#F1592514', color: '#F15925', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                </div>
                <div>
                  <h2 style={{ fontSize: '1.15rem', fontWeight: 800, letterSpacing: -0.3, margin: 0, lineHeight: 1.2 }}>Import Customers</h2>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '2px 0 0' }}>Excel or CSV • first row = headers</p>
                </div>
              </div>
              <button onClick={() => setShowImport(false)} style={{ width: 32, height: 32, borderRadius: 10, border: '1px solid #E2E8F0', background: '#fff', color: '#64748B', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            {/* Body */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
              <div style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: '#F1592514', color: '#F15925', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2 style={{ fontSize: '1.15rem', fontWeight: 800, letterSpacing: -0.3, margin: 0, lineHeight: 1.2 }}>Import Customers</h2>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '4px 0 0', lineHeight: 1.4 }}>Upload an Excel or CSV file — the first row must be headers</p>
              </div>
              <button onClick={() => setShowImport(false)} style={{ width: 32, height: 32, borderRadius: 10, border: '1px solid #E2E8F0', background: '#fff', color: '#64748B', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            {/* Body — scrollable */}
            <div style={{ padding: '20px 28px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>

              <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>

              {/* Warning callout */}
              <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 14, padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ width: 28, height: 28, borderRadius: 10, background: '#F59E0B18', color: '#B45309', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                  <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                </div>
                <div style={{ fontSize: '0.8rem', lineHeight: 1.5 }}>
                  <div style={{ fontWeight: 700, color: '#92400E', marginBottom: 2 }}>This will replace all customer data</div>
                  <div style={{ color: '#78350F' }}>Uploading wipes <b>every</b> customer, subscription, invoice and ticket first — the file becomes the new source of truth. Staff accounts are kept.</div>
                </div>
              </div>

              {/* Dropzone */}
              <div>
                <input ref={importInputRef} type="file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,application/csv" onChange={e => {
                  const f = e.target.files?.[0] ?? null;
                  setImportFile(f);
                  setImportResult(null);
                  setImportProgress(null);
                  setImportError('');
                  e.target.value = '';
                }} style={{ display: 'none' }} />
                <div
                  onClick={() => importInputRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => {
                    e.preventDefault(); setDragOver(false);
                    const f = e.dataTransfer.files?.[0] ?? null;
                    if (f) { setImportFile(f); setImportResult(null); setImportProgress(null); setImportError(''); }
                  }}
                  style={{
                    border: `2px dashed ${dragOver ? '#F15925' : importFile ? '#16A34A' : '#E2E8F0'}`,
                    backgroundColor: dragOver ? '#FFF7ED' : importFile ? '#F0FDF4' : '#F8FAFC',
                    borderRadius: 16, padding: importFile ? 14 : 28, textAlign: 'center', cursor: 'pointer', transition: 'all 0.2s ease',
                  }}>
                  {!importFile ? (
                    <>
                      <div style={{ width: 48, height: 48, borderRadius: 14, background: dragOver ? '#F1592514' : 'white', border: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px', color: dragOver ? '#F15925' : '#64748B' }}>
                        <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="12" y1="17" x2="12" y2="9"/></svg>
                      </div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>{dragOver ? 'Drop file here' : 'Drop file here or click to browse'}</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4 }}>XLSX, XLS or CSV • up to 25 MB • first row must be headers</div>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 12, padding: '6px 14px', borderRadius: 999, background: 'white', border: '1px solid #E2E8F0', fontSize: '0.78rem', fontWeight: 600, color: '#334155' }}>
                        <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        Choose file
                      </div>
                    </>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left' }}>
                      <div style={{ width: 40, height: 40, borderRadius: 12, background: importFile.name.endsWith('.csv') ? '#EFF6FF' : '#DCFCE7', color: importFile.name.endsWith('.csv') ? '#2563EB' : '#16A34A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.7rem', flexShrink: 0 }}>
                        {importFile.name.endsWith('.csv') ? 'CSV' : 'XLS'}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.85rem', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{importFile.name}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{Math.max(1, Math.round(importFile.size / 1024)).toLocaleString()} KB • {importFile.name.split('.').pop()?.toUpperCase()}</div>
                      </div>
                      <button onClick={e => { e.stopPropagation(); setImportFile(null); setImportError(''); }} style={{ width: 32, height: 32, borderRadius: 10, border: '1px solid #E2E8F0', background: 'white', color: '#64748B', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
                        <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                      <button onClick={e => { e.stopPropagation(); importInputRef.current?.click(); }} style={{ padding: '6px 12px', borderRadius: 999, border: '1px solid #E2E8F0', background: 'white', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}>Change</button>
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Accepted: .xlsx, .xls, .csv • Max 25 MB</span>
                  <button onClick={e => { e.preventDefault(); const csv = 'Name,Email,Phone,Address,Plan,Installation Fee,Expiry Date,ID,Password,Portal Password,User Type,IP Address\nJohn Doe,john@example.com,08012345678,No 1 Main St,Home Fiber,50000,2026-12-31,HIF-0001,radius123,portal123,PPPOE,\n'; const blob = new Blob([csv], { type: 'text/csv' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'hikonnect-import-template.csv'; a.click(); URL.revokeObjectURL(url); }} style={{ fontSize: '0.72rem', fontWeight: 600, color: '#F15925', background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    Download template
                  </button>
                </div>
              </div>

              {/* Columns help — collapsible */}
              <div style={{ border: '1px solid #F1F5F9', borderRadius: 14, overflow: 'hidden' }}>
                <button onClick={() => setShowColumnsHelp(v => !v)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: '#F8FAFC', border: 'none', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700, color: '#334155' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                    Recognized columns
                    <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>case-insensitive • first row = headers</span>
                  </span>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ transform: showColumnsHelp ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                {showColumnsHelp && (
                  <div style={{ padding: '14px 16px', background: 'white', borderTop: '1px solid #F1F5F9' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                      {[
                        ['Name','First + Last'],['Email','auto from ID'],['Phone','Contact'],['Address','Station'],['Plan',''],['Install Fee',''],['Expiry','Date'],['ID / ID2','PPPoE user'],['Password','RADIUS'],['Portal Pass','Login'],['User Type','PPPOE/STATIC'],['IP Address','']].map(([a,b]) => (
                        <span key={a} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 999, background: '#F8FAFC', border: '1px solid #E2E8F0', fontSize: '0.7rem' }}>
                          <span style={{ fontWeight: 700, color: '#0F172A' }}>{a}</span>{b && <span style={{ color: 'var(--text-muted)' }}>• {b}</span>}
                        </span>
                      ))}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.5, background: '#F8FAFC', borderRadius: 10, padding: '10px 12px' }}>
                      <b style={{ color: '#334155' }}>PPPoE</b> customers are activated on RADIUS immediately — expiry is written to FreeRADIUS so it’s enforced the moment the connection starts.
                    </div>
                  </div>
                )}
              </div>

              {/* Progress */}
              {importProgress && importProgress.status === 'running' && (
                <div style={{ background: '#F8FAFC', border: '1px solid #F1F5F9', borderRadius: 14, padding: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#F15925', display: 'inline-block', animation: 'pulse 1.2s infinite' }} />
                      {importProgress.stage === 'importing' ? 'Importing customers…' : importProgress.stage === 'uploading…' ? 'Uploading file…' : importProgress.stage}
                    </span>
                    <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#F15925' }}>
                      {importProgress.total > 0 ? `${importProgress.processed} / ${importProgress.total}` : '—'}
                    </span>
                  </div>
                  <div style={{ background: '#E2E8F0', borderRadius: 999, height: 8, overflow: 'hidden' }}>
                    <div style={{
                      width: `${importProgress.total > 0 ? Math.round((importProgress.processed / importProgress.total) * 100) : 12}%`,
                      height: '100%', background: 'linear-gradient(90deg, #F15925, #FB923C)', borderRadius: 999, transition: 'width 0.4s ease',
                    }} />
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, background: '#DCFCE7', color: '#166534', fontWeight: 700, fontSize: '0.72rem' }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: '#16A34A' }} />{importProgress.created} created</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, background: '#FEF3C7', color: '#92400E', fontWeight: 700, fontSize: '0.72rem' }}>{importProgress.skipped} skipped</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, background: '#FEE2E2', color: '#991B1B', fontWeight: 700, fontSize: '0.72rem' }}>{importProgress.errors} errors</span>
                  </div>
                </div>
              )}

              {importError && (
                <div style={{ display: 'flex', gap: 10, padding: '12px 14px', background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', borderRadius: 14, fontSize: '0.82rem', lineHeight: 1.4 }}>
                  <svg width="18" height="18" fill="none" stroke="#DC2626" strokeWidth="2" viewBox="0 0 24 24" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                  <span>{importError}</span>
                </div>
              )}

              {importResult && (
                <div style={{ border: '1px solid #F1F5F9', borderRadius: 14, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '14px 16px', background: '#F8FAFC', borderBottom: '1px solid #F1F5F9' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 999, background: '#DCFCE7', color: '#166534', fontWeight: 800, fontSize: '0.75rem' }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: '#16A34A' }} />{importResult.created} created</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 999, background: '#FEF3C7', color: '#92400E', fontWeight: 800, fontSize: '0.75rem' }}>{importResult.skipped} skipped</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 999, background: '#FEE2E2', color: '#991B1B', fontWeight: 800, fontSize: '0.75rem' }}>{importResult.errors} errors</span>
                    <span style={{ marginLeft: 'auto', padding: '6px 12px', borderRadius: 999, background: 'white', border: '1px solid #E2E8F0', color: '#334155', fontWeight: 700, fontSize: '0.75rem' }}>{importResult.total} rows</span>
                  </div>
                  {importResult.rows.length > 0 && (
                    <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                      <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
                        <thead style={{ position: 'sticky', top: 0, background: '#F8FAFC', zIndex: 1 }}>
                          <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                            <th style={{ padding: '10px 14px', fontWeight: 700 }}>Row</th>
                            <th style={{ padding: '10px 14px', fontWeight: 700 }}>Name</th>
                            <th style={{ padding: '10px 14px', fontWeight: 700 }}>Email</th>
                            <th style={{ padding: '10px 14px', fontWeight: 700 }}>Result</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importResult.rows.map(r => (
                            <tr key={r.row} style={{ borderTop: '1px solid #F1F5F9' }}>
                              <td style={{ padding: '8px 14px', color: 'var(--text-muted)', fontWeight: 600 }}>{r.row}</td>
                              <td style={{ padding: '8px 14px', fontWeight: 600 }}>{r.name || '—'}</td>
                              <td style={{ padding: '8px 14px', fontFamily: 'monospace', fontSize: '0.72rem' }}>{r.email || '—'}</td>
                              <td style={{ padding: '8px 14px' }}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 8px', borderRadius: 999, fontSize: '0.68rem', fontWeight: 800, letterSpacing: 0.2,
                                  background: r.status === 'created' ? '#DCFCE7' : r.status === 'skipped' ? '#FEF3C7' : '#FEE2E2',
                                  color: r.status === 'created' ? '#166534' : r.status === 'skipped' ? '#92400E' : '#991B1B' }}>
                                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: r.status === 'created' ? '#16A34A' : r.status === 'skipped' ? '#F59E0B' : '#DC2626' }} />
                                  {r.status === 'created' ? `Created${r.plan ? ` · ${r.plan}` : ''}` : r.status}
                                </span>
                                {r.reason && <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem', marginTop: 3, lineHeight: 1.3 }}>{r.reason}</div>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: '16px 28px 24px', borderTop: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, background: 'white' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{importFile ? `${Math.max(1, Math.round(importFile.size/1024)).toLocaleString()} KB • Ready to import` : 'No file chosen'}</span>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setShowImport(false)} style={{ padding: '10px 18px', borderRadius: 999, border: '1px solid #E2E8F0', background: 'white', fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer' }}>Cancel</button>
                <button onClick={handleImport} disabled={importing || !importFile || importProgress?.status === 'running'} style={{ padding: '10px 20px', borderRadius: 999, border: 'none', background: importing || !importFile ? '#E2E8F0' : '#F15925', color: importing || !importFile ? '#94A3B8' : 'white', fontWeight: 800, fontSize: '0.82rem', cursor: importing || !importFile ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, boxShadow: importing || !importFile ? 'none' : '0 4px 12px rgba(241,89,37,0.25)' }}>
                  {importing ? (
                    <><span style={{ width: 14, height: 14, border: '2px solid #94A3B8', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />Importing…</>
                  ) : (
                    <><svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Import file</>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showPurge && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setShowPurge(false)}>
          <div style={{ background: 'white', borderRadius: 20, padding: 28, width: 440, maxWidth: '92vw', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 12, color: '#DC2626' }}>Purge all customers?</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 16 }}>
              This <b>permanently deletes every customer</b> — their accounts, subscriptions, invoices, payments, receipts, quotations, tickets, chats and plans. Staff users are kept. This cannot be undone.
            </p>
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Type <b>PURGE</b> to confirm
            </label>
            <input
              value={purgeConfirmText}
              onChange={e => setPurgeConfirmText(e.target.value)}
              placeholder="PURGE"
              style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border-color)', borderRadius: 12, fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 20 }}>
              <button className="btn-outline" onClick={() => setShowPurge(false)}>Cancel</button>
              <button
                className="btn-primary"
                style={{ backgroundColor: '#DC2626' }}
                disabled={purging || purgeConfirmText.trim() !== 'PURGE'}
                onClick={handlePurge}
              >
                {purging ? 'Purging…' : 'Purge Customers'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteOpen && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setDeleteOpen(false)}>
          <div style={{ background: 'white', borderRadius: 20, padding: 28, width: 440, maxWidth: '92vw', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 12, color: '#DC2626' }}>Delete selected customers?</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 20 }}>
              This removes <b>{selectedKeys.size} selected row{selectedKeys.size === 1 ? '' : 's'}</b> from the table. Customers are deleted together with their subscriptions, invoices, payments, receipts, tickets and chats; cached router rows are cleared from the database. Staff accounts are not affected. This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button className="btn-outline" onClick={() => setDeleteOpen(false)}>Cancel</button>
              <button className="btn-primary" style={{ backgroundColor: '#DC2626' }} disabled={deleting} onClick={handleDeleteSelected}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
