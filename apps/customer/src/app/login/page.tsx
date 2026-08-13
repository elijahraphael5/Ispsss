'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore, api } from '@isp/shared';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { setAccessToken, setUser } = useAuthStore();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('registered') === '1') setSuccess('Account created successfully. Sign in below.');
  }, []);

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
    <div className="login-page">
      <div className="login-left">
        <div className="login-quote-header">Customer Portal</div>
        <div className="login-quote">
          <h1>Your<br />Internet,<br />Your Way</h1>
          <p>Manage your subscription, track usage, pay bills, and get support — all from one place.</p>
        </div>
      </div>

      <div className="login-right">
        <div className="brand">
          <img src="/logo.png" alt="Hikonnect" style={{ height: 32, width: 'auto' }} />
        </div>

        <div className="login-form-wrapper">
          <div className="login-form-header">
            <h2>Welcome Back</h2>
            <p>Enter your email and password to access your account</p>
          </div>

          <form onSubmit={handleSubmit}>
            {success && <div style={{ background: '#f0fdf4', color: '#16a34a', fontSize: '0.8rem', padding: '10px 14px', borderRadius: 8, marginBottom: 16, textAlign: 'center' }}>{success}</div>}
            {error && <div className="login-error">{error}</div>}

            <div className="login-form-group">
              <label>Email</label>
              <div className="login-input-wrap">
                <input type="email" placeholder="Enter your email" value={email} onChange={e => setEmail(e.target.value)} required />
              </div>
            </div>

            <div className="login-form-group">
              <label>Password</label>
              <div className="login-input-wrap">
                <input type={showPassword ? 'text' : 'password'} placeholder="Enter your password" value={password} onChange={e => setPassword(e.target.value)} required />
                <div className="login-toggle-pw" onClick={() => setShowPassword(!showPassword)}>
                  {showPassword ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </div>
              </div>
            </div>

            <div className="login-actions">
              <label className="login-remember"><input type="checkbox" /> Remember me</label>
              <Link href="/login/forgot" className="login-forgot">Forgot Password</Link>
            </div>

            <button type="submit" className="login-btn login-btn-primary" disabled={loading}>
              {loading ? 'Signing In...' : 'Sign In'}
            </button>
          </form>

          <p style={{ fontSize: '0.75rem', color: '#999', textAlign: 'center', marginTop: 4 }}>
            By signing in you agree to our Terms of Service
          </p>
        </div>

        <div className="login-footer">
          &nbsp;
        </div>
      </div>
    </div>
  );
}
