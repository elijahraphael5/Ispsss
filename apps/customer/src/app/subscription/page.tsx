'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore, api } from '@isp/shared';
import { loadPaysortaSDK, openPayment } from '@paysortadev/paysorta';
import { SkeletonBlock, SkeletonCard } from '../components/Skeleton';

function fmtK(k: number) { return '\u20A6' + (k / 100).toLocaleString(); }

interface DashboardData {
  plan: { id: string; name: string; speedMbps: number; priceKobo: number; dataCapGb?: number; technology?: string } | null;
  subscription: { id: string; startedAt?: string; expiresAt?: string; autoRenew: boolean; suspendedAt?: string | null } | null;
  subscriber: { id: string; createdAt: string; status: string };
}

interface Plan {
  id: string; name: string; speedMbps: number; priceKobo: number; dataCapGb?: number; technology?: string; category: string; type: string;
}

export default function SubscriptionPage() {
  const { accessToken, user } = useAuthStore();
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState<'change' | 'add' | null>(null);
  const [paying, setPaying] = useState(false);
  const sdkReady = useRef(false);

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
    loadPaysortaSDK().then(() => { sdkReady.current = true; });
    fetchAll().finally(() => setLoading(false));
  }, [accessToken, router, fetchAll]);

  const sub = data?.subscription;
  const plan = data?.plan;
  const email = user?.email ?? '';
  const paysortaKey = process.env.NEXT_PUBLIC_PAYSORTA_KEY ?? '';

  const isDue = sub?.expiresAt ? new Date(sub.expiresAt).getTime() - Date.now() < 7 * 86400000 : false;
  const isExpired = sub?.expiresAt ? new Date(sub.expiresAt).getTime() < Date.now() : false;

  async function pay(action: 'change_plan' | 'renew' | 'add_plan', planId?: string) {
    if (!sdkReady.current) await loadPaysortaSDK();
    const amount = 100 * 100; // For demo purposes, set to 1000 NGN. In production, calculate based on plan and action.

    setPaying(true);
    const ref = 'SUB_' + action + '_' + Date.now();
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
    try {
      await openPayment({
        key: paysortaKey,
        email,
        amount,
        currency: 'NGN',
        ref,
        metadata: { action, planId, userId: user?.id },
        callbackUrl: apiBase + '/payments/paysorta/callback?reference=' + ref + '&status=',
        onClose: () => setPaying(false),
        callback: async (response: any) => {
          const resultRef = response?.reference || ref;
          const resultStatus = response?.status === 'success' ? 'success' : 'failed';
          try {
            await api('/payments/webhook/paysorta', {
              method: 'POST',
              body: JSON.stringify({ reference: resultRef, status: resultStatus, metadata: { action, planId, userId: user?.id } }),
              skipAuth: true,
            });
            await fetchAll();
            router.push('/billing');
          } catch { alert('Payment received but verification failed. Contact support.'); }
          setPaying(false);
        },
      });
    } catch {
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

  const planPrice = plan?.priceKobo ? plan.priceKobo / 100 : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 700 }}>My Subscription</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>View and manage your plans</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-primary" onClick={() => setDrawer('change')} disabled={paying}>Change Plan</button>
          <button className="btn-primary" style={{ background: '#8B5CF6' }} onClick={() => setDrawer('add')} disabled={paying}>+ Add Plan</button>
        </div>
      </div>

      {/* Current Plan */}
      <div className="data-card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>Current Plan</div>
          {(isDue || isExpired) && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{
                fontSize: '0.75rem', padding: '4px 12px', borderRadius: 20, fontWeight: 600,
                background: isExpired ? '#FEE2E2' : '#FEF3C7', color: isExpired ? '#DC2626' : '#D97706'
              }}>
                {isExpired ? 'Expired' : 'Due Soon'}
              </span>
              <button onClick={() => pay('renew')} disabled={paying}
                style={{
                  padding: '6px 18px', borderRadius: 20, border: 'none', fontWeight: 600, fontSize: '0.8rem',
                  cursor: paying ? 'not-allowed' : 'pointer', background: 'var(--primary)', color: '#fff'
                }}>
                {paying ? 'Processing...' : 'Renew \u20A6' + planPrice.toLocaleString()}
              </button>
            </div>
          )}
        </div>
        {plan ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
            {[
              { label: 'Plan Name', value: plan.name },
              { label: 'Technology', value: plan.technology ?? '—' },
              { label: 'Download Speed', value: plan.speedMbps + ' Mbps' },
              { label: 'Upload Speed', value: plan.speedMbps + ' Mbps' },
              { label: 'Monthly Price', value: fmtK(plan.priceKobo) },
              { label: 'Auto Renew', value: sub?.autoRenew ? 'Yes' : 'No' },
              { label: 'Expires', value: sub?.expiresAt ? new Date(sub.expiresAt).toLocaleDateString() : '—' },
              { label: 'Status', value: isExpired ? 'Expired' : sub?.expiresAt && isDue ? 'Due Soon' : 'Active' },
              { label: 'Data Cap', value: plan.dataCapGb ? plan.dataCapGb + ' GB' : 'Unlimited' },
            ].map((f) => (
              <div key={f.label}>
                <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700, marginBottom: 4 }}>{f.label}</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{f.value}</div>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ color: 'var(--text-muted)' }}>No active plan</p>
        )}
      </div>

      {/* Subscription Details */}
      <div className="data-card" style={{ padding: 24 }}>
        <div style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 12 }}>Subscription Details</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
          {[
            { label: 'Status', value: data?.subscriber?.status ?? '—' },
            { label: 'Started', value: sub?.startedAt ? new Date(sub.startedAt).toLocaleDateString() : '—' },
            { label: 'Expires', value: sub?.expiresAt ? new Date(sub.expiresAt).toLocaleDateString() : '—' },
            { label: 'Auto Renew', value: sub?.autoRenew ? 'Yes' : 'No' },
          ].map((f) => (
            <div key={f.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border-color)', fontSize: '0.85rem' }}>
              <span style={{ color: 'var(--text-muted)' }}>{f.label}</span>
              <span style={{ fontWeight: 600 }}>{f.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* All Plans Drawer */}
      {(drawer === 'change' || drawer === 'add') && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}
          onClick={() => { if (!paying) setDrawer(null); }}>
          <div style={{ background: 'white', padding: 32, width: 600, maxWidth: '95vw', height: '100vh', overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.1)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <div>
                <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>
                  {drawer === 'change' ? 'Choose a New Plan' : 'Add Another Plan'}
                </h2>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {drawer === 'change' ? 'Select a plan to switch. You will be charged the difference.' : 'Add an additional ISP plan to your account.'}
                </p>
              </div>
              <span style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => { if (!paying) setDrawer(null); }}>
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </span>
            </div>

            {/* Comparison highlight */}
            {plan && drawer === 'change' && (
              <div style={{ padding: '12px 16px', borderRadius: 12, background: '#FFF7ED', marginBottom: 20, fontSize: '0.85rem' }}>
                <strong>Current:</strong> {plan.name} — {plan.speedMbps} Mbps — {fmtK(plan.priceKobo)}/mo
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {plans.filter(p => drawer === 'add' || p.id !== plan?.id).length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>No other plans available. Contact support for custom plans.</p>
              ) : plans.filter(p => drawer === 'add' || p.id !== plan?.id).map((p) => (
                <div key={p.id}
                  style={{
                    padding: '18px 20px', borderRadius: 16, cursor: paying ? 'not-allowed' : 'pointer',
                    border: '1px solid var(--border-color)', transition: 'all 0.15s',
                    opacity: paying ? 0.6 : 1,
                  }}
                  onClick={() => {
                    if (paying) return;
                    pay(drawer === 'change' ? 'change_plan' : 'add_plan', p.id);
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
                      <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--primary)' }}>{fmtK(p.priceKobo)}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>/month</div>
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
