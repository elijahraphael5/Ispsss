'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore, api, formatNaira } from '@isp/shared';
import { SkeletonBlock, SkeletonTable } from '../components/Skeleton';

function fmtK(k: number) { return formatNaira(k); }
function fmtD(d: string) { return new Date(d).toLocaleDateString('en-GB'); }

const STATUS_COLORS: Record<string, string> = {
  DRAFT: '#6B7280', ISSUED: '#2563EB', PAID: '#16A34A', OVERDUE: '#DC2626', VOID: '#94A3B8',
  PENDING: '#CA8A04', SUCCESSFUL: '#16A34A', FAILED: '#DC2626', REFUNDED: '#8B5CF6',
};

function badge(label: string, color: string) {
  return <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600, backgroundColor: color + '18', color }}>{label}</span>;
}

interface Invoice {
  id: string; invoiceNumber: string; type: string; status: string; amountKobo: number; dueAt: string; paidAt: string | null;
  lines: { description: string; amountKobo: number; quantity: number }[];
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

interface DashboardData {
  outstandingKobo: number;
  lastInvoice: { id: string; amountKobo: number; status: string; dueAt: string } | null;
}

const TABS = ['Invoices', 'Payments', 'Receipts'] as const;
type Tab = (typeof TABS)[number];

function loadPaystackInline(): Promise<void> {
  if ((window as any).PaystackPop) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://js.paystack.co/v1/inline.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Paystack'));
    document.body.appendChild(s);
  });
}

