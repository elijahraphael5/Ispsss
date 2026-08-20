'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore, api } from '@isp/shared';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { setAccessToken, setUser } = useAuthStore();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await api<{ accessToken?: string; twoFaRequired?: boolean; userId?: string }>(
        '/auth/login',
        { method: 'POST', body: JSON.stringify({ email, password }), skipAuth: true },
      );
      if (result.accessToken) {
        setAccessToken(result.accessToken);
        const user = await api<any>('/auth/me');
        setUser(user);
        router.push('/');
      } else if (result.twoFaRequired) {
        router.push(`/login/2fa?userId=${result.userId}`);
      }
    } catch (err: any) {
      setError(err.message || 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', backgroundColor: '#F7F7F8', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <div style={{ flex: 1, maxWidth: 600, padding: '48px 64px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', backgroundColor: '#F7F7F8' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <img src="/logo.png" alt="Hikonnect" style={{ height: 36, width: 'auto' }} />
        </div>

        <div style={{ maxWidth: 380, width: '100%', margin: 'auto 0' }}>
          <h1 style={{ fontSize: '2.6rem', fontWeight: 800, lineHeight: 1.15, color: '#111', marginBottom: 16 }}>
            Manage Your Network, <span style={{ color: '#FF6224', fontStyle: 'italic' }}>Smarter</span>
          </h1>
          <p style={{ color: '#7A7D85', fontSize: '0.9rem', lineHeight: 1.5, fontWeight: 500, marginBottom: 32 }}>
            A simple and powerful tool designed to help ISPs run smoother, faster, and smarter, all in one place.
          </p>

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 14 }}>
              <input
                type="email"
                placeholder="Email Address"
                value={email}
                onChange={e => setEmail(e.target.value)}
                style={{ width: '100%', padding: '14px 16px', backgroundColor: '#fff', border: '1px solid #EAEAEA', borderRadius: 10, fontSize: '0.9rem', color: '#111', outline: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.02)', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ marginBottom: 14, position: 'relative' }}>
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                style={{ width: '100%', padding: '14px 16px', backgroundColor: '#fff', border: '1px solid #EAEAEA', borderRadius: 10, fontSize: '0.9rem', color: '#111', outline: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.02)', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem', marginTop: 16, marginBottom: 28 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#111', fontWeight: 600, cursor: 'pointer' }}>
                <input type="checkbox" defaultChecked style={{ width: 16, height: 16, accentColor: '#FF6224' }} />
                Remember me
              </label>
              <a href="#" style={{ color: '#111', textDecoration: 'none', fontWeight: 600 }}>Forgot Password ?</a>
            </div>

            {error && (
              <div style={{ backgroundColor: '#fde8e8', border: '1px solid #e53e3e', borderRadius: 10, padding: '12px 16px', marginBottom: 18, color: '#e53e3e', fontSize: '0.85rem' }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{ width: 130, padding: 12, backgroundColor: loading ? '#E5521A' : '#FF6224', color: '#fff', border: 'none', borderRadius: 10, fontSize: '0.9rem', fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', boxShadow: '0 4px 12px rgba(255, 98, 36, 0.25)' }}
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>

        <div style={{ fontSize: '0.75rem', color: '#7A7D85', lineHeight: 1.4 }}>
          &copy; {new Date().getFullYear()} Hi-Konnect Networks
        </div>
      </div>

      <div style={{ flex: 1, backgroundColor: '#000', position: 'relative', overflow: 'hidden' }}>
        <div style={{ width: '100%', height: '100%', position: 'relative', background: '#050201' }}>
          <div style={{ position: 'absolute', width: 600, height: 500, top: -120, left: -100, borderRadius: '50%', border: '80px solid #E04200', filter: 'drop-shadow(0 0 40px #FF5500)', boxShadow: 'inset 0 0 50px #000, 0 0 50px #000', borderColor: '#D33A00 #D33A00 transparent transparent', transform: 'rotate(-20deg)' }}></div>
          <div style={{ position: 'absolute', width: 700, height: 600, bottom: -150, right: -120, borderRadius: '50%', border: '80px solid #D33A00', filter: 'drop-shadow(0 0 40px #FF5500)', boxShadow: 'inset 0 0 50px #000, 0 0 50px #000', borderColor: 'transparent transparent #D33A00 #D33A00', transform: 'rotate(15deg)' }}></div>
          <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 10% 10%, rgba(255, 98, 36, 0.35) 0%, transparent 40%), radial-gradient(circle at 90% 90%, rgba(255, 98, 36, 0.3) 0%, transparent 50%), linear-gradient(to right, rgba(0,0,0,0.5) 0%, transparent 100%)', pointerEvents: 'none' }}></div>
        </div>
      </div>
    </div>
  );
}
