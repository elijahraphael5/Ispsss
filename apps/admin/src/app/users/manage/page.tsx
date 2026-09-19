'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
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

const PAGE_SIZE = 30;

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
  secondaryPhone?: string | null;
  address: string | null;
  status: string | null;
  networkType: string | null;
  staticIpAddress?: string | null;
  stationLabel?: string | null;
  legacyId?: string | null;
  id2?: string | null;
  hikonnectId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  plan: string | null;
  dueAt: string | null;
  dueAmountKobo: number | null;
  dueStatus: string | null;
  cpes: { id: string; name: string | null; ipAddress: string | null; status: string; connectionType: string; installerName: string | null; needsMacAddress?: boolean; ipConflict?: boolean }[];
  pppoeUsername?: string | null;
}

type Row = RosSubscriber & { _type: 'PPPOE' } | StaticConn & { _type: 'STATIC_IP' };

function badge(label: string, color: string) {
  return <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600, backgroundColor: color + '18', color }}>{label}</span>;
}

function planFee(plans: any[], planId: string, networkType: string, installFees?: { fiber: number; radio: number }): string {
  // Installation is one-off, not part of plan — use Settings Installation tab (Fiber/Radio)
  // planFee is kept for backwards compat but ignored per user request
  const fiberNaira = installFees ? String(Math.round(installFees.fiber / 100)) : '50000';
  const radioNaira = installFees ? String(Math.round(installFees.radio / 100)) : '120000';
  return networkType === 'FIBER' ? fiberNaira : radioNaira;
}

function cell(pad = '7px 12px') {
  return { padding: pad, fontSize: '0.78rem' as const };
}

const lbl = { display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 } as const;
const inp = { width: '100%', padding: '8px 12px', borderRadius: 12, border: '1px solid var(--border-color)', fontSize: '0.85rem', boxSizing: 'border-box' as const };

