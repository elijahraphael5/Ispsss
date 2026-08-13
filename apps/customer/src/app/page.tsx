'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore, api } from '@isp/shared';
import { SkeletonBlock, SkeletonCard } from './components/Skeleton';

const statusColors: Record<string, { bg: string; fg: string }> = {
  ACTIVE: { bg: '#e6f9ed', fg: '#1db954' },
  SUSPENDED: { bg: '#fde8e8', fg: '#e53e3e' },
  EXPIRED: { bg: '#fef9c3', fg: '#854d0e' },
  PENDING: { bg: '#dbeafe', fg: '#1e40af' },
};

function fmtK(k: number) { return `\u20A6${(k / 100).toLocaleString()}`; }

interface DashboardData {
  plan?: { name: string; speedMbps: number; priceKobo: number };
  status: string;
  subscription?: { id: string; status: string; type: string; address?: string };
  cpe?: { id: string; model: string; macAddress: string };
  session?: { username: string; isActive: boolean; framedIpAddress?: string; acctSessionTime?: number; acctStartTime?: string };
  outstandingKobo: number;
  lastPayment?: { amountKobo: number; createdAt: string };
  downloadToday: number;
  uploadToday: number;
  monthlyUsage: number;
}

export default function CustomerDashboard() {
  const { user, accessToken } = useAuthStore();
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accessToken && typeof window !== 'undefined' && !localStorage.getItem('accessToken')) {
      router.push('/login');
    }
  }, [accessToken, router]);

  useEffect(() => {
    if (!accessToken) return;
    api<DashboardData>('/customer/dashboard').then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [accessToken]);

  if (!user) return null;

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <SkeletonBlock width={260} height={28} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} height={100} />)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} height={80} />)}
        </div>
        <div className="data-card" style={{ padding: 24, height: 180 }} />
      </div>
    );
  }

  const d = data;
  const sc = statusColors[d?.status ?? 'PENDING'] ?? statusColors.PENDING;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            My Dashboard
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Welcome back, {user.email?.split('@')[0] ?? 'Customer'}</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        <div className="data-card" style={{ padding: '18px 20px' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Connection Status</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: sc.fg }} />
            <span style={{ fontSize: '1.1rem', fontWeight: 700, color: sc.fg }}>{d?.status ?? '—'}</span>
          </div>
        </div>
        <div className="data-card" style={{ padding: '18px 20px' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Current Plan</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{d?.plan?.name ?? '—'}</div>
          {d?.plan?.speedMbps && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{d.plan.speedMbps} Mbps</div>}
        </div>
        <div className="data-card" style={{ padding: '18px 20px' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Outstanding Balance</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: (d?.outstandingKobo ?? 0) > 0 ? '#DC2626' : '#16A34A' }}>{d ? fmtK(d.outstandingKobo) : '—'}</div>
        </div>
        <div className="data-card" style={{ padding: '18px 20px' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Monthly Usage</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{d ? `${(d.monthlyUsage / 1024 / 1024 / 1024).toFixed(2)} GB` : '—'}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Download today: {d ? `${(d.downloadToday / 1024 / 1024).toFixed(1)} MB` : '—'}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        <div className="data-card" style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Current IP</div>
            <div style={{ fontSize: '1rem', fontWeight: 600, fontFamily: 'monospace' }}>{d?.session?.framedIpAddress ?? '—'}</div>
          </div>
        </div>
        <div className="data-card" style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Last Payment</div>
            <div style={{ fontSize: '1rem', fontWeight: 600 }}>{d?.lastPayment ? fmtK(d.lastPayment.amountKobo) : '—'}</div>
            {d?.lastPayment && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{new Date(d.lastPayment.createdAt).toLocaleDateString()}</div>}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div className="data-card" style={{ padding: 24 }}>
          <div style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 16 }}>Quick Actions</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {[
              { label: 'View Invoices', href: '/billing', icon: '<rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>' },
              { label: 'Make Payment', href: '/payments', icon: '<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>' },
              { label: 'Open Ticket', href: '/support', icon: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' },
              { label: 'Check Usage', href: '/internet', icon: '<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>' },
            ].map((a) => (
              <div key={a.label} onClick={() => router.push(a.href)} style={{ padding: '14px 16px', borderRadius: 16, border: '1px solid var(--border-color)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, transition: 'background 0.15s' }}
                onMouseOver={e => (e.currentTarget.style.background = '#F8FAFC')}
                onMouseOut={e => (e.currentTarget.style.background = 'transparent')}>
                <svg width="18" height="18" fill="none" stroke="var(--primary)" strokeWidth="2" viewBox="0 0 24 24"><path d={a.icon.split('"')[1]} /></svg>
                <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{a.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="data-card" style={{ padding: 24 }}>
          <div style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 16 }}>Active Session</div>
          {d?.session?.isActive ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Status</span>
                <span style={{ fontWeight: 600, color: '#16A34A' }}>Online</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Username</span>
                <span style={{ fontWeight: 600 }}>{d.session.username}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>IP Address</span>
                <span style={{ fontWeight: 600, fontFamily: 'monospace' }}>{d.session.framedIpAddress}</span>
              </div>
              {d.session.acctStartTime && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Since</span>
                  <span style={{ fontWeight: 600 }}>{new Date(d.session.acctStartTime).toLocaleString()}</span>
                </div>
              )}
            </div>
          ) : (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No active session</p>
          )}
        </div>
      </div>
    </>
  );
}
