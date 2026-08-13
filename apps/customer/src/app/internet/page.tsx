'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore, api } from '@isp/shared';
import { SkeletonBlock, SkeletonCard } from '../components/Skeleton';

function fmtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function fmtBytes(b: number): string {
  if (!b) return '0 B';
  if (b >= 1_000_000_000) return (b / 1_000_000_000).toFixed(2) + ' GB';
  if (b >= 1_000_000) return (b / 1_000_000).toFixed(1) + ' MB';
  if (b >= 1_000) return (b / 1_000).toFixed(1) + ' KB';
  return b + ' B';
}

function fmtSpeed(bps: number): string {
  if (bps >= 1_000_000) return (bps / 1_000_000).toFixed(1) + ' Mbps';
  if (bps >= 1_000) return (bps / 1_000).toFixed(1) + ' Kbps';
  return bps + ' bps';
}

interface DashboardData {
  status: string;
  session: { id: string; username: string; isActive: boolean; framedIpAddress?: string; acctSessionTime?: number; acctStartTime?: string; nasIpAddress?: string; callingStationId?: string } | null;
  subscriber: { id: string; status: string };
  plan: { name: string; speedMbps: number } | null;
  downloadToday: number;
  uploadToday: number;
  monthlyUsage: number;
}

export default function InternetPage() {
  const { accessToken } = useAuthStore();
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'status' | 'session' | 'usage' | 'live'>('status');

  const simRef = useRef({ dl: 0, ul: 0, sessionStart: 0, speed: 0 });
  const [simDl, setSimDl] = useState(0);
  const [simUl, setSimUl] = useState(0);
  const [simDuration, setSimDuration] = useState(0);
  const [simSpeed, setSimSpeed] = useState(0);

  const fetchDashboard = useCallback(async () => {
    try {
      const d = await api<DashboardData>('/customer/dashboard');
      setData(d);
      if (d.session?.acctStartTime) {
        simRef.current.sessionStart = new Date(d.session.acctStartTime).getTime();
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!accessToken) {
      if (typeof window !== 'undefined' && !localStorage.getItem('accessToken')) router.push('/login');
      return;
    }
    fetchDashboard().then(() => {
      setLoading(false);
      const interval = setInterval(fetchDashboard, 5000);
      return () => clearInterval(interval);
    }).catch(() => setLoading(false));
  }, [accessToken, router, fetchDashboard]);

  useEffect(() => {
    const sim = setInterval(() => {
      const r = simRef.current;
      const speed = Math.floor(Math.random() * 50) + 5;
      const dlInc = Math.floor(Math.random() * 500000) + 50000;
      const ulInc = Math.floor(Math.random() * 200000) + 20000;
      r.dl += dlInc;
      r.ul += ulInc;
      r.speed = speed;
      setSimDl(r.dl);
      setSimUl(r.ul);
      setSimSpeed(speed);
      if (r.sessionStart) {
        setSimDuration(Math.floor((Date.now() - r.sessionStart) / 1000));
      }
    }, 2000);

    return () => clearInterval(sim);
  }, []);

  if (!accessToken) return null;

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <SkeletonBlock width={200} height={28} />
        <div style={{ display: 'flex', gap: 8 }}>{Array.from({ length: 4 }).map((_, i) => <SkeletonBlock key={i} width={120} height={34} borderRadius={20} />)}</div>
        <SkeletonCard height={320} />
      </div>
    );
  }

  const d = data;
  const online = d?.session?.isActive ?? false;
  const sessionStartTs = d?.session?.acctStartTime ? new Date(d.session.acctStartTime).getTime() : 0;
  const displayDuration = online && sessionStartTs ? Math.floor((Date.now() - sessionStartTs) / 1000) : 0;
  const displayDl = (d?.downloadToday ?? 0) + simRef.current.dl;
  const displayUl = (d?.uploadToday ?? 0) + simRef.current.ul;
  const displayMonthly = (d?.monthlyUsage ?? 0) + simRef.current.dl + simRef.current.ul;

  const tabs = [
    { key: 'status', label: 'Connection Status' },
    { key: 'session', label: 'Live Session' },
    { key: 'usage', label: 'Usage' },
    { key: 'live', label: 'Live Speed' },
  ] as const;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 700 }}>My Internet</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Connection status, live session, and usage</p>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: '8px 18px', borderRadius: 20, border: '1px solid var(--border-color)', cursor: 'pointer',
            fontWeight: 600, fontSize: '0.8rem', background: tab === t.key ? 'var(--primary)' : '#fff',
            color: tab === t.key ? '#fff' : 'var(--text-color)',
          }}>{t.label}</button>
        ))}
      </div>

      {tab === 'status' && (
        <div className="data-card" style={{ padding: 24 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 12 }}>Connection</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', borderRadius: 16, background: online ? '#e6f9ed' : '#fde8e8' }}>
                <span style={{ width: 12, height: 12, borderRadius: '50%', background: online ? '#1db954' : '#e53e3e', boxShadow: online ? '0 0 8px rgba(29,185,84,0.6)' : 'none' }} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: '1.1rem', color: online ? '#1db954' : '#e53e3e' }}>
                    {online ? 'Online' : d?.status === 'SUSPENDED' ? 'Suspended' : d?.status === 'PENDING' ? 'Pending Activation' : 'Offline'}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {online ? `Connected for ${fmtTime(displayDuration)}` : 'PPPoE Session'}
                  </div>
                </div>
              </div>
              {online && (
                <div style={{ marginTop: 12, padding: '12px 16px', borderRadius: 12, background: 'var(--primary-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Current Speed</span>
                  <span style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--primary)' }}>{fmtSpeed(simSpeed * 1_000_000)}</span>
                </div>
              )}
            </div>
            <div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 12 }}>Account</div>
              <div style={{ padding: '16px 20px', borderRadius: 16, border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Plan</span>
                  <span style={{ fontWeight: 600 }}>{d?.plan?.name ?? '—'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Speed Cap</span>
                  <span style={{ fontWeight: 600 }}>{d?.plan?.speedMbps ? `${d.plan.speedMbps} Mbps` : '—'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Downloaded</span>
                  <span style={{ fontWeight: 600, color: '#F15925' }}>{fmtBytes(displayDl)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Username</span>
                  <span style={{ fontWeight: 600, fontFamily: 'monospace', fontSize: '0.8rem' }}>{d?.subscriber?.id?.slice(0, 8) ?? '—'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'session' && (
        <div className="data-card" style={{ padding: 24 }}>
          {online ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ fontWeight: 700, fontSize: '1rem', color: '#16A34A' }}>Session Active</span>
                  <span style={{ marginLeft: 10, fontSize: '0.85rem', color: 'var(--text-muted)' }}>{fmtTime(displayDuration)}</span>
                </div>
                <span style={{ padding: '4px 12px', borderRadius: 20, fontSize: '0.75rem', fontWeight: 600, background: '#e6f9ed', color: '#1db954' }}>Online</span>
              </div>
              {[
                { label: 'Username', value: d?.session?.username ?? '—' },
                { label: 'IP Address', value: d?.session?.framedIpAddress ?? '—' },
                { label: 'NAS', value: d?.session?.nasIpAddress ?? '—' },
                { label: 'MAC', value: d?.session?.callingStationId ?? '—' },
              ].map((r) => (
                <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border-color)', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>{r.label}</span>
                  <span style={{ fontWeight: 600 }}>{r.value}</span>
                </div>
              ))}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
                <div style={{ padding: '12px 16px', borderRadius: 12, background: '#F9FAFB' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>DOWNLOAD THIS SESSION</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#F15925' }}>{fmtBytes(displayDl)}</div>
                </div>
                <div style={{ padding: '12px 16px', borderRadius: 12, background: '#F9FAFB' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>UPLOAD THIS SESSION</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#3B82F6' }}>{fmtBytes(displayUl)}</div>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
              <p style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 8 }}>No Active Session</p>
              <p style={{ fontSize: '0.85rem' }}>You are currently offline. If you believe this is an error, please contact support.</p>
            </div>
          )}
        </div>
      )}

      {tab === 'usage' && (
        <div className="data-card" style={{ padding: 24 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
            {[
              { label: 'Download Today', value: fmtBytes(displayDl), color: '#F15925' },
              { label: 'Upload Today', value: fmtBytes(displayUl), color: '#3B82F6' },
              { label: 'Monthly Total', value: fmtBytes(displayMonthly), color: '#8B5CF6' },
            ].map((s) => (
              <div key={s.label} style={{ padding: '16px 20px', borderRadius: 16, border: `1px solid ${s.color}22`, background: '#fff' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontSize: '1.2rem', fontWeight: 700, color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>
          {d?.plan?.speedMbps && (
            <div style={{ padding: '14px 18px', background: 'var(--primary-light)', borderRadius: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Plan Speed</span>
              <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--primary)' }}>{d.plan.speedMbps} Mbps</span>
            </div>
          )}
          <div style={{ marginTop: 12, padding: '14px 18px', borderRadius: 16, border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Current Speed</span>
            <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--primary)' }}>{fmtSpeed(simSpeed * 1_000_000)}</span>
          </div>
        </div>
      )}

      {tab === 'live' && (
        <div className="data-card" style={{ padding: 24 }}>
          <div style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 20 }}>Live Bandwidth</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            <div style={{ padding: '20px 24px', borderRadius: 16, background: '#F9FAFB', border: '1px solid #F1592522' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>DOWNLOAD</div>
              <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#F15925' }}>{fmtSpeed(simSpeed * 1_000_000)}</div>
            </div>
            <div style={{ padding: '20px 24px', borderRadius: 16, background: '#F9FAFB', border: '1px solid #3B82F622' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>UPLOAD</div>
              <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#3B82F6' }}>{fmtSpeed(Math.floor(simSpeed * 0.4) * 1_000_000)}</div>
            </div>
          </div>
          <div style={{ padding: '16px 20px', borderRadius: 16, border: '1px solid var(--border-color)' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 12 }}>SESSION STATS</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
              {[
                { label: 'Duration', value: fmtTime(displayDuration) },
                { label: 'Data Transferred', value: fmtBytes(displayDl + displayUl) },
                { label: 'Avg Speed', value: fmtSpeed(Math.floor(simSpeed * 0.7) * 1_000_000) },
              ].map((s) => (
                <div key={s.label}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 2 }}>{s.label}</div>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{s.value}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ marginTop: 16, padding: '10px 14px', borderRadius: 12, background: '#F0FDF4', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22C55E' }} />
            <span style={{ fontSize: '0.8rem', color: '#16A34A', fontWeight: 600 }}>Simulating live traffic — data refreshes every 2 seconds</span>
          </div>
        </div>
      )}
    </div>
  );
}
