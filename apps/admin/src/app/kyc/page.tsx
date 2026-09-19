'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { api, timeAgo, notifyCustomersChanged } from '@isp/shared';
import { useAuthStore } from '@isp/shared';
import { formatNaira } from '@isp/shared';
import { useToast, ToastContainer } from '../../components/Toast';
import {
  ShieldCheck,
  ShieldAlert,
  Clock,
  Search,
  RefreshCw,
  X,
  CheckCircle,
  XCircle,
  AlertCircle,
  Users,
  UserCheck,
  Mail,
  Phone,
  MapPin,
  Layers,
  Wifi,
  Globe,
  Calendar,
  UserX,
  Eye,
  Edit3,
  Building2,
  CreditCard,
} from 'lucide-react';
import { SkeletonTable } from '../../components/Skeleton';

interface KycItem {
  id: string;
  userId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  secondaryPhone: string | null;
  address: string | null;
  pppoeUsername: string | null;
  networkType: string | null;
  type: string;
  plan: string | null;
  planId: string | null;
  speedMbps: number | null;
  priceKobo: number | null;
  legacyId: string | null;
  hikonnectId: string | null;
  id2: string | null;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  stationLabel: string | null;
  staticIpAddress: string | null;
  ipAddress: string | null;
  startedAt: string | null;
  expiresAt: string | null;
  installationFeeKobo: number | null;
  status: string;
  kycVerified: boolean;
  kycSubmittedById: string | null;
  kycSubmittedAt: string | null;
  kycSubmittedByName: string | null;
  kycApprovedById: string | null;
  kycApprovedAt: string | null;
  kycRejectedById: string | null;
  kycRejectedAt: string | null;
  kycRejectReason: string | null;
  cpeCount: number;
  createdAt: string;
}

function badge(label: string, color: string) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20, fontSize: '0.68rem', fontWeight: 700, backgroundColor: color + '14', color, border: `1px solid ${color}18`, letterSpacing: 0.2 }}>{label}</span>;
}

const avatarPalette = ['#F15925', '#2563EB', '#16A34A', '#8B5CF6', '#F59E0B', '#0EA5E9', '#EC4899', '#14B8A6'];
function avatarColor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return avatarPalette[h % avatarPalette.length];
}
function initialsOf(name: string | null, fallback: string) {
  const src = (name && name.trim()) || fallback;
  const parts = src.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
}

