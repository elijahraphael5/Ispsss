'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api } from '@isp/shared';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await api('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }), skipAuth: true });
      setSent(true);
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-left">
        <div className="login-quote-header">Customer Portal</div>
        <div className="login-quote">
          <h1>Forgot<br />Your<br />Password?</h1>
          <p>No worries. We&apos;ll send you a link to reset it.</p>
        </div>
      </div>

      <div className="login-right">
        <Link href="/login" className="brand" style={{ textDecoration: 'none' }}>
          <span className="brand-dot"></span>
          <span>Hikonnect</span>
        </Link>

        <div className="login-form-wrapper">
          {sent ? (
            <div style={{ textAlign: 'center' }}>
              <div className="login-form-header">
                <h2>Check Your Email</h2>
                <p>If an account exists for {email}, you&apos;ll receive a reset link shortly.</p>
              </div>
              <Link href="/login" className="login-btn login-btn-primary" style={{ textDecoration: 'none', display: 'block' }}>
                Back to Login
              </Link>
            </div>
          ) : (
            <>
              <div className="login-form-header">
                <h2>Reset Password</h2>
                <p>Enter your email and we&apos;ll send you a reset link</p>
              </div>

              <form onSubmit={handleSubmit}>
                {error && <div className="login-error">{error}</div>}

                <div className="login-form-group">
                  <label>Email</label>
                  <div className="login-input-wrap">
                    <input type="email" placeholder="Enter your email" value={email} onChange={e => setEmail(e.target.value)} required />
                  </div>
                </div>

                <button type="submit" className="login-btn login-btn-primary" disabled={loading}>
                  {loading ? 'Sending...' : 'Send Reset Link'}
                </button>
              </form>

              <p style={{ textAlign: 'center', marginTop: 16 }}>
                <Link href="/login" className="login-forgot">Back to Login</Link>
              </p>
            </>
          )}
        </div>

        <div className="login-footer">
          &nbsp;
        </div>
      </div>
    </div>
  );
}
