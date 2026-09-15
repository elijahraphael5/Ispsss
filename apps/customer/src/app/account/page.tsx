'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore, api, formatNaira } from '@isp/shared';
import { SkeletonBlock, SkeletonCard } from '../components/Skeleton';

function fmtK(k: number) { return formatNaira(k); }
function fmtDate(v: string | null | undefined) {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtPhone(p: string | null | undefined) {
  if (!p) return '—';
  const s = String(p).trim();
  return s || '—';
}

function copy(text: string) {
  if (!text || text === '—') return;
  navigator.clipboard?.writeText(text).catch(() => {});
}

function Field({ label, value, mono, copyable, badge, badgeColor }: { label: string; value: string | null | undefined; mono?: boolean; copyable?: boolean; badge?: string | null; badgeColor?: string }) {
  const display = value && String(value).trim() ? String(value).trim() : '—';
  const isPlaceholder = display === '—';
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)', fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
        {label}
        {badge && (
          <span style={{ fontSize: '0.62rem', padding: '2px 8px', borderRadius: 20, background: (badgeColor ?? '#F1F5F9'), color: badgeColor ? '#fff' : '#64748B', fontWeight: 700 }}>{badge}</span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: '0.9rem', fontWeight: 600, fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined, color: isPlaceholder ? 'var(--text-muted)' : 'var(--text-dark)', wordBreak: 'break-all' }}>
          {display}
        </div>
        {copyable && !isPlaceholder && (
          <button onClick={() => copy(display)} title="Copy" style={{ border: 'none', background: '#F1F5F9', width: 26, height: 26, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-muted)', flexShrink: 0 }}>
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v3"/></svg>
          </button>
        )}
      </div>
    </div>
  );
}

