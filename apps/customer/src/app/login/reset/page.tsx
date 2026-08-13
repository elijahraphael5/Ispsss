'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@isp/shared';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [token, setToken] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get('token') ?? '');
  }, []);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError('Passwords do not match'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters'); return; }
    setLoading(true);
    setError('');
    try {
      await api('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }), skipAuth: true });
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Invalid or expired reset link');
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="login-page">
      <div className="login-left">
        <div className="login-quote-header">Customer Portal</div>
        <div className="login-quote">
          <h1>Invalid<br />Link</h1>
          <p>This reset link is missing or invalid.</p>
        </div>
      </div>
        <div className="login-right">
          <div className="login-form-wrapper">
            <div className="login-form-header">
              <h2>Invalid Link</h2>
              <p>Please request a new password reset link.</p>
            </div>
            <Link href="/login/forgot" className="login-btn login-btn-primary" style={{ textDecoration: 'none', display: 'block' }}>
              Request New Link
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-left">
        <div className="login-quote-header">Customer Portal</div>
        <div className="login-quote">
          <h1>Set a New<br />Password</h1>
          <p>Choose a strong password you haven&apos;t used before.</p>
        </div>
      </div>

      <div className="login-right">
        <Link href="/login" className="brand" style={{ textDecoration: 'none' }}>
          <span className="brand-dot"></span>
          <span>Hikonnect</span>
        </Link>

        <div className="login-form-wrapper">
          {success ? (
            <div style={{ textAlign: 'center' }}>
              <div className="login-form-header">
                <h2>Password Updated</h2>
                <p>Your password has been reset successfully.</p>
              </div>
              <Link href="/login" className="login-btn login-btn-primary" style={{ textDecoration: 'none', display: 'block' }}>
                Sign In
              </Link>
            </div>
          ) : (
            <>
              <div className="login-form-header">
                <h2>New Password</h2>
                <p>Enter your new password below</p>
              </div>

              <form onSubmit={handleSubmit}>
                {error && <div className="login-error">{error}</div>}

                <div className="login-form-group">
                  <label>New Password</label>
                  <div className="login-input-wrap">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Enter new password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                      minLength={6}
                    />
                  </div>
                </div>

                <div className="login-form-group">
                  <label>Confirm Password</label>
                  <div className="login-input-wrap">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Confirm new password"
                      value={confirm}
                      onChange={e => setConfirm(e.target.value)}
                      required
                    />
                    <div className="login-toggle-pw" onClick={() => setShowPassword(!showPassword)}>
                      {showPassword ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>
                        </svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                        </svg>
                      )}
                    </div>
                  </div>
                </div>

                <button type="submit" className="login-btn login-btn-primary" disabled={loading}>
                  {loading ? 'Resetting...' : 'Reset Password'}
                </button>
              </form>
            </>
          )}
        </div>

        <div className="login-footer">
          <Link href="/login">Back to Login</Link>
        </div>
      </div>
    </div>
  );
}
