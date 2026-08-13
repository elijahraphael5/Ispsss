'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore, api } from '@isp/shared';
import { SkeletonBlock, SkeletonTable } from '../components/Skeleton';

function fmtK(k: number) { return `\u20A6${(k / 100).toLocaleString()}`; }
function fmtD(d: string) { return new Date(d).toLocaleDateString('en-GB'); }

function badge(label: string, color: string, bg?: string) {
  return <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600, backgroundColor: bg ?? color + '18', color }}>{label}</span>;
}

interface Payment {
  id: string; amountKobo: number; reference: string; provider: string; status: string; paidAt: string | null;
  invoice: { invoiceNumber: string } | null;
  createdAt: string;
}

interface Receipt {
  id: string; receiptNumber: string; amountKobo: number; paymentMethod: string; paidAt: string;
  invoice: { invoiceNumber: string } | null;
}

export default function PaymentsPage() {
  const { accessToken } = useAuthStore();
  const router = useRouter();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'payments' | 'receipts'>('payments');
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async () => {
    const [p, r] = await Promise.all([
      api<Payment[]>('/customer/payments').catch(() => []),
      api<Receipt[]>('/customer/receipts').catch(() => []),
    ]);
    setPayments(p); setReceipts(r);
  };

  useEffect(() => {
    if (!accessToken) {
      if (typeof window !== 'undefined' && !localStorage.getItem('accessToken')) router.push('/login');
      return;
    }
    fetchData().finally(() => setLoading(false));
  }, [accessToken, router]);

  // Auto-refresh on focus
  useEffect(() => {
    const onFocus = () => { fetchData(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  if (!accessToken) return null;

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <SkeletonBlock width={200} height={28} />
        <div style={{ display: 'flex', gap: 8 }}>{Array.from({ length: 2 }).map((_, i) => <SkeletonBlock key={i} width={120} height={34} borderRadius={20} />)}</div>
        <div className="data-card" style={{ padding: 24 }}><SkeletonTable rows={6} cols={6} /></div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 700 }}>Payments</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Payment history and receipts</p>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {(['payments', 'receipts'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '8px 18px', borderRadius: 20, border: '1px solid var(--border-color)', cursor: 'pointer',
            fontWeight: 600, fontSize: '0.8rem', background: tab === t ? 'var(--primary)' : '#fff',
            color: tab === t ? '#fff' : 'var(--text-color)', textTransform: 'capitalize',
          }}>{t === 'payments' ? 'Payments' : 'Receipts'}</button>
        ))}
        <button onClick={async () => { setRefreshing(true); await fetchData(); setRefreshing(false); }}
          style={{ marginLeft: 'auto', padding: '8px 16px', borderRadius: 20, border: '1px solid var(--border-color)',
            cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem', background: '#fff', display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
            style={{ animation: refreshing ? 'spin 0.8s linear infinite' : 'none' }}>
            <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
          Refresh
        </button>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>

      {tab === 'payments' && (
        <div className="data-card" style={{ padding: 0 }}>
          <div className="table-container">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Invoice</th>
                    <th>Amount</th>
                    <th>Method</th>
                    <th>Status</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.length === 0 ? (
                    <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>No payments found</td></tr>
                  ) : payments.map(p => (
                    <tr key={p.id}>
                      <td style={{ fontSize: '0.8rem', fontFamily: 'monospace' }}>{p.reference.slice(0, 16)}...</td>
                      <td style={{ fontWeight: 600, fontSize: '0.85rem' }}>{p.invoice?.invoiceNumber ?? '—'}</td>
                      <td style={{ fontWeight: 600 }}>{fmtK(p.amountKobo)}</td>
                      <td>{badge(p.provider, '#6366F1', '#EEF2FF')}</td>
                      <td>{badge(p.status, p.status === 'SUCCESSFUL' ? '#16A34A' : p.status === 'PENDING' ? '#CA8A04' : '#DC2626')}</td>
                      <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{p.paidAt ? fmtD(p.paidAt) : fmtD(p.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'receipts' && (
        <div className="data-card" style={{ padding: 0 }}>
          <div className="table-container">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Receipt #</th>
                    <th>Invoice</th>
                    <th>Amount</th>
                    <th>Method</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {receipts.length === 0 ? (
                    <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>No receipts found</td></tr>
                  ) : receipts.map(r => (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 600, fontSize: '0.85rem' }}>{r.receiptNumber}</td>
                      <td>{r.invoice?.invoiceNumber ?? '—'}</td>
                      <td style={{ fontWeight: 600 }}>{fmtK(r.amountKobo)}</td>
                      <td>{badge(r.paymentMethod, '#6366F1', '#EEF2FF')}</td>
                      <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{fmtD(r.paidAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