export default function AccountPage() {
  const { user, accessToken, logout, setUser } = useAuthStore();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [twoFaBusy, setTwoFaBusy] = useState(false);
  const [twoFaMsg, setTwoFaMsg] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [pwError, setPwError] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editDraft, setEditDraft] = useState({ firstName: '', lastName: '', companyName: '', phone: '', secondaryPhone: '', email: '', address: '', stationLabel: '', ipAddress: '' });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [editMsg, setEditMsg] = useState('');

  useEffect(() => {
    if (!accessToken) {
      if (typeof window !== 'undefined' && !localStorage.getItem('accessToken')) router.push('/login');
      return;
    }
    api('/customer/dashboard').then((d: any) => setData(d)).catch(() => {}).finally(() => setLoading(false));
  }, [accessToken, router]);

  async function toggle2fa() {
    if (!user) return;
    setTwoFaBusy(true);
    setTwoFaMsg('');
    try {
      await api(`/auth/2fa/${user.twoFaEnabled ? 'disable' : 'enable'}`, { method: 'POST', body: JSON.stringify({}) });
      setUser({ ...user, twoFaEnabled: !user.twoFaEnabled });
      setTwoFaMsg(user.twoFaEnabled ? 'Two-factor authentication disabled.' : 'Two-factor authentication enabled. A code will be emailed to you at login.');
    } catch (e: any) {
      setTwoFaMsg(e?.message ?? 'Failed to update two-factor authentication');
    } finally {
      setTwoFaBusy(false);
    }
  }

  async function handleChangePassword() {
    setPwError('');
    if (!pwForm.current) { setPwError('Enter your current password'); return; }
    if (pwForm.next.length < 8) { setPwError('New password must be at least 8 characters'); return; }
    if (pwForm.next !== pwForm.confirm) { setPwError('New passwords do not match'); return; }
    setPwSaving(true);
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: pwForm.current, newPassword: pwForm.next }),
      });
      logout();
      window.location.href = '/login?reason=password';
    } catch (e: any) {
      setPwError(e?.message ?? 'Failed to change password');
      setPwSaving(false);
    }
  }

  function openEdit() {
    const imp0: any = data?.importFields ?? {};
    const u0: any = data?.user ?? user;
    const sub0: any = data?.subscriber ?? {};
    setEditDraft({
      firstName: imp0.firstName ?? sub0.firstName ?? '',
      lastName: imp0.lastName ?? sub0.lastName ?? '',
      companyName: imp0.companyName ?? sub0.companyName ?? '',
      phone: imp0.contactNumber ?? u0?.phone ?? '',
      secondaryPhone: imp0.secondaryContact ?? u0?.secondaryPhone ?? '',
      email: imp0.email ?? (u0?.email && !String(u0.email).endsWith('@local') ? u0.email : ''),
      address: imp0.address ?? sub0.address ?? '',
      stationLabel: imp0.station ?? sub0.stationLabel ?? '',
      ipAddress: imp0.ipAddress ?? sub0.staticIpAddress ?? (data?.cpe as any)?.ipAddress ?? '',
    });
    setEditError('');
    setEditMsg('');
    setShowEdit(true);
  }

  async function handleSaveEdit() {
    setEditError('');
    setEditMsg('');
    if (!editDraft.phone.trim() && !editDraft.email.trim()) {
      setEditError('Provide at least a phone number or email');
      return;
    }
    if (editDraft.email && !editDraft.email.includes('@')) {
      setEditError('Invalid email');
      return;
    }
    setEditSaving(true);
    try {
      const payload: Record<string, string> = {};
      // Only send changed/trimmed values — backend treats empty as clear (null)
      // For IP, only send if changed to avoid duplicate-conflict on save without IP change (static clients with ipConflict)
      const origIp = String(imp.ipAddress ?? sub.staticIpAddress ?? (cpe as any)?.ipAddress ?? '').trim();
      const newIp = editDraft.ipAddress.trim();
      payload.firstName = editDraft.firstName.trim();
      payload.lastName = editDraft.lastName.trim();
      payload.companyName = editDraft.companyName.trim();
      payload.phone = editDraft.phone.trim();
      payload.secondaryPhone = editDraft.secondaryPhone.trim();
      payload.email = editDraft.email.trim();
      payload.address = editDraft.address.trim();
      payload.stationLabel = editDraft.stationLabel.trim();
      if (newIp !== origIp) payload.ipAddress = newIp;
      const fresh: any = await api('/customer/profile', { method: 'PATCH', body: JSON.stringify(payload) });
      setData(fresh);
      // keep auth store in sync for header email/phone
      if (fresh?.user) setUser({ ...(user as any), email: fresh.user.email, phone: fresh.user.phone, name: fresh.user.name });
      setEditMsg('Saved');
      setTimeout(() => setShowEdit(false), 600);
    } catch (e: any) {
      setEditError(e?.message ?? 'Failed to save');
    } finally {
      setEditSaving(false);
    }
  }

  if (!accessToken) return null;

  if (loading) {
    return <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <SkeletonBlock width={220} height={28} />
      <SkeletonCard height={160} />
      <div className="grid-2"><SkeletonCard height={220} /><SkeletonCard height={220} /></div>
      <SkeletonCard height={180} />
    </div>;
  }

  const sub = data?.subscriber ?? {};
  const imp = data?.importFields ?? {};
  const cpe = data?.cpe ?? null;
  const plan = data?.plan ?? null;
  const subscription = data?.subscription ?? null;
  const u = data?.user ?? user;

  // Derived display values — 16-column sheet alignment
  const idVal: string | null = imp.id ?? sub.legacyId ?? null;
  const id2Val: string | null = imp.id2 ?? sub.id2 ?? null;
  const hikonnectId: string | null = imp.hikonnectId ?? sub.hikonnectId ?? null;
  const firstName: string | null = imp.firstName ?? sub.firstName ?? null;
  const lastName: string | null = imp.lastName ?? null;
  const fullName = [firstName, lastName].filter(Boolean).join(' ') || u?.name || sub.id?.slice(0, 8) || '—';
  const companyName: string | null = imp.companyName ?? sub.companyName ?? null;
  const contactPrimary: string | null = imp.contactNumber ?? u?.phone ?? null;
  const contactSecondary: string | null = imp.secondaryContact ?? u?.secondaryPhone ?? null;
  const emailDisplay: string | null = imp.email ?? (u?.email && !String(u.email).endsWith('@local') ? u.email : null);
  const station: string | null = imp.station ?? sub.stationLabel ?? null;
  const address: string | null = imp.address ?? sub.address ?? null;
  const planName: string | null = imp.plan ?? plan?.name ?? null;
  const startDate: string | null = imp.startDate ?? subscription?.startedAt ?? sub.startedAt ?? null;
  const expiryDate: string | null = imp.expiryDate ?? subscription?.expiresAt ?? sub.expiresAt ?? null;
  const ipAddress: string | null = imp.ipAddress ?? sub.staticIpAddress ?? cpe?.ipAddress ?? null;
  const userType: string | null = imp.userType ?? sub.networkType ?? plan?.technology ?? null;
  const ipConflict: boolean = !!(imp.ipConflict || cpe?.ipConflict);
  const needsMac = !!(imp.needsMacAddress || cpe?.needsMacAddress);

  const expiryTs = expiryDate ? new Date(expiryDate).getTime() : 0;
  const daysLeft = expiryTs ? Math.ceil((expiryTs - Date.now()) / 86400000) : null;
  const statusColor: Record<string, { bg: string; fg: string }> = {
    ACTIVE: { bg: '#e6f9ed', fg: '#1db954' },
    SUSPENDED: { bg: '#fde8e8', fg: '#e53e3e' },
    PENDING_KYC: { bg: '#dbeafe', fg: '#1e40af' },
    TERMINATED: { bg: '#f1f5f9', fg: '#64748b' },
  };
  const sc = statusColor[sub.status ?? 'ACTIVE'] ?? statusColor.ACTIVE;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 800, letterSpacing: -0.3 }}>My Account</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: 4 }}>All 16 import fields — ID, passwords, contact, station, plan, IP & dates — exactly as imported.</p>
        </div>
        <Link href="/support" style={{ padding: '8px 16px', borderRadius: 20, border: '1px solid var(--border-color)', background: '#fff', fontWeight: 700, fontSize: '0.82rem', color: 'var(--text-dark)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          Need help?
        </Link>
      </div>

      {/* Hikonnect Banner */}
      <div className="data-card" style={{ padding: 0, overflow: 'hidden', background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 45%, #F15925 100%)', color: '#fff', border: 'none' }}>
        <div style={{ padding: '20px 24px', display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: 1, opacity: 0.7, textTransform: 'uppercase', marginBottom: 6 }}>Hikonnect Identity</div>
            <div style={{ fontSize: '1.35rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{hikonnectId ?? '—'}</span>
              {sub.status && <span style={{ fontSize: '0.68rem', padding: '4px 10px', borderRadius: 20, background: sc.bg, color: sc.fg, fontWeight: 800 }}>{sub.status}</span>}
            </div>
            <div style={{ fontSize: '0.85rem', opacity: 0.85, marginTop: 6, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <span>PPPoE: <strong style={{ fontFamily: 'monospace' }}>{sub.pppoeUsername ?? '—'}</strong></span>
              {expiryDate && <span>Expires: <strong>{fmtDate(expiryDate)}</strong>{daysLeft !== null && <span style={{ marginLeft: 6, padding: '2px 8px', borderRadius: 20, background: daysLeft < 0 ? '#DC2626' : daysLeft <= 7 ? '#F59E0B' : 'rgba(255,255,255,0.18)', fontSize: '0.72rem', fontWeight: 700 }}>{daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : daysLeft === 0 ? 'today' : `${daysLeft}d left`}</span>}</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ padding: '12px 16px', borderRadius: 16, background: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(8px)', minWidth: 140 }}>
              <div style={{ fontSize: '0.68rem', opacity: 0.7, fontWeight: 700, textTransform: 'uppercase' }}>Plan</div>
              <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>{planName ?? '—'}</div>
              <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>{plan?.technology ?? userType ?? '—'}{plan?.speedMbps ? ` · ${plan.speedMbps} Mbps` : ''}</div>
            </div>
            <div style={{ padding: '12px 16px', borderRadius: 16, background: 'rgba(255,255,255,0.12)', backdropFilter: 'blur(8px)', minWidth: 140 }}>
              <div style={{ fontSize: '0.68rem', opacity: 0.7, fontWeight: 700, textTransform: 'uppercase' }}>IP Address</div>
              <div style={{ fontWeight: 800, fontFamily: 'monospace', fontSize: '0.95rem' }}>{ipAddress ?? '—'}</div>
              <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>{userType ?? '—'}{ipConflict ? ' · ⚠ conflict' : ''}</div>
            </div>
          </div>
        </div>
      </div>

      {/* 16-field sheets — grouped */}
      <div className="grid-2" style={{ gap: 16 }}>
        {/* Identity + Login */}
        <div className="data-card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <div style={{ width: 36, height: 36, borderRadius: 12, background: '#F1592514', color: '#F15925', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>Identity & Login</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>ID, ID2, Hikonnect, email & passwords — from sheet</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 18 }}>
            <Field label="ID (legacy)" value={idVal} mono copyable />
            <Field label="ID2" value={id2Val} mono copyable />
            <Field label="Hikonnect ID" value={hikonnectId} mono copyable />
            <Field label="PPPoE Username" value={sub.pppoeUsername} mono copyable />
            <Field label="EMAIL" value={emailDisplay ?? '—'} />
            <div>
              <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)', fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                PASSWORD
                <span title="RADIUS password from sheet — masked for security" style={{ fontSize: '0.62rem', background: '#FEF3C7', color: '#92400E', padding: '2px 8px', borderRadius: 20, fontWeight: 700 }}>masked</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ fontSize: '0.9rem', fontWeight: 600, fontFamily: 'monospace' }}>{showPasswords ? '••••••••' : '••••••••'}</div>
                <button onClick={() => setShowPasswords(v => !v)} style={{ border: '1px solid var(--border-color)', background: '#fff', padding: '4px 10px', borderRadius: 20, fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer' }}>{showPasswords ? 'Hide' : 'Show'}</button>
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>From <code>PASSWORD</code> column — used for RADIUS. Change via support if needed.</div>
            </div>
            <div>
              <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)', fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                PORTAL PASSWORD
                <span title="Portal password from sheet — masked" style={{ fontSize: '0.62rem', background: '#E0E7FF', color: '#3730A3', padding: '2px 8px', borderRadius: 20, fontWeight: 700 }}>masked</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ fontSize: '0.9rem', fontWeight: 600, fontFamily: 'monospace' }}>••••••••</div>
                <button className="btn-sm-outline" onClick={() => { setPwForm({ current: '', next: '', confirm: '' }); setPwError(''); setShowPw(true); }} style={{ fontSize: '0.72rem' }}>Change</button>
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>From <code>PORTAL PASSWORD</code> column — your login password. You can change it here.</div>
            </div>
          </div>
          {!emailDisplay && (
            <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 12, background: '#FFF7ED', border: '1px solid #FED7AA', fontSize: '0.78rem', color: '#9A3412' }}>
              No email on file — your account uses a placeholder (<code style={{ fontSize: '0.75rem' }}>{u?.email ?? '—'}</code>). Contact support to add a real email for password recovery.
            </div>
          )}
        </div>

        {/* Personal details */}
        <div className="data-card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <div style={{ width: 36, height: 36, borderRadius: 12, background: '#3B82F614', color: '#3B82F6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>Personal Details</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>FIRST NAME, LAST NAME, COMPANY, CONTACT — from sheet</div>
            </div>
            <button className="btn-sm-outline" onClick={openEdit} style={{ marginLeft: 'auto' }}>Edit</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 18 }}>
            <Field label="FIRST NAME" value={firstName} />
            <Field label="LAST NAME" value={lastName} />
            <Field label="Full Name" value={fullName} />
            <Field label="COMPANY NAME" value={companyName} />
            <Field label="CONTACT NUMBER" value={fmtPhone(contactPrimary)} mono copyable />
            <Field label="Secondary Contact" value={fmtPhone(contactSecondary)} mono copyable />
          </div>
        </div>
      </div>

      {/* Service & Location */}
      <div className="data-card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ width: 36, height: 36, borderRadius: 12, background: '#10B98114', color: '#059669', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>Service & Location</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>STATION, ADDRESS, IP ADDRESS, USER TYPE — from sheet + CPE</div>
          </div>
          <button className="btn-sm-outline" onClick={openEdit} style={{ marginLeft: 'auto' }}>Edit</button>
          {ipConflict && <span style={{ fontSize: '0.68rem', padding: '4px 10px', borderRadius: 20, background: '#FEE2E2', color: '#DC2626', fontWeight: 800 }}>⚠ IP conflict flagged</span>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 18 }}>
          <Field label="STATION" value={station} badge={station ? undefined : null} />
          <div style={{ gridColumn: 'span 2' }}>
            <Field label="ADDRESS" value={address} />
          </div>
          <Field label="IP ADDRESS" value={ipAddress} mono copyable badge={ipConflict ? 'conflict' : cpe?.ipAddress ? 'assigned' : 'none'} badgeColor={ipConflict ? '#DC2626' : cpe?.ipAddress ? '#059669' : '#6B7280'} />
          <Field label="USER TYPE" value={userType} badge={userType ? userType : null} />
          <Field label="Connection" value={cpe?.connectionType ?? (userType === 'RADIO' ? 'STATIC_IP' : userType?.includes('PPP') ? 'PPPOE' : '—')} />
          <div style={{ gridColumn: 'span 3', padding: '12px 16px', borderRadius: 12, background: '#F8FAFC', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Static Netmask</div>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, fontFamily: 'monospace' }}>{sub.staticIpNetmask ?? cpe?.ipAddress ? '255.255.255.255' : '—'}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>CPE MAC</div>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, fontFamily: 'monospace' }}>{cpe?.macAddress ?? '—'}{needsMac && <span style={{ marginLeft: 6, fontSize: '0.65rem', background: '#FEF3C7', color: '#92400E', padding: '2px 6px', borderRadius: 20, fontWeight: 700 }}>auto — needs assignment</span>}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>CPE Status</div>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: cpe?.status === 'ONLINE' ? '#059669' : '#6B7280' }}>{cpe?.status ?? '—'}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Plan & Dates — covers PLAN, START DATE, EXPIRY DATE */}
      <div className="data-card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ width: 36, height: 36, borderRadius: 12, background: '#8B5CF614', color: '#7C3AED', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>Plan & Subscription</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>PLAN, START DATE, EXPIRY DATE (+ status) — from sheet & subscription</div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Link href="/subscription" style={{ padding: '7px 14px', borderRadius: 20, background: 'var(--primary)', color: '#fff', fontWeight: 700, fontSize: '0.78rem', textDecoration: 'none' }}>Manage Plan</Link>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 18 }}>
          <Field label="PLAN" value={planName} badge={plan?.technology ?? null} />
          <Field label="Technology" value={plan?.technology ?? userType ?? '—'} />
          <Field label="Speed" value={plan?.speedMbps ? `${plan.speedMbps} Mbps` : '—'} />
          <Field label="Monthly Price" value={plan?.priceKobo != null ? fmtK(plan.priceKobo) : '—'} />
          <Field label="START DATE" value={fmtDate(startDate)} />
          <Field label="EXPIRY DATE" value={fmtDate(expiryDate)} />
          <div style={{ gridColumn: 'span 3', display: 'flex', gap: 12, flexWrap: 'wrap', padding: '12px 16px', borderRadius: 12, background: expiryTs && daysLeft !== null && daysLeft <= 7 ? '#FFF7ED' : '#F8FAFC', border: `1px solid ${expiryTs && daysLeft !== null && daysLeft < 0 ? '#FECACA' : expiryTs && daysLeft !== null && daysLeft <= 7 ? '#FED7AA' : 'var(--border-color)'}` }}>
            <div style={{ fontSize: '0.82rem' }}>
              <strong>Status:</strong> <span style={{ padding: '3px 10px', borderRadius: 20, background: sc.bg, color: sc.fg, fontWeight: 800, fontSize: '0.72rem' }}>{sub.status ?? '—'}</span>
              {subscription?.suspendedAt && <span style={{ marginLeft: 8, color: '#DC2626', fontWeight: 600 }}>Suspended {fmtDate(subscription.suspendedAt)}</span>}
            </div>
            <div style={{ marginLeft: 'auto', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              {startDate && <span>Started {fmtDate(startDate)}</span>}
              {startDate && expiryDate && <span> · </span>}
              {expiryDate && <span>Expires {fmtDate(expiryDate)} · {daysLeft !== null ? (daysLeft < 0 ? `${Math.abs(daysLeft)} days overdue` : daysLeft === 0 ? 'expires today' : `${daysLeft} days remaining`) : ''}</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="data-card" style={{ padding: 20 }}>
        <div style={{ fontSize: '0.95rem', fontWeight: 800, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, background: '#0EA5E914', color: '#0EA5E9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="15" rx="2"/><polyline points="17 2 12 7 7 2"/></svg>
          </div>
          Connected Device
        </div>
        {cpe?.id ? (
          <div style={{ padding: '14px 18px', background: '#F8FAFC', borderRadius: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', border: '1px solid var(--border-color)' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{cpe.name ?? 'CPE Device'}</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
                <span>MAC: <code style={{ fontSize: '0.8rem' }}>{cpe.macAddress ?? '—'}</code></span>
                <span>IP: <code style={{ fontSize: '0.8rem' }}>{cpe.ipAddress ?? '—'}</code></span>
                <span>Type: {cpe.connectionType ?? '—'}</span>
              </div>
            </div>
            <span style={{ padding: '4px 12px', borderRadius: 20, fontSize: '0.75rem', fontWeight: 700, background: cpe.status === 'ONLINE' ? '#e6f9ed' : '#F1F5F9', color: cpe.status === 'ONLINE' ? '#1db954' : '#64748B' }}>{cpe.status ?? 'Offline'}</span>
          </div>
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No CPE registered — a placeholder will be assigned if your import included an IP. Contact support if your device is missing.</p>
        )}
      </div>

      <div className="data-card" style={{ padding: 20 }}>
        <div style={{ fontSize: '0.95rem', fontWeight: 800, marginBottom: 16 }}>Security</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--border-color)', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>Change Password</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Update your portal password (PORTAL PASSWORD column)</div>
            </div>
            <button className="btn-sm-outline" onClick={() => { setPwForm({ current: '', next: '', confirm: '' }); setPwError(''); setShowPw(true); }}>Change</button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--border-color)', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>Two-Factor Auth</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{user?.twoFaEnabled ? 'Enabled — a code is emailed to you at login' : 'Not enabled'}</div>
              {twoFaMsg && <div style={{ fontSize: '0.78rem', color: twoFaMsg.includes('Failed') ? '#DC2626' : '#16A34A', marginTop: 4 }}>{twoFaMsg}</div>}
            </div>
            <button className="btn-sm-outline" disabled={twoFaBusy} onClick={toggle2fa}>{twoFaBusy ? '...' : user?.twoFaEnabled ? 'Disable' : 'Enable'}</button>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button className="btn-outline" onClick={() => { logout(); router.push('/login'); }} style={{ color: '#DC2626', borderColor: '#DC2626' }}>Logout</button>
        <Link href="/billing" className="btn-outline" style={{ textDecoration: 'none' }}>Billing & Payments</Link>
        <Link href="/subscription" className="btn-outline" style={{ textDecoration: 'none' }}>My Subscription</Link>
      </div>

      {showEdit && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}
          onClick={() => setShowEdit(false)}>
          <div style={{ background: 'white', padding: 32, width: 480, maxWidth: '95vw', height: '100vh', overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.1)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 800 }}>Edit Profile</h2>
              <span style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setShowEdit(false)}>
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </span>
            </div>
            {editError && <div style={{ padding: '10px 14px', background: '#FEE2E2', color: '#DC2626', borderRadius: 10, fontSize: '0.85rem', marginBottom: 12 }}>{editError}</div>}
            {editMsg && <div style={{ padding: '10px 14px', background: '#DCFCE7', color: '#166534', borderRadius: 10, fontSize: '0.85rem', marginBottom: 12 }}>{editMsg}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><label style={lbl}>FIRST NAME</label><input value={editDraft.firstName} onChange={e => setEditDraft(f => ({ ...f, firstName: e.target.value }))} style={inp} placeholder="FIRST NAME" /></div>
                <div><label style={lbl}>LAST NAME</label><input value={editDraft.lastName} onChange={e => setEditDraft(f => ({ ...f, lastName: e.target.value }))} style={inp} placeholder="LAST NAME" /></div>
              </div>
              <div><label style={lbl}>COMPANY NAME</label><input value={editDraft.companyName} onChange={e => setEditDraft(f => ({ ...f, companyName: e.target.value }))} style={inp} placeholder="COMPANY NAME" /></div>
              <div><label style={lbl}>Email</label><input value={editDraft.email} onChange={e => setEditDraft(f => ({ ...f, email: e.target.value }))} style={inp} placeholder="email@example.com" /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><label style={lbl}>CONTACT NUMBER</label><input value={editDraft.phone} onChange={e => setEditDraft(f => ({ ...f, phone: e.target.value }))} style={inp} placeholder="080..." /></div>
                <div><label style={lbl}>Secondary Contact</label><input value={editDraft.secondaryPhone} onChange={e => setEditDraft(f => ({ ...f, secondaryPhone: e.target.value }))} style={inp} placeholder="070... (optional)" /></div>
              </div>
              <div><label style={lbl}>STATION</label><input value={editDraft.stationLabel} onChange={e => setEditDraft(f => ({ ...f, stationLabel: e.target.value }))} style={inp} placeholder="HOME / FIBER / RADIO" /></div>
              <div><label style={lbl}>ADDRESS</label><input value={editDraft.address} onChange={e => setEditDraft(f => ({ ...f, address: e.target.value }))} style={inp} placeholder="Home address" /></div>
              <div><label style={lbl}>IP ADDRESS (static — leave blank for PPPoE)</label><input value={editDraft.ipAddress} onChange={e => setEditDraft(f => ({ ...f, ipAddress: e.target.value }))} style={inp} placeholder="192.168.1.10" /></div>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>ID, Hikonnect ID, plan and dates are managed by support. IP is editable — for static clients it updates both Subscriber and CPE. Duplicate IP will be rejected.</p>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn-outline" onClick={() => setShowEdit(false)}>Cancel</button>
                <button className="btn-primary" disabled={editSaving} onClick={handleSaveEdit}>{editSaving ? 'Saving...' : 'Save'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showPw && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}
          onClick={() => setShowPw(false)}>
          <div style={{ background: 'white', padding: 32, width: 440, maxWidth: '95vw', height: '100vh', overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.1)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 800 }}>Change Password</h2>
              <span style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setShowPw(false)}>
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {pwError && (
                <div style={{ padding: '10px 14px', background: '#FEE2E2', color: '#DC2626', borderRadius: 10, fontSize: '0.85rem' }}>{pwError}</div>
              )}
              <div>
                <label style={lbl}>Current Password</label>
                <input type="password" value={pwForm.current} onChange={e => setPwForm(f => ({ ...f, current: e.target.value }))} style={inp} autoComplete="current-password" />
              </div>
              <div>
                <label style={lbl}>New Password</label>
                <input type="password" value={pwForm.next} onChange={e => setPwForm(f => ({ ...f, next: e.target.value }))} style={inp} autoComplete="new-password" />
              </div>
              <div>
                <label style={lbl}>Confirm New Password</label>
                <input type="password" value={pwForm.confirm} onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))} style={inp} autoComplete="new-password" />
              </div>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>You will be signed out of all devices after changing your password.</p>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn-outline" onClick={() => setShowPw(false)}>Cancel</button>
                <button className="btn-primary" disabled={pwSaving} onClick={handleChangePassword}>
                  {pwSaving ? 'Updating...' : 'Update Password'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inp: React.CSSProperties = { width: '100%', padding: '9px 12px', border: '1px solid var(--border-color)', borderRadius: 10, fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' };
const lbl: React.CSSProperties = { display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' };
