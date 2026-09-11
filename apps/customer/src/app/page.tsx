'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore, api, formatNaira } from '@isp/shared';
import { SkeletonBlock, SkeletonCard } from './components/Skeleton';
import InternetView from './components/InternetView';
import AnalyticsView from './components/AnalyticsView';

const statusColors: Record<string, { bg: string; fg: string }> = {
  ACTIVE: { bg: '#e6f9ed', fg: '#1db954' },
  SUSPENDED: { bg: '#fde8e8', fg: '#e53e3e' },
  EXPIRED: { bg: '#fef9c3', fg: '#854d0e' },
  PENDING: { bg: '#dbeafe', fg: '#1e40af' },
};

function fmtK(k: number) { return formatNaira(k); }

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
  const [view, setView] = useState<'overview' | 'internet' | 'analytics'>('overview');

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

  if (loading && view === 'overview') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <SkeletonBlock width={260} height={28} />
        <div className="grid-4">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} height={100} />)}
        </div>
        <div className="grid-3">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} height={80} />)}
        </div>
        <div className="data-card" style={{ padding: 24, height: 180 }} />
      </div>
    );
  }

  const d = data;
  const sc = statusColors[d?.status ?? 'PENDING'] ?? statusColors.PENDING;
  const firstName = user.name?.trim().split(/\s+/)[0] || user.email?.split('@')[0] || 'Customer';

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            Welcome, {firstName}
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            {view === 'internet' ? 'Connection status, live session, and usage' : view === 'analytics' ? 'Usage, billing, and account insights' : "Here's an overview of your account"}
          </p>
        </div>
      </div>

      <div className="badge-tabs" style={{ width: 'fit-content' }}>
        {([['overview', 'Overview'], ['internet', 'Internet'], ['analytics', 'Analytics']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setView(key)}
            className={`tab-item${view === key ? ' active' : ''}`}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit', fontWeight: 600 }}>
            {label}
          </button>
        ))}
      </div>

      {view === 'overview' && (
        <>
      <div className="grid-4">
        {[
          {
            label: 'Connection Status', value: d?.status ?? '—',
            sub: d?.session?.isActive ? 'Session online' : 'PPPoE session', color: sc.fg,
            icon: <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>,
          },
          {
            label: 'Current Plan', value: d?.plan?.name ?? '—',
            sub: d?.plan?.speedMbps ? `${d.plan.speedMbps} Mbps` : null, color: '#2563EB',
            icon: <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>,
          },
          {
            label: 'Outstanding Balance', value: d ? fmtK(d.outstandingKobo) : '—',
            sub: (d?.outstandingKobo ?? 0) > 0 ? 'Payment due' : 'All settled',
            color: (d?.outstandingKobo ?? 0) > 0 ? '#DC2626' : '#16A34A',
            icon: <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>,
          },
          {
            label: 'Monthly Usage', value: d ? `${(d.monthlyUsage / 1024 / 1024 / 1024).toFixed(2)} GB` : '—',
            sub: d ? `Download today: ${(d.downloadToday / 1024 / 1024).toFixed(1)} MB` : null, color: '#8B5CF6',
            icon: <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
          },
        ].map(k => (
          <div key={k.label} className="data-card" style={{ padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 42, height: 42, borderRadius: 12, background: `${k.color}14`, color: k.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {k.icon}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>{k.label}</div>
              <div style={{ fontSize: '1.15rem', fontWeight: 700, color: k.color, whiteSpace: 'nowrap' }}>{k.value}</div>
              {k.sub && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 1 }}>{k.sub}</div>}
            </div>
          </div>
        ))}
      </div>

      <div className="grid-2">
        <div className="data-card" style={{ padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: '#0EA5E914', color: '#0EA5E9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>Current IP</div>
            <div style={{ fontSize: '1rem', fontWeight: 700, fontFamily: 'monospace' }}>{d?.session?.framedIpAddress ?? '—'}</div>
          </div>
        </div>
        <div className="data-card" style={{ padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: '#16A34A14', color: '#16A34A', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>Last Payment</div>
            <div style={{ fontSize: '1rem', fontWeight: 700 }}>{d?.lastPayment ? fmtK(d.lastPayment.amountKobo) : '—'}</div>
            {d?.lastPayment && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{new Date(d.lastPayment.createdAt).toLocaleDateString()}</div>}
          </div>
        </div>
      </div>

      <div className="grid-2" style={{ gap: 20 }}>
        <div className="data-card" style={{ padding: 20 }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: 14 }}>Quick Actions</div>
          <div className="grid-2" style={{ gap: 10 }}>
            {[
              { label: 'View Invoices', href: '/billing', icon: 'M1 5h22v14H1zM1 10h22' },
              { label: 'Make Payment', href: '/billing?tab=Payments', icon: 'M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' },
              { label: 'Open Ticket', href: '/support', icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' },
              { label: 'Check Usage', href: '/internet', icon: 'M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M12 20h.01' },
            ].map((a) => (
              <div key={a.label} onClick={() => router.push(a.href)}
                style={{ padding: '12px 14px', borderRadius: 14, border: '1px solid var(--border-color)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, transition: 'background 0.15s' }}
                onMouseOver={e => (e.currentTarget.style.background = '#F8FAFC')}
                onMouseOut={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--primary-light)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d={a.icon} /></svg>
                </span>
                <span style={{ fontWeight: 600, fontSize: '0.82rem' }}>{a.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="data-card" style={{ padding: 20 }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: 14 }}>Active Session</div>
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
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '18px 0', color: 'var(--text-muted)' }}>
              <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" style={{ opacity: 0.45 }}><path d="M18.36 6.64A9 9 0 1 1 5.64 6.64"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
              <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>No active session</span>
            </div>
          )}
        </div>
      </div>
        </>
      )}

      {view === 'internet' && <InternetView />}
      {view === 'analytics' && <AnalyticsView />}
    </>
  );
}
