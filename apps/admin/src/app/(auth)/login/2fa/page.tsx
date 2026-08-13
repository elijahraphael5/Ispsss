'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore, api } from '@isp/shared';

function TwoFactorForm() {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const params = useSearchParams();
  const userId = params.get('userId') ?? '';
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

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#121316', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <div style={{ backgroundColor: '#18191c', borderRadius: 20, padding: '48px 40px', width: 400, border: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ backgroundColor: '#202226', padding: '8px 18px', borderRadius: 20, display: 'inline-flex', alignItems: 'center', marginBottom: 24 }}>
            <img src="/logo.png" alt="Hikonnect" style={{ height: 30, width: 'auto' }} />
          </div>
          <h1 style={{ color: '#f8f9fa', fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Two-Factor Auth</h1>
          <p style={{ color: '#9ea3a8', fontSize: '0.9rem', marginTop: 6 }}>Enter the code from your authenticator app</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', color: '#9ea3a8', fontSize: '0.85rem', fontWeight: 600, marginBottom: 6 }}>Authentication Code</label>
            <input
              placeholder="000000"
              value={token}
              onChange={e => setToken(e.target.value)}
              style={{ width: '100%', padding: '12px 16px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)', backgroundColor: '#202226', color: '#f8f9fa', fontSize: '0.9rem', outline: 'none', textAlign: 'center', letterSpacing: 8, boxSizing: 'border-box' }}
              maxLength={6}
            />
          </div>

          {error && (
            <div style={{ backgroundColor: '#2d1b1b', border: '1px solid #e53e3e', borderRadius: 12, padding: '12px 16px', marginBottom: 18, color: '#fc8181', fontSize: '0.85rem' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{ width: '100%', padding: '12px', borderRadius: 12, border: 'none', backgroundColor: loading ? '#d94a1b' : '#F15925', color: '#fff', fontWeight: 700, fontSize: '0.95rem', cursor: loading ? 'not-allowed' : 'pointer' }}
          >
            {loading ? 'Verifying...' : 'Verify'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function TwoFactorPage() {
  return <Suspense fallback={<div style={{ minHeight: '100vh', backgroundColor: '#121316', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ea3a8', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Loading...</div>}><TwoFactorForm /></Suspense>;
}
