'use client';

import { useState, useEffect } from 'react';
import { api, formatNaira } from '@isp/shared';

/* ── Types ────────────────────────────────────────────────── */

interface DashboardData {
  revenueToday: number;
  revenueThisWeek: number;
  revenueThisMonth: number;
  revenueThisYear: number;
  payments: { successful: number; failed: number; pending: number; refunded: number };
  gatewayStats: { provider: string; count: number }[];
}

interface Payment {
  id: string;
  invoiceId: string;
  provider: string;
  status: string;
  amountKobo: number;
  reference: string;
  providerReference: string | null;
  feesKobo: number;
  paidAt: string | null;
  invoice: { id: string; invoiceNumber: string; amountKobo: number; subscriber: { user: { email: string } } } | null;
  refunds: { id: string; amountKobo: number; status: string }[];
  createdAt: string;
}

interface RefundItem {
  id: string;
  refundNumber: string;
  amountKobo: number;
  reason: string | null;
  status: string;
  payment: { reference: string; amountKobo: number; invoice: { invoiceNumber: string } };
  createdAt: string;
}

/* ── Helpers ──────────────────────────────────────────────── */

const STATUS_COLORS: Record<string, string> = {
  PENDING: '#CA8A04', SUCCESSFUL: '#16A34A', FAILED: '#DC2626', REFUNDED: '#8B5CF6',
  APPROVED: '#2563EB', REJECTED: '#DC2626', PROCESSED: '#16A34A', COMPLETED: '#16A34A',
};

function fmtK(k: number) { return formatNaira(k); }
function fmtD(d: string) { return new Date(d).toLocaleDateString('en-GB'); }
function badge(label: string, color?: string, bg?: string) {
  const c = STATUS_COLORS[label] ?? color ?? '#6B7280';
  return <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600, backgroundColor: bg ?? (c + '18'), color: c }}>{label}</span>;
}

const TABS = ['Payments', 'Refunds', 'Reconciliation'];
const inp: React.CSSProperties = { width: '100%', padding: '9px 12px', border: '1px solid var(--border-color)', borderRadius: 10, fontSize: '0.85rem', outline: 'none' };
const sel: React.CSSProperties = { ...inp, background: 'white' };

/* ── Component ────────────────────────────────────────────── */

