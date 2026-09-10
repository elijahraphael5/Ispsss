'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { api, timeAgo, notifyCustomersChanged } from '@isp/shared';
import { useAuthStore } from '@isp/shared';
import { useToast, ToastContainer } from '../../components/Toast';
import { SkeletonTable } from '../../components/Skeleton';

interface KycItem {
  id: string;
  userId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  pppoeUsername: string | null;
  networkType: string | null;
  type: string;
  plan: string | null;
  speedMbps: number | null;
  priceKobo: number | null;
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
  return <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600, backgroundColor: color + '18', color }}>{label}</span>;
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
  const [form, setForm] = useState({ name: '', email: '', phone: '', address: '', networkType: '', pppoeUsername: '', planName: '' });
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
      [k.name, k.email, k.phone, k.pppoeUsername, k.address, k.plan, k.kycSubmittedByName]
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
      address: k.address ?? '',
      networkType: k.networkType ?? '',
      pppoeUsername: k.pppoeUsername ?? '',
      planName: k.plan ?? '',
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
      if (form.address.trim() !== (selected.address ?? '')) body.address = form.address.trim();
      if (form.networkType.trim() !== (selected.networkType ?? '')) body.networkType = form.networkType.trim();
      if (form.pppoeUsername.trim() !== (selected.pppoeUsername ?? '')) body.pppoeUsername = form.pppoeUsername.trim();
      if (form.planName !== (selected.plan ?? '')) body.planName = form.planName;
      if (Object.keys(body).length) {
        await api(`/users/customers/${selected.id}`, { method: 'PATCH', body: JSON.stringify(body) });
        toast('Details updated.', 'success', toasts, setToasts);
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

  return (
    <>
      <div className="page-title-row">
        <div>
          <h1 className="page-title">KYC Approvals</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 4 }}>
            New accounts wait here before they appear in the Customers list.
            Maker–checker: the admin who created an account cannot approve it — a different admin must.
          </p>
        </div>
        <button className="btn-outline" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #f87171', borderRadius: 12, padding: '12px 16px', marginBottom: 16, color: '#991b1b', fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{error}</span>
          <button onClick={() => setError('')} style={{ background: 'none', border: 'none', color: '#991b1b', cursor: 'pointer', fontSize: '1.2rem' }}>×</button>
        </div>
      )}

      <div className="data-card">
        <div className="filter-bar">
          <div className="search-box">
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name, email, phone, username…"
            />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {badge(`${pendingCount} pending`, '#D97706')}
            {badge(`${rejectedCount} rejected`, '#DC2626')}
          </div>
        </div>
        <div className="table-container">
          <div className="table-scroll" style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 330px)', minHeight: 300 }}>
            {loading ? (
              <div style={{ padding: 24 }}><SkeletonTable rows={6} cols={8} /></div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)' }}>
                {items.length === 0 ? 'No accounts pending KYC approval' : 'No accounts match your search'}
              </div>
            ) : (
              <table>
                <thead style={{ position: 'sticky', top: 0, zIndex: 5 }}>
                  <tr>
                    <th>NAME</th>
                    <th>EMAIL / PHONE</th>
                    <th>NETWORK</th>
                    <th>PLAN</th>
                    <th>USERNAME</th>
                    <th>MAKER (CREATED BY)</th>
                    <th>WHEN</th>
                    <th>STATUS</th>
                    <th style={{ width: 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(k => {
                    const mine = !canSelfApprove && user?.id === k.kycSubmittedById;
                    const rejected = !!k.kycRejectedAt;
                    return (
                      <tr key={k.id} onClick={() => { setShowReject(false); setRejectReason(''); setEditing(false); setSelectedId(k.id); }} style={{ cursor: 'pointer' }}>
                        <td style={{ fontWeight: 600 }}>{k.name || '—'}</td>
                        <td>
                          <div>{k.email || '—'}</div>
                          {k.phone && <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{k.phone}</div>}
                        </td>
                        <td>{k.networkType ? badge(k.networkType, '#2563EB') : '—'}</td>
                        <td>{k.plan || '—'}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{k.pppoeUsername || '—'}</td>
                        <td>
                          <div>{k.kycSubmittedByName || '—'}</div>
                          {mine && <div style={{ fontSize: '0.68rem', color: '#B45309', fontWeight: 600 }}>you (maker)</div>}
                        </td>
                        <td style={{ whiteSpace: 'nowrap', fontSize: '0.8rem' }}>{k.kycSubmittedAt ? timeAgo(k.kycSubmittedAt) : timeAgo(k.createdAt)}</td>
                        <td>{rejected ? badge('Rejected', '#DC2626') : badge('Pending', '#D97706')}</td>
                        <td><span style={{ color: 'var(--primary)' }}>→</span></td>
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
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}
          onClick={() => setSelectedId(null)}>
          <div style={{ background: 'white', padding: 32, width: 480, maxWidth: '95vw', height: '100vh', overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.1)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>KYC Review</h2>
              <span style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setSelectedId(null)}>
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: '1rem' }}>{selected.name || '—'}</span>
                {selected.kycRejectedAt ? badge('Rejected', '#DC2626') : badge('Pending', '#D97706')}
              </div>

              {editing ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <label style={lbl}>Full name</label>
                    <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={inp} />
                  </div>
                  <div>
                    <label style={lbl}>Email</label>
                    <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} style={inp} />
                  </div>
                  <div>
                    <label style={lbl}>Phone</label>
                    <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} style={inp} />
                  </div>
                  <div>
                    <label style={lbl}>Address</label>
                    <input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} style={inp} />
                  </div>
                  <div>
                    <label style={lbl}>Network type</label>
                    <input value={form.networkType} onChange={e => setForm({ ...form, networkType: e.target.value })} placeholder="e.g. FIBER, RADIO, DIA" style={inp} />
                  </div>
                  <div>
                    <label style={lbl}>PPPoE / RADIUS username</label>
                    <input value={form.pppoeUsername} onChange={e => setForm({ ...form, pppoeUsername: e.target.value })} style={inp} />
                  </div>
                  <div>
                    <label style={lbl}>Plan</label>
                    <select value={form.planName} onChange={e => setForm({ ...form, planName: e.target.value })} style={{ ...inp, background: '#fff' }}>
                      <option value="">— No plan —</option>
                      {plans.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                      {form.planName && !plans.some(p => p.name === form.planName) && <option value={form.planName}>{form.planName}</option>}
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
                    <button className="btn-outline" onClick={() => setEditing(false)}>Cancel</button>
                    <button className="btn-primary" disabled={savingEdit} onClick={saveEdit}>
                      {savingEdit ? 'Saving…' : 'Save Details'}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {[
                    ['Email', selected.email || '—'],
                    ['Phone', selected.phone || '—'],
                    ['Address', selected.address || '—'],
                    ['Network', selected.networkType || '—'],
                    ['Plan', selected.plan || '—'],
                    ['PPPoE / RADIUS username', selected.pppoeUsername || '—'],
                    ['Created by (maker)', selected.kycSubmittedByName || '—'],
                    ['Submitted', selected.kycSubmittedAt ? new Date(selected.kycSubmittedAt).toLocaleString() : '—'],
                  ].map(([label, value]) => (
                    <div key={label} style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: 10 }}>
                      <label style={{ display: 'block', fontSize: '0.7rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700, marginBottom: 2 }}>{label}</label>
                      <p style={{ fontSize: '0.9rem', fontWeight: 500, margin: 0, wordBreak: 'break-word' }}>{value}</p>
                    </div>
                  ))}

                  {selected.kycRejectReason && (
                    <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 12, padding: '12px 14px' }}>
                      <label style={{ display: 'block', fontSize: '0.7rem', textTransform: 'uppercase', color: '#DC2626', fontWeight: 700, marginBottom: 2 }}>Rejection reason</label>
                      <p style={{ fontSize: '0.85rem', margin: 0, color: '#991B1B' }}>{selected.kycRejectReason}</p>
                    </div>
                  )}

                  {showReject && (
                    <div>
                      <label style={lbl}>Reason (optional)</label>
                      <textarea
                        value={rejectReason}
                        onChange={e => setRejectReason(e.target.value)}
                        rows={3}
                        placeholder="e.g. ID document illegible"
                        style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--border-color)', borderRadius: 12, fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }}
                      />
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
                    {showReject ? (
                      <>
                        <button className="btn-outline" onClick={() => { setShowReject(false); setRejectReason(''); }}>Back</button>
                        <button className="btn-primary" style={{ backgroundColor: '#DC2626' }} disabled={busyId === selected.id} onClick={() => reject(selected.id)}>
                          {busyId === selected.id ? 'Rejecting…' : 'Confirm Reject'}
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="btn-outline" onClick={() => openEdit(selected)}>Edit Details</button>
                        <button className="btn-outline" style={{ borderColor: '#DC2626', color: '#DC2626' }} onClick={() => setShowReject(true)}>Reject</button>
                        <button
                          className="btn-primary"
                          style={!canSelfApprove && user?.id === selected.kycSubmittedById ? { background: '#E5E7EB', color: '#9CA3AF', cursor: 'not-allowed' } : { background: '#16A34A' }}
                          disabled={busyId === selected.id || (!canSelfApprove && user?.id === selected.kycSubmittedById)}
                          title={!canSelfApprove && user?.id === selected.kycSubmittedById ? 'Maker–checker: you created this account, another admin must approve it' : 'Approve this account'}
                          onClick={() => approve(selected.id)}
                        >
                          {busyId === selected.id ? 'Approving…' : 'Approve'}
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      <ToastContainer toasts={toasts} />
    </>
  );
}
