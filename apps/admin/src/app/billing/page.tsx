'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@isp/shared';
import { SkeletonBlock, SkeletonCard, SkeletonTable } from '../../components/Skeleton';

/* ── Types ────────────────────────────────────────────────── */

interface DashboardData {
  revenueToday: number;
  revenueThisMonth: number;
  revenueThisYear: number;
  invoices: { generated: number; paid: number; pending: number; overdue: number; void: number };
  collections: { totalOutstanding: number; collectionRate: number };
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  type: string;
  status: string;
  amountKobo: number;
  subtotalKobo: number;
  vatKobo: number;
  discountKobo: number;
  dueAt: string;
  issuedAt: string | null;
  paidAt: string | null;
  notes: string | null;
  lines: InvoiceLine[];
  payments: { id: string; amountKobo: number; reference: string; status: string }[];
  subscriber: { id: string; user: { id: string; email: string; phone: string | null } };
  _count: { payments: number; receipts: number };
  createdAt: string;
}

interface InvoiceLine {
  id: string;
  description: string;
  amountKobo: number;
  quantity: number;
}

interface Quotation {
  id: string;
  quotationNumber: string;
  subscriberName: string;
  status: string;
  totalKobo: number;
  validUntil: string | null;
  items: { description: string; quantity: number; unitPriceKobo: number; amountKobo: number }[];
  createdAt: string;
}

interface Payment {
  id: string;
  amountKobo: number;
  reference: string;
  provider: string;
  status: string;
  paidAt: string | null;
  invoice: { invoiceNumber: string; subscriber: { user: { email: string } } };
  createdAt: string;
}

interface Receipt {
  id: string;
  receiptNumber: string;
  amountKobo: number;
  paymentMethod: string;
  transactionRef: string;
  paidAt: string;
  invoice: { invoiceNumber: string };
}

/* ── Helpers ──────────────────────────────────────────────── */

const COLORS = ['#6366f1', '#F15925', '#ef4444', '#10B981', '#8B5CF6'];
const STATUS_COLORS: Record<string, string> = {
  DRAFT: '#6B7280',
  ISSUED: '#2563EB',
  PAID: '#16A34A',
  OVERDUE: '#DC2626',
  VOID: '#94A3B8',
  SENT: '#2563EB',
  ACCEPTED: '#16A34A',
  REJECTED: '#DC2626',
  EXPIRED: '#94A3B8',
};

function fmtK(k: number) { return `\u20A6${(k / 100).toLocaleString()}`; }
function fmtD(d: string) { return new Date(d).toLocaleDateString('en-GB'); }

function badge(label: string, color: string, bg?: string) {
  return <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600, backgroundColor: bg ?? color + '18', color }}>{label}</span>;
}

const TABS = ['Invoices', 'Quotations', 'Payments', 'Receipts'];
const INVOICE_TYPES = ['ALL', 'SUBSCRIPTION', 'INSTALLATION', 'ONE_TIME', 'MANUAL'];
const QUOTATION_STATUSES = ['ALL', 'DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED'];