export default function PaymentsPage() {
  const [tab, setTab] = useState('Payments');
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [refunds, setRefunds] = useState<RefundItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // filters
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [search, setSearch] = useState('');

  // drawers
  const [showDetail, setShowDetail] = useState<string | null>(null);
  const [showRecordPayment, setShowRecordPayment] = useState(false);
  const [recordForm, setRecordForm] = useState({ invoiceId: '', amountKobo: 0, provider: 'BANK_TRANSFER', reference: '' });

  // refund drawer
  const [showRefundForm, setShowRefundForm] = useState(false);
  const [refundForm, setRefundForm] = useState({ paymentId: '', amountKobo: 0, reason: '' });

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    setLoading(true);
    try {
      const [d, p, r] = await Promise.all([
        api<DashboardData>('/payments/dashboard').catch(() => null),
        api<Payment[]>('/payments'),
        api<RefundItem[]>('/payments/refunds').catch(() => []),
      ]);
      if (d) setDash(d);
      setPayments(p);
      setRefunds(r);
    } catch { setError('Failed to load payments'); }
    finally { setLoading(false); }
  }

  async function requestRefund() {
    try {
      await api('/payments/refunds/request', {
        method: 'POST',
        body: JSON.stringify(refundForm),
      });
      setShowRefundForm(false);
      await fetchAll();
    } catch { setError('Failed to request refund'); }
  }

  async function approveRefund(id: string) {
    try { await api(`/payments/refunds/${id}/approve`, { method: 'PATCH' }); await fetchAll(); }
    catch { setError('Failed to approve refund'); }
  }

  async function processRefund(id: string) {
    try { await api(`/payments/refunds/${id}/process`, { method: 'PATCH' }); await fetchAll(); }
    catch { setError('Failed to process refund'); }
  }

  async function rejectRefund(id: string) {
    try { await api(`/payments/refunds/${id}/reject`, { method: 'PATCH' }); await fetchAll(); }
    catch { setError('Failed to reject refund'); }
  }

  const filteredPayments = payments.filter(p => {
    if (statusFilter !== 'ALL' && p.status !== statusFilter) return false;
    if (search && !p.reference.toLowerCase().includes(search.toLowerCase()) && !p.invoice?.invoiceNumber?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <>
      {/* Dashboard Metrics */}
      {tab === 'Payments' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
          <div className="data-card" style={{ padding: '18px 20px' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ display: 'inline', marginRight: 4 }}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              Today
            </div>
            <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--primary)' }}>{dash ? fmtK(dash.revenueToday) : '—'}</div>
          </div>
          <div className="data-card" style={{ padding: '18px 20px' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>This Week</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{dash ? fmtK(dash.revenueThisWeek) : '—'}</div>
          </div>
          <div className="data-card" style={{ padding: '18px 20px' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>This Month</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{dash ? fmtK(dash.revenueThisMonth) : '—'}</div>
          </div>
          <div className="data-card" style={{ padding: '18px 20px' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>This Year</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{dash ? fmtK(dash.revenueThisYear) : '—'}</div>
          </div>
        </div>
      )}

      {/* Status Summary */}
      {tab === 'Payments' && dash && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'Successful', value: dash.payments.successful, color: '#16A34A' },
            { label: 'Failed', value: dash.payments.failed, color: '#DC2626' },
            { label: 'Pending', value: dash.payments.pending, color: '#CA8A04' },
            { label: 'Refunded', value: dash.payments.refunded, color: '#8B5CF6' },
          ].map(s => (
            <div key={s.label} className="data-card" style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>{s.label}</span>
              <span style={{ fontSize: '1rem', fontWeight: 700, color: s.color }}>{s.value}</span>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div style={{ padding: '12px 16px', background: '#FEE2E2', color: '#DC2626', borderRadius: 12, marginBottom: 16, fontSize: '0.85rem' }}>
          {error} <button onClick={() => setError('')} style={{ marginLeft: 12, background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626', fontWeight: 600 }}>Dismiss</button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '8px 18px', borderRadius: 20, border: '1px solid var(--border-color)', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem', backgroundColor: tab === t ? 'var(--primary)' : '#fff', color: tab === t ? '#fff' : 'var(--text-color)' }}>
            {t}
          </button>
        ))}
        {tab === 'Payments' && <div style={{ flex: 1 }} />}
        {tab === 'Payments' && <button className="btn-primary" onClick={() => setShowRecordPayment(true)}>Record Payment</button>}
      </div>

      {/* ── Payments Tab ─────────────────────────────────── */}
      {tab === 'Payments' && (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search ref or invoice..." style={{ ...inp, maxWidth: 260 }} />
            <div style={{ display: 'flex', gap: 6 }}>
              {['ALL', 'SUCCESSFUL', 'PENDING', 'FAILED', 'REFUNDED'].map(s => (
                <button key={s} onClick={() => setStatusFilter(s)} style={{ padding: '5px 12px', borderRadius: 16, border: '1px solid var(--border-color)', cursor: 'pointer', fontWeight: statusFilter === s ? 600 : 400, fontSize: '0.75rem', background: statusFilter === s ? 'var(--primary)' : '#fff', color: statusFilter === s ? '#fff' : 'var(--text-color)' }}>
                  {s.charAt(0) + s.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="data-card" style={{ padding: 0 }}>
            <div className="table-container">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>REFERENCE</th>
                      <th>INVOICE</th>
                      <th>CUSTOMER</th>
                      <th>AMOUNT</th>
                      <th>METHOD</th>
                      <th>STATUS</th>
                      <th>DATE</th>
                      <th style={{ width: 60 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPayments.length === 0 ? (
                      <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>No payments found</td></tr>
                    ) : filteredPayments.map(p => (
                      <tr key={p.id} onClick={() => setShowDetail(p.id)} style={{ cursor: 'pointer' }}>
                        <td style={{ fontSize: '0.8rem', fontFamily: 'monospace', fontWeight: 600 }}>{p.reference.slice(0, 20)}...</td>
                        <td style={{ fontWeight: 600, fontSize: '0.85rem' }}>{p.invoice?.invoiceNumber ?? '—'}</td>
                        <td>{p.invoice?.subscriber?.user?.email ?? '—'}</td>
                        <td style={{ fontWeight: 600 }}>{fmtK(p.amountKobo)}</td>
                        <td>{badge(p.provider, '#6366F1', '#EEF2FF')}</td>
                        <td>{badge(p.status, STATUS_COLORS[p.status] ?? '#6B7280')}</td>
                        <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{p.paidAt ? fmtD(p.paidAt) : fmtD(p.createdAt)}</td>
                        <td onClick={e => e.stopPropagation()}>
                          {p.status === 'SUCCESSFUL' && (
                            <button className="btn-sm-outline" onClick={() => { setRefundForm({ paymentId: p.id, amountKobo: p.amountKobo, reason: '' }); setShowRefundForm(true); }}>
                              Refund
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Refunds Tab ──────────────────────────────────── */}
      {tab === 'Refunds' && (
        <div className="data-card" style={{ padding: 0 }}>
          <div className="table-container">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>REFUND #</th>
                    <th>INVOICE</th>
                    <th>AMOUNT</th>
                    <th>REASON</th>
                    <th>STATUS</th>
                    <th>DATE</th>
                    <th style={{ width: 120 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {refunds.length === 0 ? (
                    <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>No refunds</td></tr>
                  ) : refunds.map(r => (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 600, fontSize: '0.85rem' }}>{r.refundNumber}</td>
                      <td>{r.payment?.invoice?.invoiceNumber ?? '—'}</td>
                      <td style={{ fontWeight: 600 }}>{fmtK(r.amountKobo)}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.reason ?? '—'}</td>
                      <td>{badge(r.status, STATUS_COLORS[r.status] ?? '#6B7280')}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{fmtD(r.createdAt)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {r.status === 'PENDING' && <button className="btn-sm" onClick={() => approveRefund(r.id)}>Approve</button>}
                          {r.status === 'APPROVED' && <button className="btn-sm" onClick={() => processRefund(r.id)}>Process</button>}
                          {r.status === 'PENDING' && <button className="btn-sm-outline" onClick={() => rejectRefund(r.id)}>Reject</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Reconciliation Tab ───────────────────────────── */}
      {tab === 'Reconciliation' && (
        <div className="data-card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
          <svg width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" style={{ marginBottom: 12, opacity: 0.4 }}>
            <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 14l2 2 4-4"/>
          </svg>
          <p style={{ fontWeight: 600, marginBottom: 4 }}>Payment Reconciliation</p>
          <p style={{ fontSize: '0.85rem' }}>Post automated reconciliation via the API at <code>POST /payments/reconciliation</code>. Manual reconciliation coming soon.</p>
        </div>
      )}

      {/* ── Payment Detail Drawer ────────────────────────── */}
      {showDetail && (() => {
        const p = payments.find(x => x.id === showDetail);
        if (!p) return null;
        return (
          <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}
            onClick={() => setShowDetail(null)}>
            <div style={{ background: 'white', padding: 32, width: 520, maxWidth: '95vw', height: '100vh', overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.1)' }}
              onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Payment Detail</h2>
                <span style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setShowDetail(null)}>
                  <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                <div style={{ padding: '14px', background: '#F8FAFC', borderRadius: 12 }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Reference</div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, fontFamily: 'monospace', wordBreak: 'break-all' }}>{p.reference}</div>
                </div>
                <div style={{ padding: '14px', background: '#F8FAFC', borderRadius: 12 }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Invoice</div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{p.invoice?.invoiceNumber ?? '—'}</div>
                </div>
                <div style={{ padding: '14px', background: '#F8FAFC', borderRadius: 12 }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Amount</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--primary)' }}>{fmtK(p.amountKobo)}</div>
                </div>
                <div style={{ padding: '14px', background: '#F8FAFC', borderRadius: 12 }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Status</div>
                  <div>{badge(p.status, STATUS_COLORS[p.status] ?? '#6B7280')}</div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Provider</span><span style={{ fontWeight: 600 }}>{p.provider}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Provider Ref</span><span style={{ fontWeight: 600, fontFamily: 'monospace', fontSize: '0.8rem' }}>{p.providerReference ?? '—'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Fees</span><span style={{ fontWeight: 600 }}>{fmtK(p.feesKobo)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Paid At</span><span style={{ fontWeight: 600 }}>{p.paidAt ? fmtD(p.paidAt) : '—'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Created</span><span style={{ fontWeight: 600 }}>{fmtD(p.createdAt)}</span>
                </div>
              </div>

              {p.refunds && p.refunds.length > 0 && (
                <div style={{ marginTop: 20, padding: '14px', background: '#FFF7ED', borderRadius: 12 }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: 8, color: '#C2410C' }}>Refunds on this payment</div>
                  {p.refunds.map(rf => (
                    <div key={rf.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: 4 }}>
                      <span>{fmtK(rf.amountKobo)}</span>
                      <span>{badge(rf.status, STATUS_COLORS[rf.status] ?? '#6B7280')}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── Record Payment Drawer ────────────────────────── */}
      {showRecordPayment && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}
          onClick={() => setShowRecordPayment(false)}>
          <div style={{ background: 'white', padding: 32, width: 480, maxWidth: '95vw', height: '100vh', overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.1)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Record Payment</h2>
              <span style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setShowRecordPayment(false)}>
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Invoice ID</label>
                <input value={recordForm.invoiceId} onChange={e => setRecordForm(f => ({ ...f, invoiceId: e.target.value }))} style={inp} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Amount (kobo)</label>
                  <input type="number" value={recordForm.amountKobo} onChange={e => setRecordForm(f => ({ ...f, amountKobo: Number(e.target.value) }))} style={inp} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Provider</label>
                  <select value={recordForm.provider} onChange={e => setRecordForm(f => ({ ...f, provider: e.target.value }))} style={sel}>
                    {['BANK_TRANSFER', 'PAYSTACK', 'FLUTTERWAVE', 'MONNIFY', 'REMITA', 'CASH', 'POS'].map(p => <option key={p} value={p}>{p.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Reference</label>
                <input value={recordForm.reference} onChange={e => setRecordForm(f => ({ ...f, reference: e.target.value }))} style={inp} />
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn-outline" onClick={() => setShowRecordPayment(false)}>Cancel</button>
                <button className="btn-primary" disabled={!recordForm.invoiceId || !recordForm.amountKobo || !recordForm.reference}
                  onClick={async () => {
                    try {
                      await api('/payments/record-offline', { method: 'POST', body: JSON.stringify(recordForm) });
                      setShowRecordPayment(false);
                      await fetchAll();
                    } catch { setError('Failed to record payment'); }
                  }}>
                  Record Payment
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Refund Request Drawer ────────────────────────── */}
      {showRefundForm && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}
          onClick={() => setShowRefundForm(false)}>
          <div style={{ background: 'white', padding: 32, width: 440, maxWidth: '95vw', height: '100vh', overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.1)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Request Refund</h2>
              <span style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setShowRefundForm(false)}>
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Payment ID</label>
                <input value={refundForm.paymentId} onChange={e => setRefundForm(f => ({ ...f, paymentId: e.target.value }))} style={inp} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Amount (kobo)</label>
                <input type="number" value={refundForm.amountKobo} onChange={e => setRefundForm(f => ({ ...f, amountKobo: Number(e.target.value) }))} style={inp} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Reason</label>
                <textarea value={refundForm.reason} onChange={e => setRefundForm(f => ({ ...f, reason: e.target.value }))} rows={3} style={{ ...inp, resize: 'vertical' }} />
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn-outline" onClick={() => setShowRefundForm(false)}>Cancel</button>
                <button className="btn-primary" disabled={!refundForm.paymentId || !refundForm.amountKobo} onClick={requestRefund}>Submit Refund</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