export default function BillingPage() {
  const { accessToken, user } = useAuthStore();
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDetail, setShowDetail] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>('Invoices');
  const [paying, setPaying] = useState(false);
  const [paystackKey, setPaystackKey] = useState(process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY ?? '');

  useEffect(() => {
    if (!accessToken) return;
    api<{ paystackPublicKey: string | null }>('/tenant/public-config')
      .then((c) => { if (c?.paystackPublicKey) setPaystackKey(c.paystackPublicKey); })
      .catch(() => {});
  }, [accessToken]);

  async function payInvoice(inv: Invoice) {
    setPaying(true);
    try {
      const res = await api<{ authorizationUrl: string; reference: string; amountKobo: number }>('/payments/customer/initialize', {
        method: 'POST',
        body: JSON.stringify({ action: 'pay_invoice', invoiceId: inv.id }),
      });
      if (!res?.reference) throw new Error('Payment initialization failed');

      await loadPaystackInline();
      const handler = (window as any).PaystackPop.setup({
        key: paystackKey,
        email: user?.email ?? '',
        amount: res.amountKobo,
        currency: 'NGN',
        ref: res.reference,
        metadata: { action: 'pay_invoice', invoiceId: inv.id },
        callback: () => router.push('/payment/callback?reference=' + encodeURIComponent(res.reference)),
        onClose: () => setPaying(false),
      });
      handler.openIframe();
    } catch (err: any) {
      alert(err?.message ?? 'Could not start payment. Please try again.');
      setPaying(false);
    }
  }

  const fetchData = async () => {
    const [d, inv, p, r] = await Promise.all([
      api<DashboardData>('/customer/dashboard').catch(() => null),
      api<Invoice[]>('/customer/invoices').catch(() => []),
      api<Payment[]>('/customer/payments').catch(() => []),
      api<Receipt[]>('/customer/receipts').catch(() => []),
    ]);
    if (d) setData(d);
    setInvoices(inv);
    setPayments(p);
    setReceipts(r);
  };

  useEffect(() => {
    if (!accessToken) {
      if (typeof window !== 'undefined' && !localStorage.getItem('accessToken')) router.push('/login');
      return;
    }
    fetchData().finally(() => setLoading(false));
  }, [accessToken, router]);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t && (TABS as readonly string[]).includes(t)) setTab(t as Tab);
  }, []);

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
        <div className="grid-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="data-card" style={{ padding: 24, height: 90 }} />)}
        </div>
        <div className="data-card" style={{ padding: 24 }}>
          <SkeletonTable rows={6} cols={5} />
        </div>
      </div>
    );
  }

  const d = data;
  const totalPaid = receipts.reduce((s, r) => s + r.amountKobo, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 700 }}>Billing & Payments</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Invoices, payments and receipts in one place</p>
      </div>

      <div className="grid-4">
        <div className="data-card" style={{ padding: '18px 20px' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Outstanding Balance</div>
          <div style={{ fontSize: '1.3rem', fontWeight: 700, color: (d?.outstandingKobo ?? 0) > 0 ? '#DC2626' : '#16A34A' }}>{d ? fmtK(d.outstandingKobo) : '—'}</div>
        </div>
        <div className="data-card" style={{ padding: '18px 20px' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Latest Invoice</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{d?.lastInvoice ? fmtK(d.lastInvoice.amountKobo) : '—'}</div>
          {d?.lastInvoice && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{badge(d.lastInvoice.status, STATUS_COLORS[d.lastInvoice.status] ?? '#6B7280')}</div>}
        </div>
        <div className="data-card" style={{ padding: '18px 20px' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Next Due Date</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{d?.lastInvoice?.dueAt ? fmtD(d.lastInvoice.dueAt) : '—'}</div>
        </div>
        <div className="data-card" style={{ padding: '18px 20px' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Total Paid</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#16A34A' }}>{fmtK(totalPaid)}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="tabs-scroll">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '8px 18px', borderRadius: 20, border: '1px solid var(--border-color)', cursor: 'pointer',
              fontWeight: 600, fontSize: '0.8rem', background: tab === t ? 'var(--primary)' : '#fff',
              color: tab === t ? '#fff' : 'var(--text-color)',
            }}>{t}</button>
          ))}
        </div>
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

      {tab === 'Invoices' && (
        <div className="data-card" style={{ padding: 0 }}>
          <div className="table-container">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Due Date</th>
                    <th style={{ width: 80 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.length === 0 ? (
                    <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>No invoices found</td></tr>
                  ) : invoices.map(inv => (
                    <tr key={inv.id} onClick={() => setShowDetail(inv.id)} style={{ cursor: 'pointer' }}>
                      <td style={{ fontWeight: 600, fontSize: '0.85rem' }}>{inv.invoiceNumber}</td>
                      <td style={{ fontWeight: 600 }}>{fmtK(inv.amountKobo)}</td>
                      <td>{badge(inv.status, STATUS_COLORS[inv.status] ?? '#6B7280')}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{fmtD(inv.dueAt)}</td>
                      <td>
                        {inv.status === 'ISSUED' || inv.status === 'OVERDUE' ? (
                          <button className="btn-sm" disabled={paying} onClick={(e) => { e.stopPropagation(); void payInvoice(inv); }}>
                            {paying ? 'Starting…' : 'Pay Now'}
                          </button>
                        ) : (
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'Payments' && (
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
                      <td>{badge(p.provider, '#6366F1')}</td>
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

      {tab === 'Receipts' && (
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
                      <td>{badge(r.paymentMethod, '#6366F1')}</td>
                      <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{fmtD(r.paidAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {showDetail && (() => {
        const inv = invoices.find(i => i.id === showDetail);
        if (!inv) return null;
        return (
          <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}
            onClick={() => setShowDetail(null)}>
            <div style={{ background: 'white', padding: 32, width: 520, maxWidth: '95vw', height: '100vh', overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.1)' }}
              onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <div>
                  <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>{inv.invoiceNumber}</h2>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{inv.type} Invoice</span>
                </div>
                <span style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setShowDetail(null)}>
                  <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </span>
              </div>
              <div style={{ marginBottom: 16 }}>{badge(inv.status, STATUS_COLORS[inv.status] ?? '#6B7280')}</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', marginBottom: 16 }}>
                <thead><tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>Description</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>Qty</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>Amount</th>
                </tr></thead>
                <tbody>
                  {inv.lines.map((l, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '8px 12px' }}>{l.description}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>{l.quantity}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>{fmtK(l.amountKobo * l.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ fontSize: '1rem', fontWeight: 700, textAlign: 'right', marginBottom: 20 }}>
                Total: <span style={{ color: 'var(--primary)' }}>{fmtK(inv.amountKobo)}</span>
              </div>
              {inv.status === 'ISSUED' || inv.status === 'OVERDUE' ? (
                <button className="btn-primary" disabled={paying} onClick={() => void payInvoice(inv)} style={{ width: '100%', justifyContent: 'center' }}>
                  {paying ? 'Starting…' : 'Pay Now'}
                </button>
              ) : null}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