const inp: React.CSSProperties = { width: '100%', padding: '9px 12px', border: '1px solid var(--border-color)', borderRadius: 10, fontSize: '0.85rem', outline: 'none' };
const sel: React.CSSProperties = { ...inp, background: 'white' };
const lbl: React.CSSProperties = { display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' };

/* ── Component ────────────────────────────────────────────── */

export default function BillingPage() {
  const [tab, setTab] = useState('Invoices');
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // filters
  const [invFilter, setInvFilter] = useState('ALL');
  const [qFilter, setQFilter] = useState('ALL');
  const [search, setSearch] = useState('');

  // drawers
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState<string | null>(null);
  const [showQDetail, setShowQDetail] = useState<string | null>(null);
  const [showQuotation, setShowQuotation] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // create form
  const [form, setForm] = useState({
    subscriberId: '', type: 'SUBSCRIPTION', dueAt: '', notes: '',
    lines: [{ description: '', amountKobo: 0, quantity: 1 }],
    vatKobo: 0, discountKobo: 0,
  });

  // quotation form
  const [qForm, setQForm] = useState({
    subscriberName: '', subscriberEmail: '', subscriberPhone: '', subscriberAddress: '',
    validUntil: '', items: [{ description: '', quantity: 1, unitPriceKobo: 0 }],
    notes: '', discountKobo: 0,
  });

  const [subs, setSubs] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => { fetchAll(); fetchSubs(); }, []);

  async function fetchAll() {
    setLoading(true);
    try {
      const [d, inv, q, p, r] = await Promise.all([
        api<DashboardData>('/billing/dashboard').catch(() => null),
        api<Invoice[]>('/billing'),
        api<Quotation[]>('/billing/quotations').catch(() => []),
        api<Payment[]>('/billing/payments').catch(() => []),
        api<Receipt[]>('/billing/receipts').catch(() => []),
      ]);
      if (d) setDashboard(d);
      setInvoices(inv);
      setQuotations(q);
      setPayments(p);
      setReceipts(r);
    } catch { setError('Failed to load billing data'); }
    finally { setLoading(false); }
  }

  async function fetchSubs() {
    try {
      const data = await api<{ id: string; user: { email: string } }[]>('/subscriptions');
      setSubs(data.map((s: any) => ({ id: s.id, name: s.user?.email ?? s.id })));
    } catch {}
  }

  const filteredInvoices = invoices.filter(i => {
    if (invFilter !== 'ALL' && i.type !== invFilter) return false;
    if (search && !i.invoiceNumber.toLowerCase().includes(search.toLowerCase()) && !i.subscriber?.user?.email?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const filteredQuotations = qFilter === 'ALL' ? quotations : quotations.filter(q => q.status === qFilter);

  /* ── Invoice Create ───────────────────────────────────── */

  const openCreate = () => {
    setForm({ subscriberId: '', type: 'SUBSCRIPTION', dueAt: '', notes: '', lines: [{ description: '', amountKobo: 0, quantity: 1 }], vatKobo: 0, discountKobo: 0 });
    setShowCreate(true);
  };

  const addLine = () => setForm(f => ({ ...f, lines: [...f.lines, { description: '', amountKobo: 0, quantity: 1 }] }));
  const updateLine = (i: number, field: string, value: any) => {
    setForm(f => {
      const lines = [...f.lines];
      lines[i] = { ...lines[i], [field]: value };
      return { ...f, lines };
    });
  };
  const removeLine = (i: number) => setForm(f => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }));

  const calcSubtotal = () => form.lines.reduce((s, l) => s + l.amountKobo * l.quantity, 0);
  const calcVat = () => form.vatKobo || Math.round((calcSubtotal() - form.discountKobo) * 0.075);
  const calcTotal = () => calcSubtotal() - form.discountKobo + calcVat();

  async function handleCreate() {
    setSubmitting(true);
    try {
      const subtotal = calcSubtotal();
      const vat = calcVat();
      await api('/billing', {
        method: 'POST',
        body: JSON.stringify({
          subscriberId: form.subscriberId,
          type: form.type,
          dueAt: form.dueAt,
          lines: form.lines.map(l => ({ description: l.description, amountKobo: l.amountKobo, quantity: l.quantity })),
          vatKobo: vat,
          discountKobo: form.discountKobo,
          notes: form.notes,
        }),
      });
      setShowCreate(false);
      await fetchAll();
    } catch { setError('Failed to create invoice'); }
    finally { setSubmitting(false); }
  }

  /* ── Invoice Actions ──────────────────────────────────── */

  const issueInvoice = async (id: string) => { try { await api(`/billing/${id}/issue`, { method: 'PATCH' }); await fetchAll(); } catch { setError('Failed to issue'); } };
  const voidInvoice = async (id: string) => { try { await api(`/billing/${id}/void`, { method: 'PATCH' }); await fetchAll(); } catch { setError('Failed to void'); } };
  const markPaid = async (id: string) => { try { await api(`/billing/${id}/paid`, { method: 'PATCH' }); await fetchAll(); } catch { setError('Failed to mark paid'); } };

  /* ── Quotation Create ─────────────────────────────────── */

  const openQuotation = () => {
    setQForm({ subscriberName: '', subscriberEmail: '', subscriberPhone: '', subscriberAddress: '', validUntil: '', items: [{ description: '', quantity: 1, unitPriceKobo: 0 }], notes: '', discountKobo: 0 });
    setShowQuotation(true);
  };

  const addQItem = () => setQForm(f => ({ ...f, items: [...f.items, { description: '', quantity: 1, unitPriceKobo: 0 }] }));
  const updateQItem = (i: number, field: string, value: any) => {
    setQForm(f => {
      const items = [...f.items];
      items[i] = { ...items[i], [field]: value };
      return { ...f, items };
    });
  };
  const removeQItem = (i: number) => setQForm(f => ({ ...f, items: f.items.filter((_, idx) => idx !== i) }));

  const qCalcSubtotal = () => qForm.items.reduce((s, l) => s + l.unitPriceKobo * l.quantity, 0);
  const qCalcVat = () => Math.round((qCalcSubtotal() - qForm.discountKobo) * 0.075);
  const qCalcTotal = () => qCalcSubtotal() - qForm.discountKobo + qCalcVat();

  async function handleCreateQuotation() {
    setSubmitting(true);
    try {
      await api('/billing/quotations', {
        method: 'POST',
        body: JSON.stringify({
          subscriberName: qForm.subscriberName,
          subscriberEmail: qForm.subscriberEmail || undefined,
          subscriberPhone: qForm.subscriberPhone || undefined,
          subscriberAddress: qForm.subscriberAddress || undefined,
          validUntil: qForm.validUntil || undefined,
          items: qForm.items.map(i => ({ description: i.description, quantity: i.quantity, unitPriceKobo: i.unitPriceKobo })),
          discountKobo: qForm.discountKobo || undefined,
          notes: qForm.notes || undefined,
        }),
      });
      setShowQuotation(false);
      await fetchAll();
    } catch { setError('Failed to create quotation'); }
    finally { setSubmitting(false); }
  }

  const updateQStatus = async (id: string, status: string) => {
    try { await api(`/billing/quotations/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); await fetchAll(); }
    catch { setError('Failed to update'); }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <SkeletonBlock width={200} height={28} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} height={90} />)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} height={60} />)}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {Array.from({ length: 4 }).map((_, i) => <SkeletonBlock key={i} width={100} height={34} borderRadius={20} />)}
        </div>
        <div className="data-card" style={{ padding: 24 }}>
          <SkeletonTable rows={8} cols={6} />
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Dashboard Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <div className="data-card" style={{ padding: '18px 20px' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Revenue Today</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--primary)' }}>{dashboard ? fmtK(dashboard.revenueToday) : '—'}</div>
        </div>
        <div className="data-card" style={{ padding: '18px 20px' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Revenue This Month</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{dashboard ? fmtK(dashboard.revenueThisMonth) : '—'}</div>
        </div>
        <div className="data-card" style={{ padding: '18px 20px' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Collection Rate</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>{dashboard ? `${dashboard.collections.collectionRate}%` : '—'}</div>
        </div>
        <div className="data-card" style={{ padding: '18px 20px' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Outstanding Debt</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: dashboard && dashboard.collections.totalOutstanding > 0 ? '#DC2626' : 'inherit' }}>{dashboard ? fmtK(dashboard.collections.totalOutstanding) : '—'}</div>
        </div>
      </div>

      {/* Invoice Status Summary */}
      {dashboard && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'Generated', value: dashboard.invoices.generated, color: '#6B7280' },
            { label: 'Paid', value: dashboard.invoices.paid, color: '#16A34A' },
            { label: 'Pending', value: dashboard.invoices.pending, color: '#2563EB' },
            { label: 'Overdue', value: dashboard.invoices.overdue, color: '#DC2626' },
            { label: 'Void', value: dashboard.invoices.void, color: '#94A3B8' },
          ].map(s => (
            <div key={s.label} className="data-card" style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>{s.label}</span>
              <span style={{ fontSize: '1.1rem', fontWeight: 700, color: s.color }}>{s.value}</span>
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
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '8px 18px', borderRadius: 20, border: '1px solid var(--border-color)', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem', backgroundColor: tab === t ? 'var(--primary)' : '#fff', color: tab === t ? '#fff' : 'var(--text-color)' }}>
            {t}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        {(tab === 'Invoices') && (
          <button className="btn-primary" onClick={openCreate}>Create Invoice</button>
        )}
        {(tab === 'Quotations') && (
          <button className="btn-primary" onClick={openQuotation}>New Quotation</button>
        )}
      </div>

      {/* ── Invoices Tab ─────────────────────────────────── */}
      {tab === 'Invoices' && (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search invoice # or email..." style={{ ...inp, maxWidth: 300 }} />
            <div style={{ display: 'flex', gap: 6 }}>
              {INVOICE_TYPES.map(t => (
                <button key={t} onClick={() => setInvFilter(t)} style={{ padding: '5px 12px', borderRadius: 16, border: '1px solid var(--border-color)', cursor: 'pointer', fontWeight: invFilter === t ? 600 : 400, fontSize: '0.75rem', background: invFilter === t ? 'var(--primary)' : '#fff', color: invFilter === t ? '#fff' : 'var(--text-color)' }}>
                  {t === 'ALL' ? 'All' : t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
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
                      <th>INVOICE</th>
                      <th>CUSTOMER</th>
                      <th>TYPE</th>
                      <th>AMOUNT</th>
                      <th>STATUS</th>
                      <th>DUE DATE</th>
                      <th style={{ width: 120 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredInvoices.length === 0 ? (
                      <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>No invoices found</td></tr>
                    ) : filteredInvoices.map(inv => (
                      <tr key={inv.id} onClick={() => setShowDetail(inv.id)} style={{ cursor: 'pointer' }}>
                        <td style={{ fontWeight: 600, fontSize: '0.85rem' }}>{inv.invoiceNumber}</td>
                        <td>{inv.subscriber?.user?.email ?? '—'}</td>
                        <td>{badge(inv.type.replace(/_/g, ' '), 'var(--text-muted)', '#F1F5F9')}</td>
                        <td style={{ fontWeight: 600 }}>{fmtK(inv.amountKobo)}</td>
                        <td>{badge(inv.status, STATUS_COLORS[inv.status] ?? '#6B7280')}</td>
                        <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{fmtD(inv.dueAt)}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                            {inv.status === 'DRAFT' && <button className="btn-sm" onClick={() => issueInvoice(inv.id)}>Issue</button>}
                            {inv.status === 'ISSUED' && <button className="btn-sm" onClick={() => markPaid(inv.id)}>Paid</button>}
                            {(inv.status === 'DRAFT' || inv.status === 'ISSUED' || inv.status === 'OVERDUE') && <button className="btn-sm-outline" onClick={() => voidInvoice(inv.id)}>Void</button>}
                          </div>
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

      {/* ── Quotations Tab ───────────────────────────────── */}
      {tab === 'Quotations' && (
        <>
          <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
            {QUOTATION_STATUSES.map(s => (
              <button key={s} onClick={() => setQFilter(s)} style={{ padding: '5px 12px', borderRadius: 16, border: '1px solid var(--border-color)', cursor: 'pointer', fontWeight: qFilter === s ? 600 : 400, fontSize: '0.75rem', background: qFilter === s ? 'var(--primary)' : '#fff', color: qFilter === s ? '#fff' : 'var(--text-color)' }}>
                {s === 'ALL' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}
              </button>
            ))}
          </div>

          <div className="data-card" style={{ padding: 0 }}>
            <div className="table-container">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>QUOTATION</th>
                      <th>CUSTOMER</th>
                      <th>TOTAL</th>
                      <th>STATUS</th>
                      <th>CREATED</th>
                      <th style={{ width: 100 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredQuotations.length === 0 ? (
                      <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>No quotations found</td></tr>
                    ) : filteredQuotations.map(q => (
                      <tr key={q.id} onClick={() => setShowQDetail(q.id)} style={{ cursor: 'pointer' }}>
                        <td style={{ fontWeight: 600, fontSize: '0.85rem' }}>{q.quotationNumber}</td>
                        <td>{q.subscriberName}</td>
                        <td style={{ fontWeight: 600 }}>{fmtK(q.totalKobo)}</td>
                        <td>{badge(q.status, STATUS_COLORS[q.status] ?? '#6B7280')}</td>
                        <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{fmtD(q.createdAt)}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                            {q.status === 'DRAFT' && <button className="btn-sm" onClick={() => updateQStatus(q.id, 'SENT')}>Send</button>}
                            {q.status === 'SENT' && <button className="btn-sm" onClick={() => updateQStatus(q.id, 'ACCEPTED')}>Accept</button>}
                            {q.status === 'SENT' && <button className="btn-sm-outline" onClick={() => updateQStatus(q.id, 'REJECTED')}>Reject</button>}
                          </div>
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

      {/* ── Payments Tab ─────────────────────────────────── */}
      {tab === 'Payments' && (
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
                  </tr>
                </thead>
                <tbody>
                  {payments.length === 0 ? (
                    <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>No payments recorded</td></tr>
                  ) : payments.map(p => (
                    <tr key={p.id}>
                      <td style={{ fontSize: '0.8rem', fontFamily: 'monospace' }}>{p.reference.slice(0, 16)}...</td>
                      <td style={{ fontWeight: 600, fontSize: '0.85rem' }}>{p.invoice?.invoiceNumber ?? '—'}</td>
                      <td>{p.invoice?.subscriber?.user?.email ?? '—'}</td>
                      <td style={{ fontWeight: 600 }}>{fmtK(p.amountKobo)}</td>
                      <td>{badge(p.provider, '#6366F1', '#EEF2FF')}</td>
                      <td>{badge(p.status, p.status === 'SUCCESSFUL' ? '#16A34A' : p.status === 'PENDING' ? '#CA8A04' : '#DC2626')}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{p.paidAt ? fmtD(p.paidAt) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Receipts Tab ─────────────────────────────────── */}
      {tab === 'Receipts' && (
        <div className="data-card" style={{ padding: 0 }}>
          <div className="table-container">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>RECEIPT #</th>
                    <th>INVOICE</th>
                    <th>AMOUNT</th>
                    <th>METHOD</th>
                    <th>TRANSACTION REF</th>
                    <th>PAID DATE</th>
                  </tr>
                </thead>
                <tbody>
                  {receipts.length === 0 ? (
                    <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>No receipts generated</td></tr>
                  ) : receipts.map(r => (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 600, fontSize: '0.85rem' }}>{r.receiptNumber}</td>
                      <td>{r.invoice?.invoiceNumber ?? '—'}</td>
                      <td style={{ fontWeight: 600 }}>{fmtK(r.amountKobo)}</td>
                      <td>{badge(r.paymentMethod, '#6366F1', '#EEF2FF')}</td>
                      <td style={{ fontSize: '0.8rem', fontFamily: 'monospace' }}>{r.transactionRef.slice(0, 20)}...</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{fmtD(r.paidAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Create Invoice Drawer ────────────────────────── */}
      {showCreate && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}
          onClick={() => setShowCreate(false)}>
          <div style={{ background: 'white', padding: 32, width: 600, maxWidth: '95vw', height: '100vh', overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.1)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>Create Invoice</h2>
              <span style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setShowCreate(false)}>
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={lbl}>Customer</label>
                <select value={form.subscriberId} onChange={e => setForm(f => ({ ...f, subscriberId: e.target.value }))} style={sel}>
                  <option value="">Select customer...</option>
                  {subs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={lbl}>Invoice Type</label>
                  <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} style={sel}>
                    {['SUBSCRIPTION', 'INSTALLATION', 'ONE_TIME', 'MANUAL'].map(t => <option key={t} value={t}>{t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Due Date</label>
                  <input type="date" value={form.dueAt} onChange={e => setForm(f => ({ ...f, dueAt: e.target.value }))} style={inp} />
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <label style={lbl}>Line Items</label>
                  <button onClick={addLine} style={{ padding: '4px 10px', borderRadius: 12, border: '1px solid var(--border-color)', background: '#fff', cursor: 'pointer', fontSize: '0.75rem' }}>+ Add Item</button>
                </div>
                {form.lines.map((line, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                    <input value={line.description} onChange={e => updateLine(i, 'description', e.target.value)} placeholder="Description" style={{ ...inp, flex: 1 }} />
                    <input type="number" value={line.amountKobo || ''} onChange={e => updateLine(i, 'amountKobo', Number(e.target.value))} placeholder="Amount" style={{ ...inp, width: 100 }} />
                    <input type="number" value={line.quantity} onChange={e => updateLine(i, 'quantity', Number(e.target.value))} min={1} style={{ ...inp, width: 50 }} />
                    {form.lines.length > 1 && <button onClick={() => removeLine(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626', padding: 4 }}>
                      <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>}
                  </div>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={lbl}>Subtotal</label>
                  <div style={{ padding: '9px 12px', background: '#F8FAFC', borderRadius: 10, fontSize: '0.9rem', fontWeight: 600 }}>{fmtK(calcSubtotal())}</div>
                </div>
                <div>
                  <label style={lbl}>Discount (kobo)</label>
                  <input type="number" value={form.discountKobo} onChange={e => setForm(f => ({ ...f, discountKobo: Number(e.target.value) }))} style={inp} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={lbl}>VAT (auto 7.5%)</label>
                  <input type="number" value={calcVat()} onChange={e => setForm(f => ({ ...f, vatKobo: Number(e.target.value) }))} style={inp} />
                </div>
                <div>
                  <label style={lbl}>Total Due</label>
                  <div style={{ padding: '9px 12px', background: '#FEF5E7', borderRadius: 10, fontSize: '1rem', fontWeight: 700, color: 'var(--primary)' }}>{fmtK(calcTotal())}</div>
                </div>
              </div>

              <div>
                <label style={lbl}>Notes</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} style={{ ...inp, resize: 'vertical' }} />
              </div>

              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn-outline" onClick={() => setShowCreate(false)}>Cancel</button>
                <button className="btn-primary" disabled={submitting || !form.subscriberId || !form.dueAt} onClick={handleCreate}>
                  {submitting ? 'Creating...' : 'Create Invoice'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Invoice Detail Drawer ────────────────────────── */}
      {showDetail && (() => {
        const inv = invoices.find(i => i.id === showDetail);
        if (!inv) return null;
        return (
          <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}
            onClick={() => setShowDetail(null)}>
            <div style={{ background: 'white', padding: 32, width: 560, maxWidth: '95vw', height: '100vh', overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.1)' }}
              onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <div>
                  <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>{inv.invoiceNumber}</h2>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{inv.type.replace(/_/g, ' ')} Invoice</span>
                </div>
                <span style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setShowDetail(null)}>
                  <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </span>
              </div>

              <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                {badge(inv.status, STATUS_COLORS[inv.status] ?? '#6B7280')}
                {inv.issuedAt && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Issued: {fmtD(inv.issuedAt)}</span>}
                {inv.paidAt && <span style={{ fontSize: '0.8rem', color: '#16A34A' }}>Paid: {fmtD(inv.paidAt)}</span>}
              </div>

              <div style={{ marginBottom: 20, padding: '14px 16px', background: '#F8FAFC', borderRadius: 12 }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>Customer</div>
                <div style={{ fontWeight: 600 }}>{inv.subscriber?.user?.email ?? '—'}</div>
                {inv.subscriber?.user?.phone && <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{inv.subscriber.user.phone}</div>}
              </div>

              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', marginBottom: 20 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>Description</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right' }}>Qty</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.lines.map(l => (
                    <tr key={l.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '8px 12px' }}>{l.description}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>{l.quantity}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>{fmtK(l.amountKobo * l.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                  <span>Subtotal</span><span>{fmtK(inv.subtotalKobo)}</span>
                </div>
                {inv.discountKobo > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#DC2626' }}>
                  <span>Discount</span><span>-{fmtK(inv.discountKobo)}</span>
                </div>}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                  <span>VAT (7.5%)</span><span>{fmtK(inv.vatKobo)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1rem', fontWeight: 700, borderTop: '2px solid var(--border-color)', paddingTop: 8 }}>
                  <span>Total Due</span><span style={{ color: 'var(--primary)' }}>{fmtK(inv.amountKobo)}</span>
                </div>
              </div>

              {inv.notes && <div style={{ marginBottom: 20, padding: 12, background: '#FFFBEB', borderRadius: 10, fontSize: '0.8rem', color: '#92400E' }}>{inv.notes}</div>}

              <div style={{ display: 'flex', gap: 8 }}>
                {inv.status === 'DRAFT' && <button className="btn-primary" onClick={() => { issueInvoice(inv.id); }}>Issue Invoice</button>}
                {inv.status === 'ISSUED' && <button className="btn-primary" onClick={() => { markPaid(inv.id); }}>Mark Paid</button>}
                {(inv.status === 'DRAFT' || inv.status === 'ISSUED') && <button className="btn-outline" onClick={() => { voidInvoice(inv.id); }}>Void Invoice</button>}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Create Quotation Drawer ──────────────────────── */}
      {showQuotation && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}
          onClick={() => setShowQuotation(false)}>
          <div style={{ background: 'white', padding: 32, width: 600, maxWidth: '95vw', height: '100vh', overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.1)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>New Quotation</h2>
              <span style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setShowQuotation(false)}>
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={lbl}>Customer Name</label>
                <input value={qForm.subscriberName} onChange={e => setQForm(f => ({ ...f, subscriberName: e.target.value }))} style={inp} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={lbl}>Email</label>
                  <input value={qForm.subscriberEmail} onChange={e => setQForm(f => ({ ...f, subscriberEmail: e.target.value }))} style={inp} />
                </div>
                <div>
                  <label style={lbl}>Phone</label>
                  <input value={qForm.subscriberPhone} onChange={e => setQForm(f => ({ ...f, subscriberPhone: e.target.value }))} style={inp} />
                </div>
              </div>
              <div>
                <label style={lbl}>Address</label>
                <input value={qForm.subscriberAddress} onChange={e => setQForm(f => ({ ...f, subscriberAddress: e.target.value }))} style={inp} />
              </div>
              <div>
                <label style={lbl}>Valid Until</label>
                <input type="date" value={qForm.validUntil} onChange={e => setQForm(f => ({ ...f, validUntil: e.target.value }))} style={inp} />
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <label style={lbl}>Items</label>
                  <button onClick={addQItem} style={{ padding: '4px 10px', borderRadius: 12, border: '1px solid var(--border-color)', background: '#fff', cursor: 'pointer', fontSize: '0.75rem' }}>+ Add Item</button>
                </div>
                {qForm.items.map((item, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                    <input value={item.description} onChange={e => updateQItem(i, 'description', e.target.value)} placeholder="Description" style={{ ...inp, flex: 1 }} />
                    <input type="number" value={item.unitPriceKobo || ''} onChange={e => updateQItem(i, 'unitPriceKobo', Number(e.target.value))} placeholder="Price" style={{ ...inp, width: 100 }} />
                    <input type="number" value={item.quantity} onChange={e => updateQItem(i, 'quantity', Number(e.target.value))} min={1} style={{ ...inp, width: 50 }} />
                    {qForm.items.length > 1 && <button onClick={() => removeQItem(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626', padding: 4 }}>
                      <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>}
                  </div>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={lbl}>Discount (kobo)</label>
                  <input type="number" value={qForm.discountKobo} onChange={e => setQForm(f => ({ ...f, discountKobo: Number(e.target.value) }))} style={inp} />
                </div>
                <div>
                  <label style={lbl}>Total</label>
                  <div style={{ padding: '9px 12px', borderRadius: 10, fontSize: '1rem', fontWeight: 700, color: 'var(--primary)', background: '#FEF5E7' }}>{fmtK(qCalcTotal())}</div>
                </div>
              </div>
              <div>
                <label style={lbl}>Notes</label>
                <textarea value={qForm.notes} onChange={e => setQForm(f => ({ ...f, notes: e.target.value }))} rows={2} style={{ ...inp, resize: 'vertical' }} />
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn-outline" onClick={() => setShowQuotation(false)}>Cancel</button>
                <button className="btn-primary" disabled={submitting || !qForm.subscriberName || qForm.items.some(i => !i.description)} onClick={handleCreateQuotation}>
                  {submitting ? 'Saving...' : 'Create Quotation'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Quotation Detail Drawer ──────────────────────── */}
      {showQDetail && (() => {
        const q = quotations.find(x => x.id === showQDetail);
        if (!q) return null;
        return (
          <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}
            onClick={() => setShowQDetail(null)}>
            <div style={{ background: 'white', padding: 32, width: 520, maxWidth: '95vw', height: '100vh', overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.1)' }}
              onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <div>
                  <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>{q.quotationNumber}</h2>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{q.subscriberName}</span>
                </div>
                <span style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setShowQDetail(null)}>
                  <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </span>
              </div>
              <div style={{ marginBottom: 16 }}>{badge(q.status, STATUS_COLORS[q.status] ?? '#6B7280')}</div>
              {q.validUntil && <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 16 }}>Valid until: {fmtD(q.validUntil)}</div>}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', marginBottom: 16 }}>
                <thead><tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>Item</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>Qty</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>Unit Price</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>Total</th>
                </tr></thead>
                <tbody>
                  {q.items.map((item, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '8px 12px' }}>{item.description}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>{item.quantity}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fmtK(item.unitPriceKobo)}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>{fmtK(item.amountKobo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}><span>Subtotal</span><span>{fmtK(q.items.reduce((s, i) => s + i.amountKobo, 0))}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1rem', fontWeight: 700, borderTop: '2px solid var(--border-color)', paddingTop: 8 }}>
                  <span>Total</span><span style={{ color: 'var(--primary)' }}>{fmtK(q.totalKobo)}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {q.status === 'DRAFT' && <button className="btn-primary" onClick={() => updateQStatus(q.id, 'SENT')}>Mark Sent</button>}
                {q.status === 'SENT' && <button className="btn-primary" onClick={() => updateQStatus(q.id, 'ACCEPTED')}>Mark Accepted</button>}
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
