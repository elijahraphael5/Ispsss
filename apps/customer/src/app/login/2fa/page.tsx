'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore, api } from '@isp/shared';

function TwoFactorForm() {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const router = useRouter();
  const params = useSearchParams();
  const userId = params.get('userId') ?? '';
  const email = params.get('email') ?? '';
  const { setAccessToken, setUser } = useAuthStore();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await api<{ accessToken: string }>('/auth/2fa/verify', {
        method: 'POST', body: JSON.stringify({ userId, token }), skipAuth: true,
      });
      setAccessToken(result.accessToken);
      const user = await api<any>('/auth/me');
      setUser(user);
      router.push('/');
    } catch (err: any) {
      setError(err.message || 'Invalid code');
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    setResending(true);
    setError('');
    setNotice('');
    try {
      await api('/auth/2fa/resend', { method: 'POST', body: JSON.stringify({ userId }), skipAuth: true });
      setNotice('A new code has been emailed to you.');
    } catch (err: any) {
      setError(err.message || 'Could not resend the code');
    } finally {
      setResending(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F7F7F8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <div style={{ backgroundColor: '#fff', borderRadius: 20, padding: '44px 36px', width: 400, maxWidth: '92vw', boxShadow: '0 8px 32px rgba(0,0,0,0.06)' }}>
        <div style={{ textAlign: 'center', marginBottom: 30 }}>
          <img src="/logo.png" alt="Hikonnect" style={{ height: 34, width: 'auto', marginBottom: 18 }} />
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0, color: '#111' }}>Two-Factor Auth</h1>
          <p style={{ color: '#7A7D85', fontSize: '0.88rem', marginTop: 8, lineHeight: 1.5 }}>
            {email ? <>We emailed a 6-digit code to <strong style={{ color: '#111' }}>{email}</strong></> : 'Enter the 6-digit code we emailed you'}
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <label style={{ display: 'block', color: '#7A7D85', fontSize: '0.8rem', fontWeight: 600, marginBottom: 6 }}>Email Code</label>
          <input
            placeholder="000000"
            value={token}
            onChange={e => setToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
            style={{ width: '100%', padding: '13px 16px', borderRadius: 12, border: '1px solid #EAEAEA', fontSize: '1.1rem', outline: 'none', textAlign: 'center', letterSpacing: 8, boxSizing: 'border-box', marginBottom: 16 }}
            maxLength={6}
            inputMode="numeric"
            autoFocus
          />

          {notice && <div style={{ background: '#F0FDF4', color: '#16A34A', fontSize: '0.82rem', padding: '10px 14px', borderRadius: 10, marginBottom: 14, textAlign: 'center' }}>{notice}</div>}
          {error && <div style={{ background: '#FEF2F2', color: '#DC2626', fontSize: '0.82rem', padding: '10px 14px', borderRadius: 10, marginBottom: 14, textAlign: 'center' }}>{error}</div>}

          <button type="submit" disabled={loading || token.length < 6}
            style={{ width: '100%', padding: '13px', borderRadius: 20, border: 'none', backgroundColor: '#FF6224', color: '#fff', fontWeight: 700, fontSize: '0.95rem', cursor: loading || token.length < 6 ? 'not-allowed' : 'pointer', opacity: loading || token.length < 6 ? 0.7 : 1 }}>
            {loading ? 'Verifying...' : 'Verify'}
          </button>

          <div style={{ textAlign: 'center', marginTop: 14 }}>
            <button type="button" onClick={resend} disabled={resending}
              style={{ background: 'none', border: 'none', color: '#7A7D85', fontSize: '0.82rem', cursor: resending ? 'not-allowed' : 'pointer', textDecoration: 'underline' }}>
              {resending ? 'Sending...' : 'Resend code'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function TwoFactorPage() {
  return <Suspense fallback={<div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7A7D85' }}>Loading...</div>}><TwoFactorForm /></Suspense>;
}
