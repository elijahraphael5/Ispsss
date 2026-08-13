'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore, api } from '@isp/shared';

function CallbackContent() {
  const { accessToken } = useAuthStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'processing' | 'success' | 'failed'>('processing');

  useEffect(() => {
    if (!accessToken) {
      if (typeof window !== 'undefined' && !localStorage.getItem('accessToken')) router.push('/login');
      return;
    }

    const ref = searchParams.get('reference') || searchParams.get('paymentCode') || '';
    const result = searchParams.get('status') || '';
    const txRef = searchParams.get('trxref') || searchParams.get('reference') || '';

    const processPayment = async () => {
      try {
        await api('/payments/webhook/paysorta', {
          method: 'POST',
          body: JSON.stringify({
            reference: ref || txRef,
            status: result === 'success' ? 'success' : 'failed',
            metadata: { providerReference: searchParams.get('transaction') || txRef },
          }),
          skipAuth: true,
        });
        setStatus(result === 'success' ? 'success' : 'failed');
      } catch {
        setStatus('failed');
      }
    };

    processPayment();
  }, [accessToken, router, searchParams]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 20 }}>
      {status === 'processing' && (
        <>
          <div style={{ width: 40, height: 40, border: '3px solid #e2e8f0', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <p style={{ color: 'var(--text-muted)' }}>Processing your payment...</p>
        </>
      )}
      {status === 'success' && (
        <>
          <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#e6f9ed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="24" height="24" fill="none" stroke="#16A34A" strokeWidth="3" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <h2 style={{ fontSize: '1.3rem', fontWeight: 700 }}>Payment Successful</h2>
          <p style={{ color: 'var(--text-muted)' }}>Your payment has been processed. Check your billing page for details.</p>
          <div style={{ display: 'flex', gap: 12 }}>
            <button className="btn-primary" onClick={() => router.push('/billing')}>View Billing</button>
            <button className="btn-primary" style={{ background: '#8B5CF6' }} onClick={() => router.push('/payments')}>View Payments</button>
          </div>
        </>
      )}
      {status === 'failed' && (
        <>
          <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#fde8e8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="24" height="24" fill="none" stroke="#DC2626" strokeWidth="3" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </div>
          <h2 style={{ fontSize: '1.3rem', fontWeight: 700 }}>Payment Failed</h2>
          <p style={{ color: 'var(--text-muted)' }}>Your payment did not go through. Please try again.</p>
          <button className="btn-primary" onClick={() => router.push('/subscription')}>Try Again</button>
        </>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}

export default function PaymentCallbackPage() {
  return (
    <Suspense fallback={
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ width: 40, height: 40, border: '3px solid #e2e8f0', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      </div>
    }>
      <CallbackContent />
    </Suspense>
  );
}
