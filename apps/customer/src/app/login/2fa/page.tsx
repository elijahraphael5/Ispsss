'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore, api } from '@isp/shared';

function TwoFactorForm() {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();
  const params = useSearchParams();
  const userId = params.get('userId') ?? '';
  const { setAccessToken, setUser } = useAuthStore();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
    }
  }

  return (
    <main style={{ maxWidth: 400, margin: '100px auto', padding: 24 }}>
      <h1>Two-Factor Auth</h1>
      <form onSubmit={handleSubmit}>
        <input placeholder="Authenticator code" value={token} onChange={e => setToken(e.target.value)} style={{ display: 'block', width: '100%', marginBottom: 12, padding: 8 }} />
        {error && <p style={{ color: 'red' }}>{error}</p>}
        <button type="submit" style={{ padding: '8px 24px' }}>Verify</button>
      </form>
    </main>
  );
}

export default function TwoFactorPage() {
  return <Suspense fallback={<p>Loading...</p>}><TwoFactorForm /></Suspense>;
}
