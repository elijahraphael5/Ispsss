'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore, api } from '@isp/shared';
import { SkeletonBlock, SkeletonCard } from '../components/Skeleton';

export default function AccountPage() {
  const { user, accessToken, logout, setUser } = useAuthStore();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [subscriber, setSubscriber] = useState<any>(null);
  const [twoFaBusy, setTwoFaBusy] = useState(false);
  const [twoFaMsg, setTwoFaMsg] = useState('');

  const [showPw, setShowPw] = useState(false);
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [pwError, setPwError] = useState('');
  const [pwSaving, setPwSaving] = useState(false);

  useEffect(() => {
    if (!accessToken) {
      if (typeof window !== 'undefined' && !localStorage.getItem('accessToken')) router.push('/login');
      return;
    }
    api('/customer/dashboard').then((d: any) => setSubscriber(d.subscriber)).catch(() => {}).finally(() => setLoading(false));
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

  if (!accessToken) return null;

  if (loading) {
    return <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <SkeletonBlock width={200} height={28} />
      <SkeletonCard height={200} />
      <SkeletonCard height={150} />
    </div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 700 }}>My Account</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Profile, security, and settings</p>
      </div>

      <div className="data-card" style={{ padding: 24 }}>
        <div style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 16 }}>Profile</div>
        <div className="grid-2" style={{ gap: 18 }}>
          {[
            { label: 'Name', value: user?.email?.split('@')[0] ?? '—' },
            { label: 'Email', value: user?.email ?? '—' },
            { label: 'Phone', value: user?.phone ?? '—' },
            { label: 'Customer ID', value: subscriber?.id?.slice(0, 8).toUpperCase() ?? '—' },
            { label: 'Account Number', value: subscriber?.id?.slice(0, 8).toUpperCase() ?? '—' },
            { label: 'Address', value: subscriber?.address ?? '—' },
          ].map(f => (
            <div key={f.label}>
              <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700, marginBottom: 4 }}>{f.label}</div>
              <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{f.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="data-card" style={{ padding: 24 }}>
        <div style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 16 }}>Security</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--border-color)' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Change Password</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Update your account password</div>
            </div>
            <button className="btn-sm-outline" onClick={() => { setPwForm({ current: '', next: '', confirm: '' }); setPwError(''); setShowPw(true); }}>Change</button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--border-color)' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Two-Factor Auth</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{user?.twoFaEnabled ? 'Enabled — a code is emailed to you at login' : 'Not enabled'}</div>
              {twoFaMsg && <div style={{ fontSize: '0.78rem', color: twoFaMsg.includes('Failed') ? '#DC2626' : '#16A34A', marginTop: 4 }}>{twoFaMsg}</div>}
            </div>
            <button className="btn-sm-outline" disabled={twoFaBusy} onClick={toggle2fa}>{twoFaBusy ? '...' : user?.twoFaEnabled ? 'Disable' : 'Enable'}</button>
          </div>
        </div>
      </div>

      <div className="data-card" style={{ padding: 24 }}>
        <div style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 16 }}>Connected Devices</div>
        {subscriber?.id ? (
          <div style={{ padding: '14px 18px', background: '#F8FAFC', borderRadius: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>CPE Device</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>MAC: {subscriber.id?.slice(0, 8) ?? '—'}</div>
            </div>
            <span style={{ padding: '4px 12px', borderRadius: 20, fontSize: '0.75rem', fontWeight: 600, background: '#e6f9ed', color: '#1db954' }}>Active</span>
          </div>
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No devices registered</p>
        )}
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <button className="btn-outline" onClick={() => { logout(); router.push('/login'); }} style={{ color: '#DC2626', borderColor: '#DC2626' }}>Logout</button>
      </div>

      {showPw && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}
          onClick={() => setShowPw(false)}>
          <div style={{ background: 'white', padding: 32, width: 440, maxWidth: '95vw', height: '100vh', overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.1)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Change Password</h2>
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