export default function KycPage() {
  const user = useAuthStore(s => s.user);
  const [items, setItems] = useState<KycItem[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [editing, setEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [form, setForm] = useState({
    name: '', email: '', phone: '', secondaryPhone: '', address: '', stationLabel: '',
    networkType: '', pppoeUsername: '', ipAddress: '', planName: '',
    legacyId: '', id2: '', firstName: '', lastName: '', companyName: '',
    startedAt: '', expiresAt: '', installationFee: '',
  });
  const [toasts, setToasts] = useState<{ id: number; message: string; type: 'success' | 'error' }[]>([]);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      setError('');
      setItems(await api<KycItem[]>('/users/kyc'));
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load KYC queue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api<any[]>('/subscriptions/plans').then(setPlans).catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(k =>
      [k.name, k.email, k.phone, k.secondaryPhone, k.pppoeUsername, k.address, k.stationLabel, k.plan, k.kycSubmittedByName, k.legacyId, k.hikonnectId, k.id2, k.firstName, k.lastName, k.companyName, k.ipAddress, k.networkType]
        .filter(Boolean)
        .some(v => (v as string).toLowerCase().includes(q)),
    );
  }, [items, search]);

  const selected: KycItem | undefined = items.find(k => k.id === selectedId);
  const pendingCount = items.filter(k => !k.kycRejectedAt).length;
  const rejectedCount = items.length - pendingCount;
  // SUPER_ADMIN (or platform superadmin) may create AND approve; other roles
  // keep the maker ≠ checker rule.
  const canSelfApprove = user?.isSuperAdmin === true || user?.customRole?.name === 'SUPER_ADMIN';

  async function approve(id: string) {
    setBusyId(id);
    try {
      await api(`/users/kyc/${id}/approve`, { method: 'POST', body: '{}' });
      toast('Account approved — it now appears in the Customers list.', 'success', toasts, setToasts);
      notifyCustomersChanged();
      setSelectedId(null);
      setShowReject(false);
      setRejectReason('');
      await load();
    } catch (e: any) {
      toast(e?.message ?? 'Approval failed', 'error', toasts, setToasts);
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: string) {
    setBusyId(id);
    try {
      await api(`/users/kyc/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason: rejectReason }) });
      toast('Account rejected — it stays in the KYC queue.', 'success', toasts, setToasts);
      setSelectedId(null);
      setShowReject(false);
      setRejectReason('');
      await load();
    } catch (e: any) {
      toast(e?.message ?? 'Rejection failed', 'error', toasts, setToasts);
    } finally {
      setBusyId(null);
    }
  }

  function openEdit(k: KycItem) {
    setForm({
      name: k.name ?? '',
      email: k.email ?? '',
      phone: k.phone ?? '',
      secondaryPhone: k.secondaryPhone ?? '',
      address: k.address ?? '',
      stationLabel: k.stationLabel ?? '',
      networkType: k.networkType ?? '',
      pppoeUsername: k.pppoeUsername ?? '',
      ipAddress: k.ipAddress ?? k.staticIpAddress ?? '',
      planName: k.plan ?? '',
      legacyId: k.legacyId ?? '',
      id2: k.id2 ?? '',
      firstName: k.firstName ?? '',
      lastName: k.lastName ?? '',
      companyName: k.companyName ?? '',
      startedAt: k.startedAt ? new Date(k.startedAt).toISOString().slice(0, 10) : '',
      expiresAt: k.expiresAt ? new Date(k.expiresAt).toISOString().slice(0, 10) : '',
      installationFee: k.installationFeeKobo != null ? String(Math.round(k.installationFeeKobo / 100)) : '',
    });
    setShowReject(false);
    setEditing(true);
  }

  async function saveEdit() {
    if (!selected) return;
    setSavingEdit(true);
    try {
      const body: Record<string, string> = {};
      if (form.name.trim() !== (selected.name ?? '')) body.name = form.name.trim();
      if (form.email.trim() && form.email.trim() !== (selected.email ?? '')) body.email = form.email.trim();
      if (form.phone.trim() !== (selected.phone ?? '')) body.phone = form.phone.trim();
      if (form.secondaryPhone.trim() !== (selected.secondaryPhone ?? '')) body.secondaryPhone = form.secondaryPhone.trim();
      if (form.address.trim() !== (selected.address ?? '')) body.address = form.address.trim();
      if (form.stationLabel.trim() !== (selected.stationLabel ?? '')) body.stationLabel = form.stationLabel.trim();
      if (form.networkType.trim() !== (selected.networkType ?? '')) body.networkType = form.networkType.trim();
      if (form.pppoeUsername.trim() !== (selected.pppoeUsername ?? '')) body.pppoeUsername = form.pppoeUsername.trim();
      if (form.ipAddress.trim() !== (selected.ipAddress ?? selected.staticIpAddress ?? '')) body.ipAddress = form.ipAddress.trim();
      if (form.legacyId.trim() !== (selected.legacyId ?? '')) body.legacyId = form.legacyId.trim();
      if (form.id2.trim() !== (selected.id2 ?? '')) body.id2 = form.id2.trim();
      if (form.firstName.trim() !== (selected.firstName ?? '')) body.firstName = form.firstName.trim();
      if (form.lastName.trim() !== (selected.lastName ?? '')) body.lastName = form.lastName.trim();
      if (form.companyName.trim() !== (selected.companyName ?? '')) body.companyName = form.companyName.trim();
      if (form.planName !== (selected.plan ?? '')) body.planName = form.planName;
      const selStarted = selected.startedAt ? new Date(selected.startedAt).toISOString().slice(0, 10) : '';
      const selExpires = selected.expiresAt ? new Date(selected.expiresAt).toISOString().slice(0, 10) : '';
      const selFee = selected.installationFeeKobo != null ? String(Math.round(selected.installationFeeKobo / 100)) : '';
      if (form.startedAt !== selStarted) (body as any).startedAt = form.startedAt;
      if (form.expiresAt !== selExpires) { (body as any).expiresAt = form.expiresAt; (body as any).dueAt = form.expiresAt; }
      if (form.installationFee.trim() !== selFee) (body as any).installationFee = form.installationFee.trim();
      if (Object.keys(body).length) {
        await api(`/users/customers/${selected.id}`, { method: 'PATCH', body: JSON.stringify(body) });
        toast('Details updated — all 16 sheet columns synced.', 'success', toasts, setToasts);
        await load();
      }
      setEditing(false);
    } catch (e: any) {
      toast(e?.message ?? 'Failed to update details', 'error', toasts, setToasts);
    } finally {
      setSavingEdit(false);
    }
  }

  const inp = { width: '100%', padding: '10px 14px', border: '1px solid var(--border-color)', borderRadius: 12, fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' as const };
  const lbl = { display: 'block', marginBottom: 6, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' } as const;

  const pendingItems = items.filter(k => !k.kycRejectedAt);
  const rejectedItems = items.filter(k => !!k.kycRejectedAt);

  return (
    <>
      <ToastContainer toasts={toasts} />

      {/* header */}
      <div className="page-title-row" style={{ alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <div style={{ width: 44, height: 44, borderRadius: 14, background: 'linear-gradient(135deg,#FFF7ED 0%, #FFEDD5 100%)', border: '1px solid #FFE7D6', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#F15925', flexShrink: 0 }}>
            <ShieldCheck size={22} strokeWidth={2} />
          </div>
          <div>
            <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8, lineHeight: 1.1 }}>KYC Approvals <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 20, background: pendingCount > 0 ? '#FFFBEB' : '#F0FDF4', color: pendingCount > 0 ? '#B45309' : '#15803D', border: `1px solid ${pendingCount > 0 ? '#FDE68A' : '#BBF7D0'}`, fontSize: '0.62rem', fontWeight: 800, letterSpacing: 0.3 }}>{pendingCount} pending</span></h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: 6, maxWidth: 560, lineHeight: 1.5 }}>
              Accounts awaiting approval • <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600, color: '#92400E', background: '#FEF3C7', padding: '1px 6px', borderRadius: 8, fontSize: '0.72rem' }}><AlertCircle size={11} strokeWidth={2} /> maker–checker</span> the creator can’t approve — another admin must.
            </p>
          </div>
        </div>
        <button className="btn-outline" onClick={load} disabled={loading} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0, marginTop: 4 }}>
          <RefreshCw size={14} strokeWidth={2} style={{ animation: loading ? 'spin 1s linear infinite' : undefined }} />
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {/* stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
        <div className="data-card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, background: 'linear-gradient(135deg,#FFFBEB 0%, #FFFFFF 65%)', border: '1px solid #FDE68A' }}>
          <div style={{ width: 36, height: 36, borderRadius: 11, background: '#fff', border: '1px solid #FDE68A', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#D97706' }}><Clock size={16} strokeWidth={2} /></div>
          <div>
            <div style={{ fontSize: '0.68rem', fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: '#92400E' }}>Pending</div>
            <div style={{ fontSize: '1.35rem', fontWeight: 900, color: '#92400E', lineHeight: 1 }}>{pendingCount}</div>
            <div style={{ fontSize: '0.68rem', color: '#B45309', fontWeight: 600 }}>awaiting review</div>
          </div>
          <div style={{ marginLeft: 'auto', width: 32, height: 32, borderRadius: 10, background: '#FFFBEB', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#D97706', opacity: 0.9 }}><Eye size={14} strokeWidth={2} /></div>
        </div>
        <div className="data-card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, background: 'linear-gradient(135deg,#FEF2F2 0%, #FFFFFF 65%)', border: '1px solid #FECACA' }}>
          <div style={{ width: 36, height: 36, borderRadius: 11, background: '#fff', border: '1px solid #FECACA', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#DC2626' }}><XCircle size={16} strokeWidth={2} /></div>
          <div>
            <div style={{ fontSize: '0.68rem', fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: '#991B1B' }}>Rejected</div>
            <div style={{ fontSize: '1.35rem', fontWeight: 900, color: '#991B1B', lineHeight: 1 }}>{rejectedCount}</div>
            <div style={{ fontSize: '0.68rem', color: '#DC2626', fontWeight: 600 }}>needs attention</div>
          </div>
          <div style={{ marginLeft: 'auto', width: 32, height: 32, borderRadius: 10, background: '#FEF2F2', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#DC2626', opacity: 0.9 }}><UserX size={14} strokeWidth={2} /></div>
        </div>
        <div className="data-card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, background: 'linear-gradient(135deg,#F0FDF4 0%, #FFFFFF 65%)', border: '1px solid #BBF7D0' }}>
          <div style={{ width: 36, height: 36, borderRadius: 11, background: '#fff', border: '1px solid #BBF7D0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#16A34A' }}><Users size={16} strokeWidth={2} /></div>
          <div>
            <div style={{ fontSize: '0.68rem', fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: '#166534' }}>Total queue</div>
            <div style={{ fontSize: '1.35rem', fontWeight: 900, color: '#166534', lineHeight: 1 }}>{items.length}</div>
            <div style={{ fontSize: '0.68rem', color: '#15803D', fontWeight: 600 }}>{filtered.length} shown</div>
          </div>
          <div style={{ marginLeft: 'auto', width: 32, height: 32, borderRadius: 10, background: '#F0FDF4', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#16A34A', opacity: 0.9 }}><ShieldAlert size={14} strokeWidth={2} /></div>
        </div>
      </div>

      {error && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 14, padding: '12px 14px', marginBottom: 16, color: '#991B1B', fontSize: '0.84rem', display: 'flex', alignItems: 'center', gap: 10 }}>
          <AlertCircle size={16} strokeWidth={2} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1 }}>{error}</span>
          <button onClick={() => setError('')} style={{ background: '#fff', border: '1px solid #FECACA', color: '#991B1B', cursor: 'pointer', width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={14} strokeWidth={2} /></button>
        </div>
      )}

      <div className="data-card" style={{ overflow: 'hidden', boxShadow: '0 1px 8px rgba(15,23,42,0.04)' }}>
        <div className="filter-bar" style={{ background: 'linear-gradient(180deg,#FFFFFF 0%, #F8FAFC 100%)', borderBottom: '1px solid #F1F5F9' }}>
          <div className="search-box" style={{ flex: '1 1 280px', maxWidth: 420, background: '#fff', border: '1px solid #E2E8F0', boxShadow: '0 1px 4px rgba(15,23,42,0.04)' }}>
            <Search size={15} strokeWidth={2} color="#94A3B8" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name, email, phone, username…"
              style={{ flex: 1 }}
            />
            {search && <button onClick={() => setSearch('')} style={{ background: '#F1F5F9', border: '1px solid #E2E8F0', width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#64748B' }}><X size={12} strokeWidth={2} /></button>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 20, background: '#FFFBEB', border: '1px solid #FDE68A', color: '#92400E', fontSize: '0.7rem', fontWeight: 800, letterSpacing: 0.2 }}><Clock size={12} strokeWidth={2} /> {pendingCount} pending</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 20, background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', fontSize: '0.7rem', fontWeight: 800, letterSpacing: 0.2 }}><XCircle size={12} strokeWidth={2} /> {rejectedCount} rejected</span>
            <span style={{ fontSize: '0.68rem', color: '#94A3B8', fontWeight: 600, background: '#F8FAFC', border: '1px solid #F1F5F9', padding: '4px 8px', borderRadius: 20 }}>{filtered.length} results</span>
          </div>
        </div>

        <div className="table-container">
          <div className="table-scroll" style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 380px)', minHeight: 300 }}>
            {loading ? (
              <div style={{ padding: 24 }}><SkeletonTable rows={6} cols={8} /></div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: 48, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 72, height: 72, borderRadius: 20, background: 'linear-gradient(135deg,#FFF7ED 0%, #FFEDD5 100%)', border: '1px solid #FFE7D6', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#F59E0B' }}>
                  <ShieldCheck size={30} strokeWidth={1.7} />
                </div>
                <div>
                  <div style={{ fontWeight: 900, fontSize: '0.98rem', color: 'var(--text-dark)' }}>{items.length === 0 ? 'All clear! No pending KYC' : 'No matches'}</div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: 4, maxWidth: 420, lineHeight: 1.5 }}>{items.length === 0 ? 'No accounts pending KYC approval — new sign-ups will appear here for your review.' : `No accounts match “${search}” — try a different name, email or username.`}</div>
                </div>
                {items.length === 0 ? (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', fontWeight: 700, color: '#94A3B8', background: '#F8FAFC', border: '1px dashed #E2E8F0', padding: '6px 10px', borderRadius: 20 }}><CheckCircle size={12} strokeWidth={2} /> You’re up to date</div>
                ) : (
                  <button onClick={() => setSearch('')} style={{ padding: '7px 14px', borderRadius: 20, border: '1px solid #E2E8F0', background: '#fff', color: '#334155', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}><X size={13} strokeWidth={2} /> Clear search</button>
                )}
              </div>
            ) : (
              <table>
                <thead style={{ position: 'sticky', top: 0, zIndex: 5, background: '#fff' }}>
                  <tr>
                    <th style={{ fontSize: '0.66rem', letterSpacing: 0.5 }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Users size={11} strokeWidth={2} /> Customer</span></th>
                    <th style={{ fontSize: '0.66rem', letterSpacing: 0.5 }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Mail size={11} strokeWidth={2} /> Contact</span></th>
                    <th style={{ fontSize: '0.66rem', letterSpacing: 0.5 }}>Network</th>
                    <th>Plan</th>
                    <th style={{ fontSize: '0.66rem', letterSpacing: 0.5 }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Layers size={11} strokeWidth={2} /> Username</span></th>
                    <th><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><UserCheck size={11} strokeWidth={2} /> Maker</span></th>
                    <th><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Calendar size={11} strokeWidth={2} /> When</span></th>
                    <th>Status</th>
                    <th style={{ width: 36 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(k => {
                    const mine = !canSelfApprove && user?.id === k.kycSubmittedById;
                    const rejected = !!k.kycRejectedAt;
                    const displayName = k.name || (k.email ? k.email.split('@')[0] : '—');
                    return (
                      <tr key={k.id} onClick={() => { setShowReject(false); setRejectReason(''); setEditing(false); setSelectedId(k.id); }} style={{ cursor: 'pointer', transition: 'background 0.14s' }}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ width: 32, height: 32, borderRadius: '50%', background: avatarColor(displayName), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>{initialsOf(k.name, k.email || '?')}</div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 800, fontSize: '0.84rem', color: 'var(--text-dark)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>{k.name || '—'}</div>
                              {mine && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '0.6rem', fontWeight: 800, color: '#B45309', background: '#FFFBEB', border: '1px solid #FDE68A', padding: '1px 5px', borderRadius: 8, marginTop: 2 }}><AlertCircle size={10} strokeWidth={2} /> you</span>}
                            </div>
                          </div>
                        </td>
                        <td>
                          <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-dark)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}>{k.email || '—'}</div>
                          {k.phone && <div style={{ color: 'var(--text-muted)', fontSize: '0.74rem', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Phone size={10} strokeWidth={2} />{k.phone}</div>}
                        </td>
                        <td>{k.networkType ? badge(k.networkType, '#2563EB') : <span style={{ color: '#94A3B8' }}>—</span>}</td>
                        <td><span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-dark)' }}>{k.plan || '—'}</span>{k.speedMbps && <span style={{ fontSize: '0.68rem', color: '#64748B', marginLeft: 4, fontWeight: 600 }}>{k.speedMbps} Mbps</span>}</td>
                        <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.76rem', fontWeight: 600, color: '#475569' }}>{k.pppoeUsername || '—'}</td>
                        <td>
                          <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-dark)' }}>{k.kycSubmittedByName || '—'}</div>
                          <div style={{ fontSize: '0.68rem', color: mine ? '#B45309' : 'var(--text-muted)', fontWeight: mine ? 700 : 500 }}>{mine ? 'you (maker)' : ''}</div>
                        </td>
                        <td style={{ whiteSpace: 'nowrap', fontSize: '0.76rem', color: 'var(--text-muted)', fontWeight: 500 }}>{k.kycSubmittedAt ? timeAgo(k.kycSubmittedAt) : timeAgo(k.createdAt)}</td>
                        <td>{rejected ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 20, background: '#FEF2F2', color: '#991B1B', border: '1px solid #FECACA', fontSize: '0.68rem', fontWeight: 800 }}><XCircle size={11} strokeWidth={2} /> Rejected</span> : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 20, background: '#FFFBEB', color: '#92400E', border: '1px solid #FDE68A', fontSize: '0.68rem', fontWeight: 800 }}><Clock size={11} strokeWidth={2} /> Pending</span>}</td>
                        <td><span style={{ width: 26, height: 26, borderRadius: 8, background: '#FFF7ED', border: '1px solid #FFE7D6', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#F15925' }}><Eye size={13} strokeWidth={2} /></span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {selected && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(6px)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}
          onClick={() => setSelectedId(null)}>
          <div style={{ background: 'white', padding: 0, width: 500, maxWidth: '95vw', height: '100vh', overflowY: 'auto', boxShadow: '-8px 0 30px rgba(15,23,42,0.18)', display: 'flex', flexDirection: 'column' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ padding: '18px 22px', borderBottom: '1px solid #F1F5F9', background: 'linear-gradient(180deg,#FFFFFF 0%, #FFFBF7 100%)', position: 'sticky', top: 0, zIndex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', minWidth: 0 }}>
                  <div style={{ width: 42, height: 42, borderRadius: '50%', background: avatarColor(selected.name || selected.email || '?'), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, flexShrink: 0 }}>{initialsOf(selected.name, selected.email || '?')}</div>
                  <div style={{ minWidth: 0 }}>
                    <h2 style={{ fontSize: '1.05rem', fontWeight: 900, color: 'var(--text-dark)', margin: 0, lineHeight: 1.2 }}>{selected.name || '—'}</h2>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500, marginTop: 2, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Mail size={11} strokeWidth={2} />{selected.email || '—'}</span>
                      {selected.phone && <><span style={{ width: 2, height: 2, borderRadius: '50%', background: '#CBD5E1' }} /><span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Phone size={11} strokeWidth={2} />{selected.phone}</span></>}
                    </div>
                    <div style={{ marginTop: 6 }}>{selected.kycRejectedAt ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 20, background: '#FEF2F2', color: '#991B1B', border: '1px solid #FECACA', fontSize: '0.66rem', fontWeight: 800 }}><XCircle size={11} strokeWidth={2} /> Rejected</span> : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 20, background: '#FFFBEB', color: '#92400E', border: '1px solid #FDE68A', fontSize: '0.66rem', fontWeight: 800 }}><Clock size={11} strokeWidth={2} /> Pending review</span>}</div>
                  </div>
                </div>
                <button onClick={() => setSelectedId(null)} style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid #E2E8F0', background: '#fff', color: '#64748B', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
                  <X size={16} strokeWidth={2} />
                </button>
              </div>
            </div>

            <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
              {editing ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#FFF7ED', border: '1px solid #FFE7D6', borderRadius: 10, fontSize: '0.72rem', fontWeight: 700, color: '#92400E' }}><Edit3 size={13} strokeWidth={2} /> Editing details</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={lbl}>Legacy ID (HIF/HIR) <span style={{ color: '#16A34A', fontWeight: 500, textTransform: 'none' }}>• auto, unique</span></label>
                      <input value={form.legacyId} onChange={e => setForm({ ...form, legacyId: e.target.value })} style={inp} placeholder="HIF-0001 / HIR-0001" />
                    </div>
                    <div>
                      <label style={lbl}>ID2</label>
                      <input value={form.id2} onChange={e => setForm({ ...form, id2: e.target.value })} style={inp} placeholder="Secondary ID" />
                    </div>
                    <div>
                      <label style={lbl}>First Name</label>
                      <input value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} style={inp} placeholder="First" />
                    </div>
                    <div>
                      <label style={lbl}>Last Name</label>
                      <input value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} style={inp} placeholder="Last" />
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={lbl}>Company</label>
                      <input value={form.companyName} onChange={e => setForm({ ...form, companyName: e.target.value })} style={inp} placeholder="Company / Estate" />
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={lbl}>Full name (display)</label>
                      <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={inp} placeholder="Customer display name" />
                    </div>
                    <div>
                      <label style={lbl}>Email</label>
                      <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} style={inp} placeholder="email@example.com" />
                    </div>
                    <div>
                      <label style={lbl}>Phone</label>
                      <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} style={inp} placeholder="+234..." />
                    </div>
                    <div>
                      <label style={lbl}>Secondary Phone</label>
                      <input value={form.secondaryPhone} onChange={e => setForm({ ...form, secondaryPhone: e.target.value })} style={inp} placeholder="+234..." />
                    </div>
                    <div>
                      <label style={lbl}>Station</label>
                      <input value={form.stationLabel} onChange={e => setForm({ ...form, stationLabel: e.target.value })} style={inp} placeholder="HOME / FIBER / ITA-ELEWA" />
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={lbl}>Address</label>
                      <input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} style={inp} placeholder="Street, city" />
                    </div>
                    <div>
                      <label style={lbl}>Network type</label>
                      <input value={form.networkType} onChange={e => setForm({ ...form, networkType: e.target.value })} placeholder="FIBER / RADIO / DIA" style={inp} />
                    </div>
                    <div>
                      <label style={lbl}>PPPoE / RADIUS username</label>
                      <input value={form.pppoeUsername} onChange={e => setForm({ ...form, pppoeUsername: e.target.value })} style={inp} placeholder="HIF-0001 / username" />
                    </div>
                    <div>
                      <label style={lbl}>IP Address</label>
                      <input value={form.ipAddress} onChange={e => setForm({ ...form, ipAddress: e.target.value })} style={inp} placeholder="192.168.1.10" />
                    </div>
                    <div>
                      <label style={lbl}>Plan</label>
                      <select value={form.planName} onChange={e => setForm({ ...form, planName: e.target.value })} style={{ ...inp, background: '#fff' }}>
                        <option value="">— No plan —</option>
                        {plans.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                        {form.planName && !plans.some(p => p.name === form.planName) && <option value={form.planName}>{form.planName}</option>}
                      </select>
                    </div>
                    <div>
                      <label style={lbl}>Start Date</label>
                      <input type="date" value={form.startedAt} onChange={e => setForm({ ...form, startedAt: e.target.value })} style={inp} />
                    </div>
                    <div>
                      <label style={lbl}>Expiry / Due Date</label>
                      <input type="date" value={form.expiresAt} onChange={e => setForm({ ...form, expiresAt: e.target.value })} style={inp} />
                    </div>
                    <div>
                      <label style={lbl}>Install Fee (₦)</label>
                      <input value={form.installationFee} onChange={e => setForm({ ...form, installationFee: e.target.value })} style={inp} placeholder="50000" />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                    <button className="btn-outline" onClick={() => setEditing(false)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><X size={13} strokeWidth={2} /> Cancel</button>
                    <button className="btn-primary" disabled={savingEdit} onClick={saveEdit} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      {savingEdit ? 'Saving…' : <><CheckCircle size={13} strokeWidth={2} /> Save</>}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {[
                      { icon: ShieldCheck, label: 'Legacy ID', value: selected.legacyId || '—', mono: true, hint: 'HIF/HIR auto' },
                      { icon: Layers, label: 'Hikonnect ID', value: selected.hikonnectId || '—', mono: true },
                      { icon: Users, label: 'ID2', value: selected.id2 || '—', mono: true },
                      { icon: Users, label: 'First Name', value: selected.firstName || '—' },
                      { icon: Users, label: 'Last Name', value: selected.lastName || '—' },
                      { icon: Building2, label: 'Company', value: selected.companyName || '—', full: true },
                      { icon: Mail, label: 'Email', value: selected.email || '—' },
                      { icon: Phone, label: 'Phone', value: selected.phone || '—' },
                      { icon: Phone, label: 'Secondary Phone', value: selected.secondaryPhone || '—' },
                      { icon: MapPin, label: 'Address', value: selected.address || '—', full: true },
                      { icon: MapPin, label: 'Station', value: selected.stationLabel || '—' },
                      { icon: Wifi, label: 'Network', value: selected.networkType || '—' },
                      { icon: UserCheck, label: 'PPPoE Username', value: selected.pppoeUsername || '—', mono: true },
                      { icon: Globe, label: 'IP Address', value: selected.ipAddress || selected.staticIpAddress || '—', mono: true },
                      { icon: Layers, label: 'Plan', value: `${selected.plan || '—'}${selected.speedMbps ? ` • ${selected.speedMbps} Mbps` : ''}${selected.priceKobo ? ` • ${formatNaira(selected.priceKobo)}` : ''}` },
                      { icon: Calendar, label: 'Started', value: selected.startedAt ? new Date(selected.startedAt).toLocaleDateString('en-GB') : '—' },
                      { icon: Calendar, label: 'Expires', value: selected.expiresAt ? new Date(selected.expiresAt).toLocaleDateString('en-GB') : '—' },
                      { icon: CreditCard, label: 'Install Fee', value: selected.installationFeeKobo != null ? formatNaira(selected.installationFeeKobo) : '—' },
                    ].map(item => {
                      const Icon = item.icon as any;
                      return (
                        <div key={item.label} style={{ background: '#F8FAFC', border: '1px solid #F1F5F9', borderRadius: 12, padding: '10px 12px', gridColumn: (item as any).full ? '1 / -1' : undefined }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.62rem', fontWeight: 800, letterSpacing: 0.3, textTransform: 'uppercase', color: '#94A3B8' }}><Icon size={11} strokeWidth={2} />{item.label} {(item as any).hint && <span style={{ fontWeight: 500, textTransform: 'none', color: '#64748B', letterSpacing: 0 }}>• {(item as any).hint}</span>}</div>
                          <div style={{ fontSize: '0.84rem', fontWeight: 600, marginTop: 2, color: 'var(--text-dark)', wordBreak: 'break-word', fontFamily: (item as any).mono ? 'ui-monospace, monospace' : undefined }}>{item.value}</div>
                        </div>
                      );
                    })}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div style={{ background: '#EFF6FF', border: '1px solid #DBEAFE', borderRadius: 12, padding: '10px 12px' }}>
                      <div style={{ fontSize: '0.62rem', fontWeight: 800, letterSpacing: 0.3, textTransform: 'uppercase', color: '#1E40AF', display: 'flex', alignItems: 'center', gap: 4 }}><UserCheck size={11} strokeWidth={2} /> Maker</div>
                      <div style={{ fontSize: '0.84rem', fontWeight: 700, color: '#1E3060', marginTop: 2 }}>{selected.kycSubmittedByName || '—'}</div>
                      <div style={{ fontSize: '0.68rem', color: '#64748B', fontWeight: 500 }}>{selected.kycSubmittedAt ? new Date(selected.kycSubmittedAt).toLocaleString() : timeAgo(selected.createdAt)}</div>
                    </div>
                    <div style={{ background: selected.kycRejectedAt ? '#FEF2F2' : '#F0FDF4', border: `1px solid ${selected.kycRejectedAt ? '#FECACA' : '#BBF7D0'}`, borderRadius: 12, padding: '10px 12px' }}>
                      <div style={{ fontSize: '0.62rem', fontWeight: 800, letterSpacing: 0.3, textTransform: 'uppercase', color: selected.kycRejectedAt ? '#991B1B' : '#166534', display: 'flex', alignItems: 'center', gap: 4 }}>{selected.kycRejectedAt ? <><XCircle size={11} strokeWidth={2} /> Rejected</> : <><Clock size={11} strokeWidth={2} /> Status</>}</div>
                      <div style={{ fontSize: '0.82rem', fontWeight: 700, color: selected.kycRejectedAt ? '#7F1D1D' : '#14532D', marginTop: 2 }}>{selected.kycRejectedAt ? `Rejected ${timeAgo(selected.kycRejectedAt!)}` : 'Pending approval'}</div>
                      {selected.kycRejectedAt && selected.kycRejectReason && <div style={{ fontSize: '0.72rem', color: '#991B1B', marginTop: 2 }}>{selected.kycRejectReason}</div>}
                    </div>
                  </div>

                  {showReject && (
                    <div style={{ background: '#FFF7ED', border: '1px solid #FFE7D6', borderRadius: 14, padding: '12px 14px' }}>
                      <label style={{ ...lbl, display: 'flex', alignItems: 'center', gap: 5 }}><XCircle size={12} strokeWidth={2} color="#92400E" /> Reason (optional)</label>
                      <textarea
                        value={rejectReason}
                        onChange={e => setRejectReason(e.target.value)}
                        rows={3}
                        placeholder="e.g. ID document illegible"
                        style={{ width: '100%', padding: '10px 12px', border: '1px solid #FDE68A', borderRadius: 10, fontSize: '0.84rem', outline: 'none', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit', background: '#fff' }}
                      />
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4, flexWrap: 'wrap' }}>
                    {showReject ? (
                      <>
                        <button className="btn-outline" onClick={() => { setShowReject(false); setRejectReason(''); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><X size={13} strokeWidth={2} /> Back</button>
                        <button className="btn-primary" style={{ backgroundColor: '#DC2626', display: 'inline-flex', alignItems: 'center', gap: 5 }} disabled={busyId === selected.id} onClick={() => reject(selected.id)}>
                          {busyId === selected.id ? 'Rejecting…' : <><XCircle size={13} strokeWidth={2} /> Confirm Reject</>}
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="btn-outline" onClick={() => openEdit(selected)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Edit3 size={13} strokeWidth={2} /> Edit</button>
                        <button className="btn-outline" style={{ borderColor: '#FECACA', color: '#DC2626', display: 'inline-flex', alignItems: 'center', gap: 5 }} onClick={() => setShowReject(true)}><XCircle size={13} strokeWidth={2} /> Reject</button>
                        <button
                          className="btn-primary"
                          style={!canSelfApprove && user?.id === selected.kycSubmittedById ? { background: '#F1F5F9', color: '#94A3B8', cursor: 'not-allowed', border: '1px solid #E2E8F0', display: 'inline-flex', alignItems: 'center', gap: 5 } : { background: 'linear-gradient(135deg,#16A34A 0%, #15803D 100%)', boxShadow: '0 4px 12px rgba(22,163,74,0.25)', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                          disabled={busyId === selected.id || (!canSelfApprove && user?.id === selected.kycSubmittedById)}
                          title={!canSelfApprove && user?.id === selected.kycSubmittedById ? 'Maker–checker: you created this, another admin must approve' : 'Approve this account'}
                          onClick={() => approve(selected.id)}
                        >
                          {busyId === selected.id ? 'Approving…' : <><CheckCircle size={14} strokeWidth={2} /> Approve</>}
                        </button>
                      </>
                    )}
                  </div>
                  {!canSelfApprove && user?.id === selected.kycSubmittedById && !showReject && !editing && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, fontSize: '0.72rem', fontWeight: 600, color: '#92400E' }}><ShieldAlert size={12} strokeWidth={2} /> You’re the maker — ask another admin to approve.</div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}