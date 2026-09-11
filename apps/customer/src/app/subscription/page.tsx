'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore, api, formatNaira } from '@isp/shared';
import { SkeletonBlock, SkeletonCard } from '../components/Skeleton';

function fmtK(k: number) { return formatNaira(k); }

interface DashboardData {
  plan: { id: string; name: string; speedMbps: number; priceKobo: number; dataCapGb?: number; technology?: string } | null;
  subscription: { id: string; startedAt?: string; expiresAt?: string; autoRenew: boolean; suspendedAt?: string | null } | null;
  subscriber: { id: string; createdAt: string; status: string };
}

interface Plan {
  id: string; name: string; speedMbps: number; priceKobo: number; dataCapGb?: number; technology?: string; category: string; type: string;
}

/** Pay-ahead durations offered on the subscription page. */
const MONTH_OPTIONS = [1, 2, 3, 4, 5, 6, 9, 12];
function monthsLabel(m: number) { return m === 12 ? '1 year' : `${m} month${m > 1 ? 's' : ''}`; }

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

export default function SubscriptionPage() {
  const { accessToken, user } = useAuthStore();
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState<'change' | null>(null);
  const [paying, setPaying] = useState(false);
  const [months, setMonths] = useState(1);

  const fetchAll = useCallback(async () => {
    const [d, p] = await Promise.all([
      api<DashboardData>('/customer/dashboard').catch(() => null),
      api<Plan[]>('/subscriptions/plans').catch(() => []),
    ]);
    if (d) setData(d);
    setPlans(p);
  }, []);

  useEffect(() => {
    if (!accessToken) {
      if (typeof window !== 'undefined' && !localStorage.getItem('accessToken')) router.push('/login');
      return;
    }
    fetchAll().finally(() => setLoading(false));
  }, [accessToken, router, fetchAll]);

  const sub = data?.subscription;
  const plan = data?.plan;
  const email = user?.email ?? '';
  const paystackKey = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY ?? '';

  const isDue = sub?.expiresAt ? new Date(sub.expiresAt).getTime() - Date.now() < 7 * 86400000 : false;
  const isExpired = sub?.expiresAt ? new Date(sub.expiresAt).getTime() < Date.now() : false;

  async function pay(action: 'change_plan' | 'renew', planId?: string) {
    const target = action === 'renew' ? data?.plan : plans.find((p) => p.id === planId);
    const priceKobo = target?.priceKobo ?? 0;
    if (!priceKobo) {
      alert('Could not determine the plan amount. Please try again.');
      return;
    }

    setPaying(true);
    try {
      const res = await api<{ authorizationUrl: string; reference: string; amountKobo: number; months?: number }>('/payments/customer/initialize', {
        method: 'POST',
        body: JSON.stringify({ action, planId, months }),
      });
      if (!res?.reference) throw new Error('Payment initialization failed');

      await loadPaystackInline();
      const handler = (window as any).PaystackPop.setup({
        key: paystackKey,
        email,
        amount: res.amountKobo,
        currency: 'NGN',
        ref: res.reference,
        metadata: { action, planId, months },
        callback: () => router.push('/payment/callback?reference=' + encodeURIComponent(res.reference)),
        onClose: () => setPaying(false),
      });
      handler.openIframe();
    } catch (err: any) {
      alert(err?.message ?? 'Could not start payment. Please try again.');
      setPaying(false);
    }
  }

  if (!accessToken) return null;

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <SkeletonBlock width={200} height={28} />
        <SkeletonCard height={220} />
        <SkeletonCard height={180} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="page-title-row">
        <div>
          <h1 className="page-title">My Subscription</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 4 }}>View and manage your plan</p>
        </div>
        <button className="btn-primary" onClick={() => setDrawer('change')} disabled={paying}>
          <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          Change Plan
        </button>
      </div>

      {/* Current Plan */}
      <div className="data-card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 700 }}>Current Plan</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {(isDue || isExpired) && (
              <span style={{
                fontSize: '0.7rem', padding: '3px 10px', borderRadius: 20, fontWeight: 700,
                background: isExpired ? '#FEE2E2' : '#FEF3C7', color: isExpired ? '#DC2626' : '#D97706'
              }}>
                {isExpired ? 'Expired' : 'Due Soon'}
              </span>
            )}
            {plan && (
              <button onClick={() => pay('renew')} disabled={paying} className="btn-primary" style={{ padding: '8px 18px', fontSize: '0.8rem' }}>
                {paying ? 'Processing…' : `Pay ${fmtK(plan.priceKobo * months)} · ${monthsLabel(months)}`}
              </button>
            )}
          </div>
        </div>
        {plan ? (
          <div className="grid-3" style={{ gap: 16 }}>
            {[
              { label: 'Plan Name', value: plan.name },
              { label: 'Technology', value: plan.technology ?? '—' },
              { label: 'Download Speed', value: plan.speedMbps + ' Mbps' },
              { label: 'Upload Speed', value: plan.speedMbps + ' Mbps' },
              { label: 'Monthly Price', value: fmtK(plan.priceKobo) },
              { label: 'Data Cap', value: plan.dataCapGb ? plan.dataCapGb + ' GB' : 'Unlimited' },
              { label: 'Started', value: sub?.startedAt ? new Date(sub.startedAt).toLocaleDateString() : '—' },
              { label: 'Expires', value: sub?.expiresAt ? new Date(sub.expiresAt).toLocaleDateString() : '—' },
              { label: 'Status', value: isExpired ? 'Expired' : sub?.expiresAt && isDue ? 'Due Soon' : 'Active' },
            ].map((f) => (
              <div key={f.label}>
                <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)', fontWeight: 700, marginBottom: 4 }}>{f.label}</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{f.value}</div>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No active plan</p>
        )}

        {plan && (
          <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Pay Ahead</div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                Total: <strong style={{ color: 'var(--primary)', fontSize: '0.95rem' }}>{fmtK(plan.priceKobo * months)}</strong> for {monthsLabel(months)}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {MONTH_OPTIONS.map(m => (
                <button key={m} onClick={() => setMonths(m)} disabled={paying}
                  style={{
                    padding: '7px 16px', borderRadius: 20, cursor: paying ? 'not-allowed' : 'pointer',
                    border: '1px solid ' + (months === m ? 'var(--primary)' : 'var(--border-color)'),
                    background: months === m ? 'var(--primary)' : '#fff',
                    color: months === m ? '#fff' : 'var(--text-color)',
                    fontWeight: 600, fontSize: '0.78rem',
                  }}>
                  {monthsLabel(m)}
                </button>
              ))}
            </div>
            <p style={{ margin: '10px 0 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Pay for several months at once — your expiry date is extended by the selected period.
            </p>
          </div>
        )}
      </div>

      {/* All Plans Drawer */}
      {drawer === 'change' && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}
          onClick={() => { if (!paying) setDrawer(null); }}>
          <div style={{ background: 'white', padding: 32, width: 600, maxWidth: '95vw', height: '100vh', overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.1)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <div>
                <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>
                  Choose a New Plan
                </h2>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Select a plan to switch. You will be charged the plan price for the selected period.
                </p>
              </div>
              <span style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => { if (!paying) setDrawer(null); }}>
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </span>
            </div>

            {/* Comparison highlight */}
            {plan && (
              <div style={{ padding: '12px 16px', borderRadius: 12, background: '#FFF7ED', marginBottom: 20, fontSize: '0.85rem' }}>
                <strong>Current:</strong> {plan.name} — {plan.speedMbps} Mbps — {fmtK(plan.priceKobo)}/mo
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {plans.filter(p => p.id !== plan?.id).length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>No other plans available. Contact support for custom plans.</p>
              ) : plans.filter(p => p.id !== plan?.id).map((p) => (
                <div key={p.id}
                  style={{
                    padding: '18px 20px', borderRadius: 16, cursor: paying ? 'not-allowed' : 'pointer',
                    border: '1px solid var(--border-color)', transition: 'all 0.15s',
                    opacity: paying ? 0.6 : 1,
                  }}
                  onClick={() => {
                    if (paying) return;
                    pay('change_plan', p.id);
                  }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: '1rem', marginBottom: 4 }}>{p.name}</div>
                      <div style={{ display: 'flex', gap: 12, fontSize: '0.8rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                        <span>{p.speedMbps} Mbps</span>
                        <span>{p.category}</span>
                        <span>{p.technology}</span>
                        <span>{p.dataCapGb ? p.dataCapGb + ' GB' : 'Unlimited'}</span>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', marginLeft: 16 }}>
                      <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--primary)' }}>{fmtK(p.priceKobo * months)}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{months > 1 ? `${fmtK(p.priceKobo)}/mo · ${monthsLabel(months)}` : '/month'}</div>
                    </div>
                  </div>
                  {paying && (
                    <div style={{ marginTop: 8, fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 600 }}>
                      Processing payment...
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