function FieldWrap({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div style={{ position: 'relative', minWidth: 0, width: '100%' }}>
      {icon && <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8', display: 'flex', pointerEvents: 'none', zIndex: 1 }}>{icon}</span>}
      {children}
    </div>
  );
}

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
  const [installFees, setInstallFees] = useState<{ fiber: number; radio: number }>({ fiber: 5000000, radio: 12000000 });
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
  const [showExport, setShowExport] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const lastFocusLoadRef = useRef(0);
  const [createForm, setCreateForm] = useState({
    // 16 sheet columns mapped
    legacyId: '', id2: '',
    firstName: '', lastName: '', companyName: '',
    name: '', email: '', phone: '', secondaryPhone: '', stationLabel: '', address: '',
    planId: '', networkType: 'FIBER', pppoeUsername: '', ipAddress: '',
    startDate: '', expiry: '', fee: '50000', portalPassword: '', radiusPassword: '', sendWelcome: false, includeInstallation: true,
  });
  const [legacyLoading, setLegacyLoading] = useState(false);

  // Real-time HIF/HIR preview — fills the disabled Legacy ID field as soon as the drawer opens or network type changes
  useEffect(() => {
    if (!showCreate) return;
    let cancelled = false;
    setLegacyLoading(true);
    api<{ legacyId: string }>(`/subscriptions/next-legacy-id?networkType=${encodeURIComponent(createForm.networkType)}`)
      .then(res => { if (!cancelled && res?.legacyId) setCreateForm(f => ({ ...f, legacyId: res.legacyId })); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLegacyLoading(false); });
    return () => { cancelled = true; };
  }, [showCreate, createForm.networkType]);

  async function handleCreateCustomer() {
    const f = createForm;
    // Name can be derived from FIRST/LAST/COMPANY if name field is blank — matches sheet logic
    const derivedName = f.name.trim() || [f.firstName.trim(), f.lastName.trim()].filter(Boolean).join(' ') || f.companyName.trim() || f.legacyId.trim() || f.email.trim().split('@')[0];
    if (!derivedName || !f.email.trim()) { setCreateError('Name (or First/Last/Company) and email are required'); return; }
    // USER TYPE from sheet: RADIO, FIBER HOTSPOT, FIBER PPPOE — map admin UI values accordingly
    const rawUserType = f.networkType === 'FIBER HOTSPOT' || f.networkType === 'FIBER PPPOE' ? f.networkType : f.networkType === 'PPPOE' || f.networkType === 'STATIC_IP' ? undefined : f.networkType;
    setCreating(true);
    setCreateError('');
    setCreateSuccess('');
    try {
      const password = f.portalPassword || Math.random().toString(36).slice(2, 10);
      const user = await api<{ id: string }>('/users', {
        method: 'POST',
        body: JSON.stringify({
          email: f.email.trim().toLowerCase(),
          password,
          name: derivedName,
          phone: f.phone.trim() || undefined,
          secondaryPhone: f.secondaryPhone.trim() || undefined,
        }),
      });
      const sub = await api<{ id: string }>('/subscriptions', {
        method: 'POST',
        body: JSON.stringify({
          userId: user.id,
          type: 'RESIDENTIAL',
          address: f.address.trim() || undefined,
          pppoeUsername: f.pppoeUsername.trim() || undefined,
          networkType: rawUserType,
          // 16 sheet columns — full import alignment for manual creation
          legacyId: f.legacyId.trim() || undefined,
          id2: f.id2.trim() || undefined,
          firstName: f.firstName.trim() || undefined,
          lastName: f.lastName.trim() || undefined,
          companyName: f.companyName.trim() || undefined,
          stationLabel: f.stationLabel.trim() || undefined,
          staticIpAddress: f.ipAddress.trim() || undefined,
        }),
      });
      if (f.planId) {
        await api(`/subscriptions/${sub.id}/subscriptions`, {
          method: 'POST',
          body: JSON.stringify({
            planId: f.planId,
            autoRenew: true,
            ...(f.startDate ? { startedAt: new Date(f.startDate).toISOString() } : {}),
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
      setCreateForm({ legacyId: '', id2: '', firstName: '', lastName: '', companyName: '', name: '', email: '', phone: '', secondaryPhone: '', stationLabel: '', address: '', planId: '', networkType: 'FIBER', pppoeUsername: '', ipAddress: '', startDate: '', expiry: '', fee: '50000', portalPassword: '', radiusPassword: '', sendWelcome: false, includeInstallation: true });
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

  async function handleExport(format: 'csv' | 'xlsx' | 'pdf') {
    setShowExport(false);
    // Export the customers currently in view — respects search / plan / status filters
    const idsInView = new Set(filteredRows.map(r => matchCustomer(r)?.id).filter(Boolean) as string[]);
    const toExport = (search || filter !== 'All' || planFilter !== 'All') && idsInView.size ? customers.filter(c => idsInView.has(c.id)) : customers;
    if (!toExport.length) { setError('No customers to export'); return; }
    const headers = ['ID','ID2','First Name','Last Name','Company','Full Name','Email','Phone','Secondary Phone','Address','Station','User Type','Plan','PPPoE Username','IP Address','Status','Due Date'];
    const rows = toExport.map(c => [
      c.legacyId || '',
      c.id2 || '',
      c.firstName || '',
      c.lastName || '',
      c.companyName || '',
      c.name || '',
      c.email || '',
      c.phone || '',
      c.secondaryPhone || '',
      c.address || '',
      c.stationLabel || '',
      c.networkType || '',
      c.plan || '',
      c.pppoeUsername || '',
      c.staticIpAddress || (c.cpes?.[0]?.ipAddress || ''),
      c.status || '',
      c.dueAt ? new Date(c.dueAt).toLocaleDateString('en-GB') : '',
    ]);
    const fileBase = `customers-${new Date().toISOString().slice(0,10)}`;
    try {
      if (format === 'csv') {
        const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
        const csv = [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `${fileBase}.csv`; a.click(); URL.revokeObjectURL(url);
        setCreateSuccess(`Exported ${toExport.length} customers as CSV`);
      } else if (format === 'xlsx') {
        const XLSX = await import('xlsx');
        const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
        // auto width
        const colWidths = headers.map((h, i) => ({ wch: Math.max(h.length, ...rows.map(r => String(r[i] ?? '').length).slice(0, 200)) + 2 }));
        (ws as any)['!cols'] = colWidths;
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Customers');
        XLSX.writeFile(wb, `${fileBase}.xlsx`);
        setCreateSuccess(`Exported ${toExport.length} customers as XLSX`);
      } else {
        const { default: jsPDF } = await import('jspdf');
        const autoTable = (await import('jspdf-autotable')).default;
        const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
        const title = `Customers — ${toExport.length} records • ${new Date().toLocaleString()}`;
        doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.text(title, 24, 24);
        doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor('#64748B');
        doc.text('Hikonnect ISP Platform • single light container • no gradients on tables', 24, 36);
        (autoTable as any)(doc, {
          startY: 48,
          head: [headers.map(h => h.toUpperCase())],
          body: rows,
          theme: 'grid',
          headStyles: { fillColor: [248, 250, 252], textColor: [51, 65, 85], fontSize: 6, fontStyle: 'bold', lineColor: [226, 232, 240] },
          bodyStyles: { fontSize: 6, cellPadding: 4, textColor: [15, 23, 42] },
          alternateRowStyles: { fillColor: [248, 250, 252] },
          columnStyles: { 5: { cellWidth: 80 }, 9: { cellWidth: 90 }, 13: { cellWidth: 60 }, 14: { cellWidth: 60 } },
          margin: { left: 24, right: 24 },
          didDrawPage: (data: any) => {
            doc.setFontSize(6); doc.setTextColor('#94A3B8');
            doc.text(`Page ${data.pageNumber}`, doc.internal.pageSize.getWidth() - 40, doc.internal.pageSize.getHeight() - 12);
          },
        });
        doc.save(`${fileBase}.pdf`);
        setCreateSuccess(`Exported ${toExport.length} customers as PDF`);
      }
    } catch (e: any) {
      setError(e?.message ?? `Export ${format} failed`);
    }
  }

  // close export menu on outside click / esc
  useEffect(() => {
    if (!showExport) return;
    const onDoc = (e: MouseEvent) => { if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) setShowExport(false); };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowExport(false); };
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onEsc); };
  }, [showExport]);

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
    let lastError = '';
    for (const key of Array.from(selectedKeys)) {
      try {
        if (key.startsWith('sub:')) {
          await api(`/subscriptions/${key.slice(4)}`, { method: 'DELETE' });
        } else if (key.startsWith('snap:')) {
          await api(`/routeros/snapshots/${key.slice(5)}`, { method: 'DELETE' });
        }
        done++;
      } catch (e: any) {
        failed++;
        lastError = e?.message ?? 'Delete failed';
      }
    }
    setSelectedKeys(new Set());
    setDeleteOpen(false);
    if (failed) {
      setError(lastError || `${done} deleted, ${failed} failed — ${lastError}`);
      setCreateSuccess(`${done} deleted, ${failed} failed — ${lastError || 'refresh and retry'}`);
    } else {
      setCreateSuccess(`${done} customer${done === 1 ? '' : 's'} deleted.`);
    }
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
    const onFocus = () => {
      const now = Date.now();
      if (now - lastFocusLoadRef.current < 15000) return;
      lastFocusLoadRef.current = now;
      load(true);
    };
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
      void api<Customer[]>('/users/customers?take=1000').then(setCustomers).catch(() => {});
      void api<any[]>('/subscriptions/plans').then(setPlans).catch(() => {});
      void api<any>('/tenant/settings').then(t => {
        if (t?.installation) setInstallFees({ fiber: t.installation.fiberFeeKobo ?? 5000000, radio: t.installation.radioFeeKobo ?? 12000000 });
      }).catch(() => {});
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
      <div className="page-title-row" style={{ alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <div style={{ width: 44, height: 44, borderRadius: 14, background: 'linear-gradient(135deg, #F15925 0%, #EA580C 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', boxShadow: '0 4px 12px rgba(241,89,37,0.25)', flexShrink: 0 }}>
            <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </div>
          <div>
            <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>Customers <span style={{ fontSize: '0.7rem', fontWeight: 800, padding: '3px 8px', borderRadius: 20, background: '#F1F5F9', color: 'var(--text-muted)', border: '1px solid var(--border-color)' }}>{allRows.length}</span></h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.84rem', marginTop: 3, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span>{filteredRows.length} of {allRows.length} shown</span>
              <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#CBD5E1' }} />
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#16A34A' }} />{allRows.filter(r => r._type === 'PPPOE' && (r.isOnline || r.active)).length} PPPoE</span>
              <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#CBD5E1' }} />
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#F15925' }} />{allRows.filter(r => r._type === 'STATIC_IP' && matchCustomer(r)?.status === 'ACTIVE').length} Static</span>
              {cached && <span style={{ fontSize: '0.66rem', fontWeight: 700, padding: '2px 8px', borderRadius: 10, backgroundColor: '#FEF3C7', color: '#92400E', border: '1px solid #FDE68A' }}>cached · {timeAgo(subscribers[0]?.capturedAt)}</span>}
              {staleDevice && <span title={`Last seen ${staleDevice.lastSeenAt}`} style={{ fontSize: '0.66rem', fontWeight: 700, padding: '2px 8px', borderRadius: 10, backgroundColor: '#FEE2E2', color: '#991B1B', border: '1px solid #FECACA' }}>stale · {timeAgo(staleDevice.lastSeenAt)}</span>}
            </p>
          </div>
        </div>
        <button className="btn-primary" onClick={() => { setCreateError(''); setShowCreate(true); }} style={{ boxShadow: '0 4px 12px rgba(241,89,37,0.2)', padding: '10px 18px' }}>
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Customer
        </button>
      </div>

      <div className="data-card" style={{ marginBottom: 16, overflow: 'visible', borderTop: '3px solid #F15925', borderRadius: 16, background: '#FFFFFF', boxShadow: '0 1px 3px rgba(15,23,42,0.04), 0 4px 12px rgba(15,23,42,0.04)' }}>
        <div style={{ padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: '#FFFFFF', borderRadius: '16px 16px 0 0', borderBottom: '1px solid #F1F5F9', overflow: 'visible' }}>
          <div className="badge-tabs" style={{ background: '#F1F5F9', padding: 3, borderRadius: 999, gap: 2, boxShadow: 'inset 0 1px 2px rgba(15,23,42,0.03)', border: '1px solid #E2E8F0' }}>
            {(['All', 'Active', 'Non Active'] as const).map(f => (
              <button key={f} onClick={() => { setFilter(f); setPage(0); }}
                className={`tab-item${filter === f ? ' active' : ''}`}
                style={{ border: 'none', cursor: 'pointer', font: 'inherit', fontWeight: 700, transition: 'all 0.15s', padding: '6px 14px', borderRadius: 999, fontSize: '0.78rem' }}>
                {f}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <button onClick={() => load()} disabled={loading}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 999, border: '1px solid #E2E8F0', background: loading ? '#F1F5F9' : '#FFFFFF', color: '#334155', fontSize: '0.78rem', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', boxShadow: '0 1px 2px rgba(15,23,42,0.04)', transition: 'all 0.15s', opacity: loading ? 0.7 : 1 }}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ animation: loading ? 'spin 0.8s linear infinite' : 'none' }}><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
              Refresh
            </button>
            <button onClick={() => { setImportResult(null); setImportError(''); setImportFile(null); setShowImport(true); }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 999, border: '1px solid #E2E8F0', background: '#FFFFFF', color: '#334155', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', boxShadow: '0 1px 2px rgba(15,23,42,0.04)', transition: 'all 0.15s' }}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Import
            </button>
            <div style={{ position: 'relative' }} ref={exportMenuRef}>
              <button onClick={() => setShowExport(v => !v)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 999, border: '1px solid #E2E8F0', background: showExport ? '#F1F5F9' : '#FFFFFF', color: '#334155', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', boxShadow: '0 1px 2px rgba(15,23,42,0.04)', transition: 'all 0.15s' }}>
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Export
                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ transform: showExport ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              {showExport && (
                <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 30, background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 14, boxShadow: '0 12px 32px rgba(15,23,42,0.12)', padding: 6, minWidth: 220, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: '0.68rem', fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: '#94A3B8', padding: '6px 10px 2px' }}>Export {customers.length ? `${customers.length} customers` : 'customers'} • single light</div>
                  <button onClick={() => handleExport('csv')} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: '1px solid #E2E8F0', background: '#FFFFFF', cursor: 'pointer', textAlign: 'left', width: '100%', transition: 'all 0.12s' }}>
                    <span style={{ width: 32, height: 32, borderRadius: 10, background: '#F0FDF4', border: '1px solid #BBF7D0', color: '#16A34A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.7rem' }}>CSV</span>
                    <span style={{ flex: 1 }}><span style={{ display: 'block', fontWeight: 700, fontSize: '0.82rem', color: '#0F172A' }}>CSV</span><span style={{ display: 'block', fontSize: '0.68rem', color: '#94A3B8' }}>Comma-separated • Excel/Sheets</span></span>
                    <span style={{ color: '#94A3B8' }}>→</span>
                  </button>
                  <button onClick={() => handleExport('xlsx')} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: '1px solid #E2E8F0', background: '#FFFFFF', cursor: 'pointer', textAlign: 'left', width: '100%', transition: 'all 0.12s' }}>
                    <span style={{ width: 32, height: 32, borderRadius: 10, background: '#EFF6FF', border: '1px solid #BFDBFE', color: '#2563EB', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.7rem' }}>XLS</span>
                    <span style={{ flex: 1 }}><span style={{ display: 'block', fontWeight: 700, fontSize: '0.82rem', color: '#0F172A' }}>Excel (XLSX)</span><span style={{ display: 'block', fontSize: '0.68rem', color: '#94A3B8' }}>Native workbook • 17 columns</span></span>
                    <span style={{ color: '#94A3B8' }}>→</span>
                  </button>
                  <button onClick={() => handleExport('pdf')} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, border: '1px solid #E2E8F0', background: '#FFFFFF', cursor: 'pointer', textAlign: 'left', width: '100%', transition: 'all 0.12s' }}>
                    <span style={{ width: 32, height: 32, borderRadius: 10, background: '#FEF2F2', border: '1px solid #FECACA', color: '#DC2626', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.7rem' }}>PDF</span>
                    <span style={{ flex: 1 }}><span style={{ display: 'block', fontWeight: 700, fontSize: '0.82rem', color: '#0F172A' }}>PDF</span><span style={{ display: 'block', fontSize: '0.68rem', color: '#94A3B8' }}>A4 landscape • printable</span></span>
                    <span style={{ color: '#94A3B8' }}>→</span>
                  </button>
                  <div style={{ fontSize: '0.68rem', color: '#94A3B8', padding: '6px 10px', lineHeight: 1.4, background: '#F8FAFC', borderRadius: 10, border: '1px solid #F1F5F9' }}>Respects search & filter. All fields exported: ID, ID2, names, email, phones, address, station, type, plan, PPPoE, IP, status, due date.</div>
                </div>
              )}
            </div>
            <button onClick={() => { setPurgeConfirmText(''); setShowPurge(true); }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 999, border: '1px solid #FECACA', background: '#FFFBFB', color: '#DC2626', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', boxShadow: '0 1px 2px rgba(220,38,38,0.06)', transition: 'all 0.15s' }}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              Purge
            </button>
            <button onClick={() => setDeleteOpen(true)} disabled={selectedKeys.size === 0}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 999, border: '1px solid transparent', background: selectedKeys.size ? '#DC2626' : '#F1F5F9', color: selectedKeys.size ? '#fff' : '#94A3B8', fontSize: '0.78rem', fontWeight: 600, cursor: selectedKeys.size ? 'pointer' : 'not-allowed', opacity: selectedKeys.size ? 1 : 1, boxShadow: selectedKeys.size ? '0 2px 8px rgba(220,38,38,0.18)' : 'none', transition: 'all 0.15s' }}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              Delete{selectedKeys.size ? ` (${selectedKeys.size})` : ''}
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, padding: '12px 14px', flexWrap: 'wrap', alignItems: 'center', background: '#F8FAFC', borderTop: '1px solid #F1F5F9', borderRadius: '0 0 16px 16px' }}>
          <div className="search-box" style={{ flex: '1 1 280px', width: 'auto', background: '#FFFFFF', borderColor: '#E2E8F0', borderRadius: 999, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 1px 2px rgba(15,23,42,0.04)', transition: 'all 0.15s', minHeight: 36, boxSizing: 'border-box' }}>
            <svg width="14" height="14" fill="none" stroke="#94A3B8" strokeWidth="2" viewBox="0 0 24 24" style={{ flexShrink: 0 }}><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); }}
              placeholder="Search name, email, phone, username, address…"
              style={{ background: 'transparent', border: 'none', outline: 'none', fontSize: '0.82rem', width: '100%', color: '#0F172A' }}
            />
            {search && <button onClick={() => setSearch('')} style={{ border: 'none', background: '#F1F5F9', width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#64748B', flexShrink: 0, transition: 'all 0.12s' }}><svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>}
          </div>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <select
              value={planFilter}
              onChange={e => { setPlanFilter(e.target.value); }}
              style={{ padding: '8px 32px 8px 14px', borderRadius: 999, border: '1px solid #E2E8F0', fontSize: '0.78rem', cursor: 'pointer', background: '#FFFFFF', color: '#334155', fontWeight: 600, appearance: 'none', WebkitAppearance: 'none', boxShadow: '0 1px 2px rgba(15,23,42,0.04)', minHeight: 36, lineHeight: 1.2 }}
            >
              <option value="All">All plans</option>
              {filtered.planOptions.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <svg width="14" height="14" fill="none" stroke="#94A3B8" strokeWidth="2" viewBox="0 0 24 24" style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}><polyline points="6 9 12 15 18 9"/></svg>
          </div>
          {(search || filter !== 'All' || planFilter !== 'All') && <span style={{ fontSize: '0.72rem', color: '#64748B', fontWeight: 600, background: '#FFFFFF', border: '1px solid #E2E8F0', padding: '6px 10px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 6, height: 6, borderRadius: 999, background: '#F59E0B' }} />{filteredRows.length} matches</span>}
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
        <div className="data-card" style={{ padding: 48, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 64, height: 64, borderRadius: 20, background: '#F8FAFC', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
            <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>{search || filter !== 'All' || planFilter !== 'All' ? 'No matches found' : 'No customers yet'}</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 4 }}>{search || filter !== 'All' || planFilter !== 'All' ? 'Try adjusting your search or filters' : 'Import your customer list or add a new customer to get started'}</div>
          </div>
          {(search || filter !== 'All' || planFilter !== 'All') && <button className="btn-sm-outline" onClick={() => { setSearch(''); setFilter('All'); setPlanFilter('All'); }}>Clear filters</button>}
        </div>
      ) : (
        <>
          <div className="data-card customer-desktop-table" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="h-scroll customer-table-scroll" style={{ overflow: 'auto', maxHeight: 'calc(100vh - 300px)', minHeight: 420 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-color)', position: 'sticky', top: 0, background: '#F8FAFC', zIndex: 1 }}>
                    <th style={{ ...cell('12px 14px'), width: 44, background: '#F8FAFC' }}>
                      <input type="checkbox" checked={selectableKeys.size > 0 && [...selectableKeys].every(k => selectedKeys.has(k))} onChange={togglePage} title="Select all on this page" style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--primary)' }} />
                    </th>
                    <th style={{ ...cell('12px 14px'), background: '#F8FAFC', fontSize: '0.66rem', letterSpacing: 0.6 }}>Customer</th>
                    <th style={{ ...cell('12px 14px'), background: '#F8FAFC', fontSize: '0.66rem', letterSpacing: 0.6 }}>Contact</th>
                    <th style={{ ...cell('12px 14px'), background: '#F8FAFC', fontSize: '0.66rem', letterSpacing: 0.6 }}>Location</th>
                    <th style={{ ...cell('12px 14px'), background: '#F8FAFC', fontSize: '0.66rem', letterSpacing: 0.6 }}>Network</th>
                    <th style={{ ...cell('12px 14px'), background: '#F8FAFC', fontSize: '0.66rem', letterSpacing: 0.6 }}>Plan</th>
                    <th style={{ ...cell('12px 14px'), background: '#F8FAFC', fontSize: '0.66rem', letterSpacing: 0.6 }}>Speed</th>
                    <th style={{ ...cell('12px 14px'), background: '#F8FAFC', fontSize: '0.66rem', letterSpacing: 0.6 }}>Due</th>
                    <th style={{ ...cell('12px 14px'), background: '#F8FAFC', fontSize: '0.66rem', letterSpacing: 0.6 }}>Status</th>
                    <th style={{ ...cell('12px 14px'), background: '#F8FAFC', fontSize: '0.66rem', letterSpacing: 0.6 }}>ID</th>
                    <th style={{ ...cell('12px 14px'), background: '#F8FAFC', width: 44 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((row, idx) => {
                    const cust = matchCustomer(row);
                    const isPppoe = row._type === 'PPPOE';
                    const s = isPppoe ? (row as RosSubscriber & { _type: 'PPPOE' }) : null;
                    const c = !isPppoe ? (row as StaticConn & { _type: 'STATIC_IP' }) : null;
                    const name = isPppoe ? (cust?.name || s?.name || s?.customer || '—') : (cust?.name || c?.subscriberName || '—');
                    const email = isPppoe ? (cust?.email || s?.email || '—') : (cust?.email || '—');
                    const phone = isPppoe ? (cust?.phone || s?.phone || '—') : (cust?.phone || '—');
                    const address = isPppoe ? (cust?.address || s?.address || '—') : (cust?.address || '—');
                    const plan = isPppoe ? (s?.plan || cust?.plan || '—') : (cust?.plan || '—');
                    const network = cust?.networkType || (isPppoe ? 'PPPoE' : 'Static IP');
                    const due = cust?.dueAt ? new Date(cust.dueAt).toLocaleDateString('en-GB') : '—';
                    const status = isPppoe ? (s?.dbOnly ? (cust?.status || '—') : s?.cached ? (s?.isOnline ? 'Active' : 'Offline') : (s?.active ? 'Active' : 'Disabled')) : (c?.status === 'ACTIVE' || c?.status === 'ONLINE' ? 'Active' : 'Offline');
                    const statusColor = status === 'Active' ? '#16A34A' : status === 'Offline' ? '#EA580C' : '#94A3B8';
                    const uid = isPppoe ? s?.username || '' : c?.ipAddress || c?.id.slice(0,8) || '';
                    const initials = name !== '—' ? name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase() : '—';
                    const avatarBg = `hsl(${(name.charCodeAt(0) || 65) * 13 % 360} 72% 92%)`;
                    const avatarFg = `hsl(${(name.charCodeAt(0) || 65) * 13 % 360} 55% 28%)`;
                    return (
                      <tr key={isPppoe ? s!.id : c!.id} onClick={() => openRow(row)} className="customer-row" style={{ borderBottom: '1px solid #F1F5F9', cursor: 'pointer', animationDelay: `${idx * 18}ms` }}>
                        <td style={cell('14px 12px')} onClick={e => e.stopPropagation()}>
                          <input type="checkbox" disabled={!rowKey(row)} checked={!!(rowKey(row) && selectedKeys.has(rowKey(row)!))} onChange={() => { const k = rowKey(row); if (k) toggleRow(k); }} title={rowKey(row) ? 'Select' : 'No DB record'} style={{ width: 16, height: 16, cursor: rowKey(row) ? 'pointer' : 'not-allowed', accentColor: 'var(--primary)' }} />
                        </td>
                        <td style={{ ...cell('14px 12px'), minWidth: 180 }}>
                          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                            <div className="customer-avatar" style={{ background: avatarBg, color: avatarFg }}>{initials}</div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 800, fontSize: '0.84rem', color: 'var(--text-dark)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}>{name}</div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}>{email !== '—' ? email : phone !== '—' ? phone : uid}</div>
                            </div>
                          </div>
                        </td>
                        <td style={cell('14px 12px')}>
                          <div style={{ fontSize: '0.82rem', fontWeight: 700, whiteSpace: 'nowrap' }}>{phone}</div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{isPppoe ? s?.username?.slice(0,14) : c?.ipAddress || ''}</div>
                        </td>
                        <td style={{ ...cell('14px 12px'), maxWidth: 170, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={address}>{address}</td>
                        <td style={cell('14px 12px')}>{badge(network, network.includes('Static') ? '#F15925' : network === 'PPPoE' ? '#2563EB' : '#7C3AED')}</td>
                        <td style={cell('14px 12px')}>{badge(plan, '#6366F1')}</td>
                        <td style={cell('14px 12px')}>{speedBadge(row)}</td>
                        <td style={{ ...cell('14px 12px'), fontSize: '0.78rem', color: due==='—' ? 'var(--text-muted)' : 'var(--text-dark)', whiteSpace: 'nowrap', fontWeight: due==='—'?400:600 }}>{due}</td>
                        <td style={cell('14px 12px')}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 20, fontSize: '0.68rem', fontWeight: 800, background: status==='Active' ? '#e6f9ed' : status==='Offline' ? '#FFF7ED' : '#F1F5F9', color: statusColor, border: `1px solid ${status==='Active' ? '#BBF7D0' : status==='Offline' ? '#FDBA74' : '#E2E8F0'}` }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor, boxShadow: status==='Active' ? `0 0 6px ${statusColor}60` : 'none' }} />{status}
                          </span>
                        </td>
                        <td style={{ ...cell('14px 12px'), fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.68rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{uid.slice(0,12)}</td>
                        <td style={cell('14px 12px')}>
                          <span style={{ width: 28, height: 28, borderRadius: 10, background: '#F8FAFC', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)', transition: 'all 0.15s' }}>→</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div className="customer-mobile-list">
            {paged.map(row => {
              const cust = matchCustomer(row);
              const isPppoe = row._type === 'PPPOE';
              const s = isPppoe ? (row as RosSubscriber & { _type: 'PPPOE' }) : null;
              const c = !isPppoe ? (row as StaticConn & { _type: 'STATIC_IP' }) : null;
              const name = isPppoe ? (cust?.name || s?.name || s?.customer || 'Unknown') : (cust?.name || c?.subscriberName || 'Unknown');
              const email = isPppoe ? (cust?.email || s?.email || '') : (cust?.email || '');
              const phone = isPppoe ? (cust?.phone || s?.phone || '') : (cust?.phone || '');
              const address = isPppoe ? (cust?.address || s?.address || '') : (cust?.address || '');
              const plan = isPppoe ? (s?.plan || cust?.plan || '—') : (cust?.plan || '—');
              const network = cust?.networkType || (isPppoe ? 'PPPoE' : 'Static IP');
              const status = isPppoe ? (s?.dbOnly ? (cust?.status || '—') : s?.cached ? (s?.isOnline ? 'Active' : 'Offline') : (s?.active ? 'Active' : 'Disabled')) : (c?.status === 'ACTIVE' || c?.status === 'ONLINE' ? 'Active' : 'Offline');
              const uid = isPppoe ? s?.username || '' : c?.ipAddress || c?.id.slice(0,8) || '';
              const initials = name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
              const avatarBg = `hsl(${(name.charCodeAt(0) || 65) * 13 % 360} 72% 92%)`;
              const avatarFg = `hsl(${(name.charCodeAt(0) || 65) * 13 % 360} 55% 28%)`;
              return (
                <div key={isPppoe ? s!.id : c!.id} className="customer-card" onClick={() => openRow(row)}>
                  <div className="customer-card-header">
                    <div className="customer-avatar" style={{ background: avatarBg, color: avatarFg }}>{initials}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: '0.92rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
                      <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{email || phone || uid || '—'}</div>
                    </div>
                    <span style={{ padding: '4px 10px', borderRadius: 20, fontSize: '0.66rem', fontWeight: 800, background: status==='Active' ? '#e6f9ed' : status==='Offline' ? '#FFF7ED' : '#F1F5F9', color: status==='Active' ? '#16A34A' : status==='Offline' ? '#EA580C' : '#64748B', border: `1px solid ${status==='Active' ? '#BBF7D0' : status==='Offline' ? '#FDBA74' : '#E2E8F0'}` }}>{status}</span>
                  </div>
                  <div className="customer-card-meta">
                    <div><div className="customer-card-meta-label">Phone</div><div style={{ fontWeight: 700, fontSize: '0.82rem' }}>{phone || '—'}</div></div>
                    <div><div className="customer-card-meta-label">Network</div><div>{badge(network, network.includes('Static') ? '#F15925' : '#2563EB')}</div></div>
                    <div style={{ gridColumn: '1 / -1' }}><div className="customer-card-meta-label">Address</div><div style={{ fontWeight: 500, fontSize: '0.82rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{address || '—'}</div></div>
                    <div><div className="customer-card-meta-label">Plan</div><div>{badge(plan, '#6366F1')}</div></div>
                    <div><div className="customer-card-meta-label">Speed</div><div>{speedBadge(row)}</div></div>
                  </div>
                  <div className="customer-card-footer">
                    <span style={{ fontFamily: 'monospace', fontSize: '0.68rem', color: 'var(--text-muted)' }}>{uid.slice(0,16) || '—'}</span>
                    <span style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: 4 }}>View <span>→</span></span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
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
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.52)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}
          onClick={() => setShowCreate(false)}>
          <style>{`@keyframes slideIn{from{transform:translateX(20px);opacity:0}to{transform:translateX(0);opacity:1}}@keyframes popIn{from{transform:scale(0.96);opacity:0}to{transform:scale(1);opacity:1}}@keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}`}</style>
          <div style={{ background: '#FCFDFF', width: 640, maxWidth: '100vw', height: '100dvh', maxHeight: '100dvh', overflow: 'hidden', boxSizing: 'border-box', boxShadow: '-24px 0 80px rgba(15,23,42,0.18)', display: 'flex', flexDirection: 'column', animation: 'slideIn 0.32s cubic-bezier(0.16,1,0.3,1)' }}
            onClick={e => e.stopPropagation()}>
            {/* ── Header ── */}
            <div style={{ position: 'relative', flexShrink: 0, padding: '22px 28px 18px', background: '#FFFFFF', borderBottom: '1px solid rgba(226,232,240,0.9)', overflow: 'visible', boxSizing: 'border-box' }}>
              {/* soft light blobs — single colour, no gradient */}
              <div style={{ position: 'absolute', top: -40, right: -30, width: 220, height: 220, borderRadius: '50%', background: '#FFF7ED', opacity: 0.6, pointerEvents: 'none' }} />
              <div style={{ position: 'absolute', bottom: -60, left: -20, width: 280, height: 280, borderRadius: '50%', background: '#EFF6FF', opacity: 0.5, pointerEvents: 'none' }} />
              <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flex: 1, minWidth: 0 }}>
                  <div style={{ width: 46, height: 46, borderRadius: 14, background: 'linear-gradient(135deg, #F15925 0%, #EA580C 100%)', boxShadow: '0 8px 20px rgba(241,89,37,0.28), 0 2px 6px rgba(241,89,37,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0 }}>
                    <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" /></svg>
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <h2 style={{ fontSize: '1.28rem', fontWeight: 800, letterSpacing: -0.4, color: '#0F172A', lineHeight: 1.1 }}>New Customer</h2>
                      <span style={{ fontSize: '0.66rem', fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', padding: '3px 8px', borderRadius: 999, background: '#FFF7ED', color: '#EA580C', border: '1px solid #FFEDD5' }}>16 fields · sheet-aligned</span>
                    </div>
                    <p style={{ fontSize: '0.82rem', color: '#64748B', marginTop: 4, lineHeight: 1.45 }}>Add a customer exactly as your import sheet — IDs, contact, location & billing in one smooth flow.</p>
                    {/* stepper */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12 }}>
                      {[
                        { dot: '#F15925', label: 'Identity', done: !!(createForm.name || createForm.firstName || createForm.legacyId) },
                        { dot: '#2563EB', label: 'Contact', done: !!createForm.email },
                        { dot: '#059669', label: 'Location', done: !!(createForm.address || createForm.planId) },
                        { dot: '#7C3AED', label: 'Billing', done: !!(createForm.startDate || createForm.expiry || createForm.includeInstallation) },
                      ].map(s => (
                        <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                          <div style={{ width: 22, height: 22, borderRadius: 999, background: s.done ? s.dot : '#fff', border: `1.5px solid ${s.done ? s.dot : '#E2E8F0'}`, color: s.done ? '#fff' : '#94A3B8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.66rem', fontWeight: 800, transition: 'all 0.2s', boxShadow: s.done ? `0 2px 8px ${s.dot}30` : 'none' }}>
                            {s.done ? '✓' : '·'}
                          </div>
                          <span style={{ fontSize: '0.68rem', fontWeight: 700, color: s.done ? '#0F172A' : '#94A3B8', whiteSpace: 'nowrap' }}>{s.label}</span>
                          {s.label !== 'Billing' && <div style={{ flex: 1, height: 1.5, background: s.done ? '#E2E8F0' : '#F1F5F9', borderRadius: 999, marginLeft: 4 }} />}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <button onClick={() => setShowCreate(false)} style={{ width: 36, height: 36, borderRadius: 12, border: '1px solid rgba(226,232,240,0.9)', background: 'rgba(255,255,255,0.85)', color: '#64748B', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, boxShadow: '0 1px 4px rgba(15,23,42,0.06)', transition: 'all 0.15s' }} onMouseEnter={e => (e.currentTarget.style.background = '#fff')} onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.85)')}>
                  <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>
              {/* live name preview */}
              {(() => {
                const dn = createForm.name.trim() || [createForm.firstName.trim(), createForm.lastName.trim()].filter(Boolean).join(' ') || createForm.companyName.trim() || (createForm.email ? createForm.email.split('@')[0] : '');
                return dn ? (
                  <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.88)', border: '1px solid rgba(241,89,37,0.10)', boxShadow: '0 1px 6px rgba(15,23,42,0.04)', animation: 'popIn 0.22s ease', minWidth: 0 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 999, background: `hsl(${(dn.charCodeAt(0) || 65) * 13 % 360} 78% 92%)`, color: `hsl(${(dn.charCodeAt(0) || 65) * 13 % 360} 45% 32%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.72rem', flexShrink: 0 }}>{dn.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}</div>
                    <div style={{ minWidth: 0, flex: 1, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                      <div style={{ fontSize: '0.78rem', fontWeight: 800, color: '#0F172A', lineHeight: 1.25, wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{dn}</div>
                      <div style={{ fontSize: '0.68rem', color: '#94A3B8', lineHeight: 1.3, wordBreak: 'break-word', overflowWrap: 'anywhere' }}>Will be used as display name • {createForm.legacyId ? createForm.legacyId : createForm.email ? createForm.email : 'preview'}</div>
                    </div>
                    <span style={{ marginLeft: 'auto', fontSize: '0.62rem', fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: '#F15925', background: '#FFF7ED', border: '1px solid #FFEDD5', padding: '3px 7px', borderRadius: 999, whiteSpace: 'nowrap', flexShrink: 0 }}>Auto-saved</span>
                  </div>
                ) : null;
              })()}
            </div>

            {/* ── Body ── */}
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '20px 24px 28px', display: 'flex', flexDirection: 'column', gap: 16, background: '#F8FAFC', boxSizing: 'border-box' }} className="live-scroll">
              <style>{`.grid-2{width:100%;box-sizing:border-box}.grid-2>div{min-width:0;overflow-wrap:anywhere;word-break:break-word}`}</style>
              {(() => {
                const fInp: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '11px 14px', borderRadius: 14, border: '1.5px solid #E2E8F0', background: '#F8FAFC', fontSize: '0.86rem', fontWeight: 500, color: '#0F172A', outline: 'none', transition: 'all 0.15s', boxShadow: 'inset 0 1px 2px rgba(15,23,42,0.02)', minWidth: 0 };
                const fInpIcon: React.CSSProperties = { ...fInp, paddingLeft: 40 };
                const fLbl: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: '0.71rem', fontWeight: 800, letterSpacing: 0.3, color: '#334155', marginBottom: 6, textTransform: 'uppercase' as const, lineHeight: 1.3, wordBreak: 'break-word', overflowWrap: 'anywhere', minWidth: 0 };
                const hint: React.CSSProperties = { fontSize: '0.68rem', color: '#94A3B8', fontWeight: 500, marginTop: 5, lineHeight: 1.35, wordBreak: 'break-word', overflowWrap: 'anywhere' };
                const card: React.CSSProperties = { background: '#fff', border: '1px solid #F1F5F9', borderRadius: 18, padding: 16, boxShadow: '0 1px 3px rgba(15,23,42,0.02), 0 8px 24px rgba(15,23,42,0.04)', position: 'relative', overflow: 'visible', isolation: 'isolate' as any };
                const secHead = (color: string, bg: string, icon: React.ReactNode, title: string, sheet: string) => (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, minWidth: 0, flexWrap: 'wrap' as const }}>
                    <div style={{ width: 34, height: 34, borderRadius: 12, background: bg, color, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 4px 12px ${color}18`, border: `1px solid ${color}14`, flexShrink: 0 }}>{icon}</div>
                    <div style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' as const, wordBreak: 'break-word' as const }}>
                      <div style={{ fontSize: '0.84rem', fontWeight: 800, color: '#0F172A', letterSpacing: -0.2, lineHeight: 1.15 }}>{title}</div>
                      <div style={{ fontSize: '0.68rem', fontWeight: 600, color: '#94A3B8', lineHeight: 1.3, wordBreak: 'break-word' as const, overflowWrap: 'anywhere' as const }}>{sheet}</div>
                    </div>
                    <span style={{ fontSize: '0.62rem', fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', padding: '4px 8px', borderRadius: 999, background: bg, color, border: `1px solid ${color}18`, whiteSpace: 'nowrap', flexShrink: 0 }}>{title.split(' ')[0]}</span>
                  </div>
                );
                return (
                  <>
                    {/* IDs & Names */}
                    <div style={{ ...card, borderLeft: '3px solid #F15925', animation: 'popIn 0.28s ease' }}>
                      <div style={{ position: 'absolute', top: 0, right: 0, width: 120, height: 120, background: '#FFF7ED', opacity: 0.5, pointerEvents: 'none' }} />
                      {secHead('#F15925', '#FFF7ED', <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M8 10h4M8 14h6M16 10h.01M16 14h.01" /></svg>, 'IDs & Names', 'sheet: ID, ID2, FIRST / LAST / COMPANY')}
                      <div className="grid-2" style={{ gap: 12, position: 'relative' }}>
                        <div>
                          <label style={fLbl}><svg width="12" height="12" fill="none" stroke="#F59E0B" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M16 7V5a2 2 0 0 0-2-2H10a2 2 0 0 0-2 2v2" /></svg> Legacy ID <span style={{ fontWeight: 400, textTransform: 'none', color: '#16A34A', letterSpacing: 0, background: '#F0FDF4', border: '1px solid #BBF7D0', padding: '1px 6px', borderRadius: 999 }}>Auto</span></label>
                          <FieldWrap icon={<svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>}>
                            <input value={legacyLoading ? 'Generating…' : createForm.legacyId} disabled style={{ ...fInpIcon, background: '#F8FAFC', color: legacyLoading ? '#94A3B8' : '#0F172A', fontWeight: 700, cursor: 'not-allowed', opacity: legacyLoading ? 0.7 : 1, letterSpacing: 0.3 }} placeholder={legacyLoading ? 'Generating…' : `Auto • ${createForm.networkType?.includes('RADIO') ? 'HIR-' : 'HIF-'}xxxx`} />
                          </FieldWrap>
                          <div style={hint}>Auto-generated <b>{createForm.legacyId || `${createForm.networkType?.includes('RADIO') ? 'HIR-' : 'HIF-'}xxxx`}</b> for {createForm.networkType?.includes('RADIO') ? 'Radio' : 'Fiber'} • filled in real time, unique in DB • used as RADIUS fallback</div>
                        </div>
                        <div>
                          <label style={fLbl}><svg width="12" height="12" fill="none" stroke="#F59E0B" strokeWidth="2" viewBox="0 0 24 24"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" /></svg> ID2</label>
                          <FieldWrap icon={<svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><rect x="9" y="2" width="6" height="4" rx="1" /><path d="M5 8h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /></svg>}>
                            <input value={createForm.id2} onChange={e => setCreateForm({ ...createForm, id2: e.target.value })} style={fInpIcon} placeholder="Secondary ID column" onFocus={e => { e.currentTarget.style.borderColor = '#F59E0B'; e.currentTarget.style.background = '#fff'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(245,158,11,0.12)'; }} onBlur={e => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.background = '#F8FAFC'; e.currentTarget.style.boxShadow = 'inset 0 1px 2px rgba(15,23,42,0.02)'; }} />
                          </FieldWrap>
                          <div style={hint}>Sheet column <b>ID2</b> • optional</div>
                        </div>
                        <div>
                          <label style={fLbl}>First name</label>
                          <input value={createForm.firstName} onChange={e => setCreateForm({ ...createForm, firstName: e.target.value })} style={fInp} placeholder="e.g. Chinedu" onFocus={e => { e.currentTarget.style.borderColor = '#F15925'; e.currentTarget.style.background = '#fff'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(241,89,37,0.12)'; }} onBlur={e => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.background = '#F8FAFC'; e.currentTarget.style.boxShadow = 'inset 0 1px 2px rgba(15,23,42,0.02)'; }} />
                        </div>
                        <div>
                          <label style={fLbl}>Last name</label>
                          <input value={createForm.lastName} onChange={e => setCreateForm({ ...createForm, lastName: e.target.value })} style={fInp} placeholder="e.g. Okafor" onFocus={e => { e.currentTarget.style.borderColor = '#F15925'; e.currentTarget.style.background = '#fff'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(241,89,37,0.12)'; }} onBlur={e => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.background = '#F8FAFC'; e.currentTarget.style.boxShadow = 'inset 0 1px 2px rgba(15,23,42,0.02)'; }} />
                        </div>
                        <div>
                          <label style={fLbl}>Company name</label>
                          <FieldWrap icon={<svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /></svg>}>
                            <input value={createForm.companyName} onChange={e => setCreateForm({ ...createForm, companyName: e.target.value })} style={fInpIcon} placeholder="Business / Estate" onFocus={e => { e.currentTarget.style.borderColor = '#F15925'; e.currentTarget.style.background = '#fff'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(241,89,37,0.12)'; }} onBlur={e => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.background = '#F8FAFC'; e.currentTarget.style.boxShadow = 'inset 0 1px 2px rgba(15,23,42,0.02)'; }} />
                          </FieldWrap>
                        </div>
                        <div>
                          <label style={{ ...fLbl, color: !createForm.name && (createForm.firstName || createForm.lastName) ? '#F15925' : '#334155' }}>Display name <span style={{ color: '#F15925' }}>*</span> {(createForm.firstName || createForm.lastName) && !createForm.name && <span style={{ fontSize: '0.62rem', fontWeight: 700, background: '#FFF7ED', color: '#EA580C', border: '1px solid #FFEDD5', padding: '2px 6px', borderRadius: 999, textTransform: 'none', letterSpacing: 0 }}>auto: {createForm.firstName} {createForm.lastName}</span>}</label>
                          <FieldWrap icon={<svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>}>
                            <input value={createForm.name} onChange={e => setCreateForm({ ...createForm, name: e.target.value })} style={{ ...fInpIcon, borderColor: !createForm.name && (createForm.firstName || createForm.lastName) ? '#FDBA74' : '#E2E8F0', background: !createForm.name && (createForm.firstName || createForm.lastName) ? '#FFF7ED' : '#F8FAFC' }} placeholder="Falls back to FIRST + LAST" onFocus={e => { e.currentTarget.style.borderColor = '#F15925'; e.currentTarget.style.background = '#fff'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(241,89,37,0.12)'; }} onBlur={e => { const auto = !createForm.name && (createForm.firstName || createForm.lastName); e.currentTarget.style.borderColor = auto ? '#FDBA74' : '#E2E8F0'; e.currentTarget.style.background = auto ? '#FFF7ED' : '#F8FAFC'; e.currentTarget.style.boxShadow = 'inset 0 1px 2px rgba(15,23,42,0.02)'; }} />
                          </FieldWrap>
                          <div style={hint}>Leave blank to auto-build from <b>FIRST + LAST</b></div>
                        </div>
                      </div>
                    </div>

                    {/* Contact & Email */}
                    <div style={{ ...card, borderLeft: '3px solid #2563EB', animation: 'popIn 0.32s ease 0.06s both' }}>
                      <div style={{ position: 'absolute', top: 0, right: 0, width: 140, height: 140, background: '#EFF6FF', opacity: 0.5, pointerEvents: 'none' }} />
                      {secHead('#2563EB', '#EFF6FF', <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>, 'Contact & Email', 'sheet: CONTACT NUMBER, EMAIL')}
                      <div className="grid-2" style={{ gap: 12, position: 'relative' }}>
                        <div style={{ gridColumn: '1 / -1' }}>
                          <label style={{ ...fLbl, color: '#2563EB' }}>Email <span style={{ color: '#EF4444' }}>*</span> <span style={{ fontWeight: 400, textTransform: 'none', color: '#94A3B8', letterSpacing: 0 }}>portal login</span></label>
                          <FieldWrap icon={<svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>}>
                            <input value={createForm.email} onChange={e => setCreateForm({ ...createForm, email: e.target.value })} style={{ ...fInpIcon, borderColor: createForm.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(createForm.email) ? '#FCA5A5' : '#E2E8F0' }} placeholder="customer@email.com" onFocus={e => { e.currentTarget.style.borderColor = '#2563EB'; e.currentTarget.style.background = '#fff'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(37,99,235,0.12)'; }} onBlur={e => { e.currentTarget.style.borderColor = createForm.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(createForm.email) ? '#FCA5A5' : '#E2E8F0'; e.currentTarget.style.background = '#F8FAFC'; e.currentTarget.style.boxShadow = 'inset 0 1px 2px rgba(15,23,42,0.02)'; }} />
                          </FieldWrap>
                          <div style={hint}>Used for portal access • lower-cased on save</div>
                        </div>
                        <div>
                          <label style={fLbl}>Primary phone</label>
                          <FieldWrap icon={<svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 5.07 12.81 19.79 19.79 0 0 1 2 4.18 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>}>
                            <input value={createForm.phone} onChange={e => setCreateForm({ ...createForm, phone: e.target.value })} style={fInpIcon} placeholder="080…  (use / for second)" onFocus={e => { e.currentTarget.style.borderColor = '#2563EB'; e.currentTarget.style.background = '#fff'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(37,99,235,0.12)'; }} onBlur={e => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.background = '#F8FAFC'; e.currentTarget.style.boxShadow = 'inset 0 1px 2px rgba(15,23,42,0.02)'; }} />
                          </FieldWrap>
                          <div style={hint}>Sheet: <b>CONTACT NUMBER</b> • slash splits</div>
                        </div>
                        <div>
                          <label style={fLbl}>Secondary phone</label>
                          <FieldWrap icon={<svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 5.07 12.81 19.79 19.79 0 0 1 2 4.18 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /><circle cx="18" cy="7" r="3" fill="currentColor" opacity="0.12" /></svg>}>
                            <input value={createForm.secondaryPhone} onChange={e => setCreateForm({ ...createForm, secondaryPhone: e.target.value })} style={fInpIcon} placeholder="070… (if 2 numbers)" onFocus={e => { e.currentTarget.style.borderColor = '#2563EB'; e.currentTarget.style.background = '#fff'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(37,99,235,0.12)'; }} onBlur={e => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.background = '#F8FAFC'; e.currentTarget.style.boxShadow = 'inset 0 1px 2px rgba(15,23,42,0.02)'; }} />
                          </FieldWrap>
                        </div>
                        <div style={{ gridColumn: '1 / -1' }}>
                          <label style={fLbl}>User type <span style={{ fontWeight: 400, textTransform: 'none', color: '#94A3B8', letterSpacing: 0 }}>sheet: USER TYPE</span></label>
                          <div style={{ position: 'relative' }}>
                            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8', display: 'flex', pointerEvents: 'none' }}><svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg></span>
                            <select value={createForm.networkType} onChange={e => { const nt = e.target.value; setCreateForm(f => ({ ...f, networkType: nt, ...(f.includeInstallation ? { fee: planFee(plans, f.planId, nt, installFees) } : {}) })); }} style={{ ...fInpIcon, appearance: 'none', cursor: 'pointer', fontWeight: 600 }} onFocus={e => { e.currentTarget.style.borderColor = '#2563EB'; e.currentTarget.style.background = '#fff'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(37,99,235,0.12)'; }} onBlur={e => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.background = '#F8FAFC'; e.currentTarget.style.boxShadow = 'inset 0 1px 2px rgba(15,23,42,0.02)'; }}>
                              <option value="FIBER">FIBER  — Fiber</option>
                              <option value="RADIO">RADIO  — AirFiber / Radio</option>
                              <option value="FIBER HOTSPOT">FIBER HOTSPOT</option>
                              <option value="FIBER PPPOE">FIBER PPPOE</option>
                              <option value="PPPOE">PPPoE</option>
                              <option value="STATIC_IP">Static IP</option>
                            </select>
                            <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8', pointerEvents: 'none' }}>▾</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Location & Service */}
                    <div style={{ ...card, borderLeft: '3px solid #059669', animation: 'popIn 0.32s ease 0.12s both' }}>
                      <div style={{ position: 'absolute', top: 0, right: 0, width: 140, height: 140, background: '#ECFDF5', opacity: 0.5, pointerEvents: 'none' }} />
                      {secHead('#059669', '#ECFDF5', <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>, 'Location & Service', 'sheet: STATION, ADDRESS, PLAN, IP')}
                      <div className="grid-2" style={{ gap: 12, position: 'relative' }}>
                        <div>
                          <label style={fLbl}>Station</label>
                          <FieldWrap icon={<svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>}>
                            <input value={createForm.stationLabel} onChange={e => setCreateForm({ ...createForm, stationLabel: e.target.value })} style={fInpIcon} placeholder="HOME / FIBER / ITA-ELEWA…" onFocus={e => { e.currentTarget.style.borderColor = '#059669'; e.currentTarget.style.background = '#fff'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(5,150,105,0.12)'; }} onBlur={e => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.background = '#F8FAFC'; e.currentTarget.style.boxShadow = 'inset 0 1px 2px rgba(15,23,42,0.02)'; }} />
                          </FieldWrap>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                          <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#059669', background: '#ECFDF5', border: '1px solid #A7F3D0', padding: '6px 10px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}><span style={{ width: 6, height: 6, borderRadius: 999, background: '#059669' }} />Coverage-aware</span>
                        </div>
                        <div style={{ gridColumn: '1 / -1' }}>
                          <label style={fLbl}>Address</label>
                          <FieldWrap icon={<svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>}>
                            <input value={createForm.address} onChange={e => setCreateForm({ ...createForm, address: e.target.value })} style={fInpIcon} placeholder="No. 12, Admiralty Way, Lekki…" onFocus={e => { e.currentTarget.style.borderColor = '#059669'; e.currentTarget.style.background = '#fff'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(5,150,105,0.12)'; }} onBlur={e => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.background = '#F8FAFC'; e.currentTarget.style.boxShadow = 'inset 0 1px 2px rgba(15,23,42,0.02)'; }} />
                          </FieldWrap>
                        </div>
                        <div style={{ gridColumn: '1 / -1' }}>
                          <label style={fLbl}>Plan <span style={{ fontWeight: 400, textTransform: 'none', color: '#94A3B8', letterSpacing: 0 }}>sheet: PLAN</span></label>
                          <div style={{ position: 'relative' }}>
                            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8', display: 'flex', pointerEvents: 'none' }}><svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="8" x2="8" y2="8" /><line x1="16" y1="12" x2="8" y2="12" /><line x1="10" y1="16" x2="8" y2="16" /></svg></span>
                            <select value={createForm.planId} onChange={e => { const pid = e.target.value; setCreateForm(f => ({ ...f, planId: pid, ...(f.includeInstallation ? { fee: planFee(plans, pid, f.networkType) } : {}) })); }} style={{ ...fInpIcon, appearance: 'none', cursor: 'pointer', fontWeight: 600 }} onFocus={e => { e.currentTarget.style.borderColor = '#059669'; e.currentTarget.style.background = '#fff'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(5,150,105,0.12)'; }} onBlur={e => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.background = '#F8FAFC'; e.currentTarget.style.boxShadow = 'inset 0 1px 2px rgba(15,23,42,0.02)'; }}>
                              <option value="">— No plan — (assign later)</option>
                              {plans.map((p: any) => <option key={p.id} value={p.id}>{p.name} • {p.technology ?? p.type} {p.speedMbps ? `• ${p.speedMbps} Mbps` : ''}</option>)}
                            </select>
                            <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8', pointerEvents: 'none' }}>▾</span>
                          </div>
                        </div>
                        <div>
                          <label style={fLbl}>PPPoE / RADIUS user <span style={{ fontWeight: 400, textTransform: 'none', color: '#94A3B8', letterSpacing: 0 }}>ID2 fallback</span></label>
                          <FieldWrap icon={<svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="11" r="4" /></svg>}>
                            <input value={createForm.pppoeUsername} onChange={e => setCreateForm({ ...createForm, pppoeUsername: e.target.value })} style={fInpIcon} placeholder="HIF-0001" onFocus={e => { e.currentTarget.style.borderColor = '#059669'; e.currentTarget.style.background = '#fff'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(5,150,105,0.12)'; }} onBlur={e => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.background = '#F8FAFC'; e.currentTarget.style.boxShadow = 'inset 0 1px 2px rgba(15,23,42,0.02)'; }} />
                          </FieldWrap>
                          <div style={hint}>Leave blank → auto from <b>{createForm.legacyId || createForm.id2 || 'ID'}</b></div>
                        </div>
                        <div>
                          <label style={fLbl}>IP address</label>
                          <FieldWrap icon={<svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5" /><path d="M7 12h10M12 7v10" /></svg>}>
                            <input value={createForm.ipAddress} onChange={e => setCreateForm({ ...createForm, ipAddress: e.target.value })} style={fInpIcon} placeholder="192.168.1.10" inputMode="decimal" onFocus={e => { e.currentTarget.style.borderColor = '#059669'; e.currentTarget.style.background = '#fff'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(5,150,105,0.12)'; }} onBlur={e => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.background = '#F8FAFC'; e.currentTarget.style.boxShadow = 'inset 0 1px 2px rgba(15,23,42,0.02)'; }} />
                          </FieldWrap>
                          <div style={hint}>Static IP or pool • sheet <b>IP ADDRESS</b></div>
                        </div>
                      </div>
                    </div>

                    {/* Dates & Fees */}
                    <div style={{ ...card, borderLeft: '3px solid #7C3AED', animation: 'popIn 0.32s ease 0.18s both' }}>
                      <div style={{ position: 'absolute', top: 0, right: 0, width: 140, height: 140, background: '#F5F3FF', opacity: 0.5, pointerEvents: 'none' }} />
                      {secHead('#7C3AED', '#F5F3FF', <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>, 'Dates & Fees', 'sheet: START / EXPIRY / PLAN fee')}
                      <div className="grid-2" style={{ gap: 12, position: 'relative' }}>
                        <div>
                          <label style={fLbl}>Start date</label>
                          <FieldWrap icon={<svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>}>
                            <input type="date" value={createForm.startDate} onChange={e => setCreateForm({ ...createForm, startDate: e.target.value })} style={fInpIcon} onFocus={e => { e.currentTarget.style.borderColor = '#7C3AED'; e.currentTarget.style.background = '#fff'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(124,58,237,0.12)'; }} onBlur={e => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.background = '#F8FAFC'; e.currentTarget.style.boxShadow = 'inset 0 1px 2px rgba(15,23,42,0.02)'; }} />
                          </FieldWrap>
                          <div style={hint}>Sheet <b>START DATE</b> • dd.mm.yyyy</div>
                        </div>
                        <div>
                          <label style={fLbl}>Expiry date</label>
                          <FieldWrap icon={<svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /><path d="M12 14l2 2 4-4" /></svg>}>
                            <input type="date" value={createForm.expiry} onChange={e => setCreateForm({ ...createForm, expiry: e.target.value })} style={{ ...fInpIcon, fontWeight: createForm.expiry ? 700 : 500 }} onFocus={e => { e.currentTarget.style.borderColor = '#7C3AED'; e.currentTarget.style.background = '#fff'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(124,58,237,0.12)'; }} onBlur={e => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.background = '#F8FAFC'; e.currentTarget.style.boxShadow = 'inset 0 1px 2px rgba(15,23,42,0.02)'; }} />
                          </FieldWrap>
                          <div style={hint}>Sheet <b>EXPIRY DATE</b> • +30d if blank</div>
                        </div>

                        <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 14px', borderRadius: 14, background: createForm.includeInstallation ? '#F5F3FF' : '#F8FAFC', border: `1.5px solid ${createForm.includeInstallation ? '#DDD6FE' : '#E2E8F0'}`, transition: 'all 0.18s' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ width: 32, height: 32, borderRadius: 10, background: createForm.includeInstallation ? '#7C3AED' : '#fff', color: createForm.includeInstallation ? '#fff' : '#94A3B8', border: `1px solid ${createForm.includeInstallation ? '#7C3AED' : '#E2E8F0'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.18s' }}>
                              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
                            </div>
                            <div>
                              <div style={{ fontSize: '0.84rem', fontWeight: 800, color: '#0F172A', lineHeight: 1 }}>Installation fee</div>
                              <div style={{ fontSize: '0.68rem', color: '#64748B', lineHeight: 1.2 }}>One-off • auto from plan & network type</div>
                            </div>
                          </div>
                          <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer', flexShrink: 0 }}>
                            <input type="checkbox" checked={createForm.includeInstallation} onChange={e => { const on = e.target.checked; setCreateForm(f => ({ ...f, includeInstallation: on, fee: on ? planFee(plans, f.planId, f.networkType) : f.fee })); }} style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} />
                            <span style={{ width: 44, height: 26, borderRadius: 999, background: createForm.includeInstallation ? '#7C3AED' : '#E2E8F0', position: 'relative', display: 'inline-block', transition: 'all 0.2s', boxShadow: createForm.includeInstallation ? '0 2px 8px rgba(124,58,237,0.28)' : 'inset 0 1px 2px rgba(0,0,0,0.06)' }}>
                              <span style={{ position: 'absolute', top: 2, left: createForm.includeInstallation ? 20 : 2, width: 22, height: 22, borderRadius: 999, background: '#fff', boxShadow: '0 1px 4px rgba(15,23,42,0.14)', transition: 'all 0.2s' }} />
                            </span>
                          </label>
                        </div>

                        <div style={{ gridColumn: '1 / -1' }}>
                          <label style={{ ...fLbl, opacity: createForm.includeInstallation ? 1 : 0.6 }}>Amount (₦)</label>
                          <FieldWrap icon={<span style={{ fontSize: '0.82rem', fontWeight: 800, color: createForm.includeInstallation ? '#7C3AED' : '#94A3B8' }}>₦</span>}>
                            <input value={createForm.fee} disabled={!createForm.includeInstallation} onChange={e => setCreateForm({ ...createForm, fee: e.target.value })} style={{ ...fInpIcon, opacity: createForm.includeInstallation ? 1 : 0.6, background: createForm.includeInstallation ? '#F8FAFC' : '#F1F5F9', fontWeight: 700, letterSpacing: -0.2 }} placeholder="50,000" onFocus={e => { if (!createForm.includeInstallation) return; e.currentTarget.style.borderColor = '#7C3AED'; e.currentTarget.style.background = '#fff'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(124,58,237,0.12)'; }} onBlur={e => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.background = createForm.includeInstallation ? '#F8FAFC' : '#F1F5F9'; e.currentTarget.style.boxShadow = 'inset 0 1px 2px rgba(15,23,42,0.02)'; }} />
                          </FieldWrap>
                          {!createForm.includeInstallation && <div style={hint}>Enable toggle to charge installation on first invoice</div>}
                        </div>

                        <div>
                          <label style={fLbl}>Portal password <span style={{ fontWeight: 400, textTransform: 'none', color: '#94A3B8', letterSpacing: 0 }}>auto if blank</span></label>
                          <FieldWrap icon={<svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>}>
                            <input value={createForm.portalPassword} onChange={e => setCreateForm({ ...createForm, portalPassword: e.target.value })} style={fInpIcon} placeholder="Random 8-char" onFocus={e => { e.currentTarget.style.borderColor = '#7C3AED'; e.currentTarget.style.background = '#fff'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(124,58,237,0.12)'; }} onBlur={e => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.background = '#F8FAFC'; e.currentTarget.style.boxShadow = 'inset 0 1px 2px rgba(15,23,42,0.02)'; }} />
                          </FieldWrap>
                        </div>
                        <div>
                          <label style={fLbl}>RADIUS password <span style={{ fontWeight: 400, textTransform: 'none', color: '#94A3B8', letterSpacing: 0 }}>default if blank</span></label>
                          <FieldWrap icon={<svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>}>
                            <input value={createForm.radiusPassword} onChange={e => setCreateForm({ ...createForm, radiusPassword: e.target.value })} style={fInpIcon} placeholder="••••••••" onFocus={e => { e.currentTarget.style.borderColor = '#7C3AED'; e.currentTarget.style.background = '#fff'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(124,58,237,0.12)'; }} onBlur={e => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.background = '#F8FAFC'; e.currentTarget.style.boxShadow = 'inset 0 1px 2px rgba(15,23,42,0.02)'; }} />
                          </FieldWrap>
                        </div>

                        <label style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 14, background: createForm.sendWelcome ? '#ECFDF5' : '#F8FAFC', border: `1.5px solid ${createForm.sendWelcome ? '#A7F3D0' : '#E2E8F0'}`, cursor: 'pointer', transition: 'all 0.15s' }}>
                          <input type="checkbox" checked={createForm.sendWelcome} onChange={e => setCreateForm({ ...createForm, sendWelcome: e.target.checked })} style={{ width: 18, height: 18, accentColor: '#059669', cursor: 'pointer' }} />
                          <span style={{ width: 32, height: 32, borderRadius: 10, background: createForm.sendWelcome ? '#059669' : '#fff', color: createForm.sendWelcome ? '#fff' : '#94A3B8', border: `1px solid ${createForm.sendWelcome ? '#059669' : '#E2E8F0'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
                          </span>
                          <span style={{ flex: 1 }}>
                            <span style={{ display: 'block', fontSize: '0.84rem', fontWeight: 700, color: '#0F172A', lineHeight: 1 }}>Send welcome email</span>
                            <span style={{ display: 'block', fontSize: '0.68rem', color: '#64748B', lineHeight: 1.2 }}>Portal link + credentials to customer</span>
                          </span>
                          <span style={{ fontSize: '0.62rem', fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', padding: '4px 8px', borderRadius: 999, background: createForm.sendWelcome ? '#059669' : '#fff', color: createForm.sendWelcome ? '#fff' : '#94A3B8', border: `1px solid ${createForm.sendWelcome ? '#059669' : '#E2E8F0'}` }}>{createForm.sendWelcome ? 'ON' : 'OFF'}</span>
                        </label>
                      </div>
                    </div>

                    {createError && (
                      <div style={{ display: 'flex', gap: 10, padding: '12px 14px', background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', borderRadius: 14, fontSize: '0.82rem', lineHeight: 1.4, animation: 'popIn 0.2s ease' }}>
                        <span style={{ width: 28, height: 28, borderRadius: 10, background: '#FEE2E2', color: '#DC2626', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg></span>
                        <span style={{ paddingTop: 2 }}>{createError}</span>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            {/* ── Footer ── */}
            <div style={{ padding: '16px 24px', background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', borderTop: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexShrink: 0, boxSizing: 'border-box', flexWrap: 'wrap' as const }}>
              <div style={{ fontSize: '0.72rem', color: '#94A3B8', lineHeight: 1.4 }}>
                <div style={{ fontWeight: 700, color: '#334155', fontSize: '0.74rem' }}>{!createForm.email || !((createForm.name.trim() || createForm.firstName.trim() || createForm.companyName.trim())) ? 'Almost there…' : 'Ready to create'}</div>
                <div>{!createForm.email ? 'Email is required' : !((createForm.name.trim() || createForm.firstName.trim() || createForm.companyName.trim())) ? 'Add a name' : 'Appears in customers after KYC approval'}</div>
              </div>
              <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                <button onClick={() => setShowCreate(false)} style={{ padding: '11px 18px', borderRadius: 999, border: '1.5px solid #E2E8F0', background: '#fff', fontWeight: 700, fontSize: '0.84rem', cursor: 'pointer', color: '#334155', transition: 'all 0.15s' }} onMouseEnter={e => { e.currentTarget.style.background = '#F8FAFC'; e.currentTarget.style.borderColor = '#CBD5E1'; }} onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#E2E8F0'; }}>Cancel</button>
                <button onClick={handleCreateCustomer} disabled={creating} style={{ padding: '11px 20px', borderRadius: 999, border: 'none', background: creating ? '#E2E8F0' : 'linear-gradient(135deg, #F15925 0%, #EA580C 100%)', color: creating ? '#94A3B8' : '#fff', fontWeight: 800, fontSize: '0.84rem', cursor: creating ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, boxShadow: creating ? 'none' : '0 8px 20px rgba(241,89,37,0.28), 0 2px 6px rgba(241,89,37,0.18)', opacity: creating ? 0.9 : 1, transition: 'all 0.15s', letterSpacing: -0.1 }}>
                  {creating ? <><span style={{ width: 14, height: 14, border: '2px solid #94A3B8', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} /> Creating…</> : <>Create customer <span style={{ width: 20, height: 20, borderRadius: 999, background: 'rgba(255,255,255,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>→</span></>}
                </button>
              </div>
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

            {/* Body — scrollable */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 1, overflowY: 'auto', paddingRight: 2 }}>

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
