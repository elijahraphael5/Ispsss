'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore, api, formatNaira } from '@isp/shared';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, LineChart, Line, ComposedChart, CartesianGrid,
} from 'recharts';
import { SkeletonBlock, SkeletonCard } from '../components/Skeleton';

function fmtBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function fmtKobo(kobo: number): string {
  return formatNaira(kobo);
}

function fmtDuration(secs: number | null): string {
  if (!secs) return '—';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${h}h ${m}m ${s}s`;
}

function fmtSpeed(bps: number): string {
  if (bps >= 1_000_000) return (bps / 1_000_000).toFixed(1) + ' Mbps';
  if (bps >= 1_000) return (bps / 1_000).toFixed(1) + ' Kbps';
  return bps + ' bps';
}

const now = () => new Date();
const pad = (n: number) => n.toString().padStart(2, '0');
const timeKey = () => pad(now().getHours()) + ':' + pad(now().getMinutes());

let globalHourly: Record<string, { hour: string; download: number; upload: number; sessions: number }> = {};
let globalSpeedSamples: { time: string; download: number; upload: number }[] = [];

function ensureHourSlot(hourKey: string) {
  if (!globalHourly[hourKey]) globalHourly[hourKey] = { hour: hourKey, download: 0, upload: 0, sessions: 0 };
}

// Fill last 24h slots
for (let i = 23; i >= 0; i--) {
  const d = new Date(Date.now() - i * 3600000);
  const hk = pad(d.getHours()) + ':00';
  ensureHourSlot(hk);
}

export default function AnalyticsPage() {
  const { accessToken } = useAuthStore();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [usageRange, setUsageRange] = useState<'7d' | '30d'>('30d');
  const [tab, setTab] = useState<'overview' | 'live'>('overview');

  const [simDl, setSimDl] = useState(0);
  const [simUl, setSimUl] = useState(0);
  const [simSpeed, setSimSpeed] = useState(0);
  const [speedChart, setSpeedChart] = useState<{ time: string; download: number; upload: number }[]>([]);
  const [hourlyData, setHourlyData] = useState<any[]>([]);
  const [cumulativeData, setCumulativeData] = useState<{ t: string; total: number }[]>([]);

  const cumulRef = useRef<{ t: string; total: number }[]>([]);
  const fetchAnalytics = useCallback(async () => {
    try {
      const d = await api<any>('/customer/analytics');
      setData(d);
    } catch {}
  }, []);

  useEffect(() => {
    if (!accessToken) {
      if (typeof window !== 'undefined' && !localStorage.getItem('accessToken')) router.push('/login');
      return;
    }
    fetchAnalytics().then(() => setLoading(false)).catch(() => setLoading(false));
    const interval = setInterval(fetchAnalytics, 6000);
    return () => clearInterval(interval);
  }, [accessToken, router, fetchAnalytics]);

  useEffect(() => {
    // Speed simulation: every 1.2s
    const speed = setInterval(() => {
      const dl = Math.floor(Math.random() * 50) + 5;
      const ul = Math.floor(Math.random() * 20) + 2;
      const dlBytes = Math.floor(Math.random() * 1500000) + 200000;
      const ulBytes = Math.floor(Math.random() * 500000) + 50000;

      setSimDl(prev => prev + dlBytes);
      setSimUl(prev => prev + ulBytes);
      setSimSpeed(dl);

      const tk = timeKey();

      // Speed samples (rolling 60s window)
      const ss = { time: tk, download: dl, upload: ul };
      globalSpeedSamples.push(ss);
      if (globalSpeedSamples.length > 50) globalSpeedSamples.splice(0, globalSpeedSamples.length - 50);
      setSpeedChart([...globalSpeedSamples]);

      // Hourly accumulation
      const hourKey = pad(now().getHours()) + ':00';
      ensureHourSlot(hourKey);
      globalHourly[hourKey].download += dlBytes;
      globalHourly[hourKey].upload += ulBytes;
      globalHourly[hourKey].sessions += 1;
      setHourlyData(Object.values(globalHourly).sort((a, b) => a.hour.localeCompare(b.hour)));

      // Cumulative line
      const total = dlBytes + ulBytes + (cumulRef.current.length > 0 ? cumulRef.current[cumulRef.current.length - 1].total : 0);
      cumulRef.current.push({ t: tk, total });
      if (cumulRef.current.length > 60) cumulRef.current.splice(0, cumulRef.current.length - 60);
      setCumulativeData([...cumulRef.current]);
    }, 1200);

    return () => clearInterval(speed);
  }, []);

  if (!accessToken) return null;

  if (loading) {
    return <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <SkeletonBlock width={200} height={28} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} height={100} />)}
      </div>
      <SkeletonCard height={280} />
      <SkeletonCard height={280} />
    </div>;
  }

  const usageData = (data?.usageTrend ?? []).filter((d: any) => {
    if (usageRange === '7d') {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      return d.date >= sevenDaysAgo;
    }
    return true;
  });

  const uptimePct = data?.totalSessionSeconds && data?.totalSessionSeconds > 0
    ? Math.min(100, Math.round((data.totalSessionSeconds / Math.max(data.totalSessions * 86400, 1)) * 100))
    : 0;

  const totalDl = (data?.totalDownloadBytes ?? 0) + simDl;
  const totalUl = (data?.totalUploadBytes ?? 0) + simUl;

  const summaryCards = [
    { label: 'Total Data Used', value: fmtBytes(totalDl + totalUl), sub: (data?.totalSessions ?? 0) + ' sessions', accent: '#F15925' },
    { label: 'Total Spent', value: fmtKobo(data?.totalPaidKobo || 0), sub: 'Avg ' + fmtKobo(data?.avgPaymentKobo || 0) + ' / payment', accent: '#3B82F6' },
    { label: 'Connection Uptime', value: uptimePct + '%', sub: fmtDuration(data?.totalSessionSeconds ?? 0) + ' total', accent: '#22C55E' },
    { label: 'Live Speed', value: fmtSpeed(simSpeed * 1_000_000), sub: fmtBytes(simDl + simUl) + ' this session', accent: '#8B5CF6' },
  ];

  const liveSpeed = simSpeed;
  const liveUpload = Math.floor(simSpeed * 0.35);
  const avgSpeed = globalSpeedSamples.length > 0
    ? Math.round(globalSpeedSamples.reduce((s, v) => s + v.download, 0) / globalSpeedSamples.length)
    : 0;
  const peakSpeed = globalSpeedSamples.length > 0
    ? Math.max(...globalSpeedSamples.map(v => v.download))
    : 0;

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'live', label: 'Live Bandwidth' },
  ] as const;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 700 }}>Analytics</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Usage, billing, and account insights</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{ padding: '6px 16px', borderRadius: 20, border: '1px solid var(--border-color)', cursor: 'pointer',
                fontWeight: 600, fontSize: '0.8rem', background: tab === t.key ? 'var(--primary)' : '#fff',
                color: tab === t.key ? '#fff' : 'var(--text-color)' }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'overview' ? (
        <>
          {/* Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
            {summaryCards.map((c) => (
              <div key={c.label} className="data-card" style={{ padding: '20px 24px', borderTop: '3px solid ' + c.accent }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>{c.label}</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 700, color: c.accent, fontVariantNumeric: 'tabular-nums' }}>{c.value}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{c.sub}</div>
              </div>
            ))}
          </div>

          {/* Live Speed Sparkline + Daily Usage Combo */}
          <div className="data-card" style={{ padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <span style={{ fontSize: '1.05rem', fontWeight: 700 }}>Live Bandwidth — </span>
                <span style={{ fontSize: '0.9rem', color: '#F15925', fontWeight: 700 }}>{fmtSpeed(liveSpeed * 1_000_000)}</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 8 }}>↓</span>
                <span style={{ fontSize: '0.75rem', color: '#3B82F6', marginLeft: 4, fontWeight: 600 }}>{fmtSpeed(liveUpload * 1_000_000)}</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 4 }}>↑</span>
              </div>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                Avg {fmtSpeed(avgSpeed * 1_000_000)} · Peak {fmtSpeed(peakSpeed * 1_000_000)}
              </span>
            </div>
            <ResponsiveContainer width="100%" height={140}>
              <AreaChart data={speedChart} syncId="live">
                <defs>
                  <linearGradient id="liveDl" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#F15925" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#F15925" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="liveUl" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#3B82F6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#94a3b8' }} interval={4} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#94a3b8' }} width={50}
                  tickFormatter={(v: number) => v + 'M'} domain={[0, 55]} />
                <Tooltip
                  formatter={(value: number, name: string) => [fmtSpeed(value * 1_000_000), name === 'download' ? 'Download' : 'Upload']}
                  contentStyle={{ borderRadius: 10, border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}
                  labelStyle={{ fontWeight: 600, fontSize: '0.8rem' }} />
                <Area type="monotone" dataKey="download" stroke="#F15925" strokeWidth={2} fill="url(#liveDl)" dot={false} animationDuration={400} name="download" />
                <Area type="monotone" dataKey="upload" stroke="#3B82F6" strokeWidth={2} fill="url(#liveUl)" dot={false} animationDuration={400} name="upload" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Hourly Usage (last 24h) - Real-time filling */}
          <div className="data-card" style={{ padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>Hourly Usage (Last 24h)</div>
              <div style={{ display: 'flex', gap: 16, fontSize: '0.8rem' }}>
                <span><span style={{ color: '#F15925', fontWeight: 700 }}>●</span> Download: {fmtBytes(hourlyData.reduce((s, d) => s + d.download, 0))}</span>
                <span><span style={{ color: '#3B82F6', fontWeight: 700 }}>●</span> Upload: {fmtBytes(hourlyData.reduce((s, d) => s + d.upload, 0))}</span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={hourlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="hour" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#94a3b8' }} interval={2} />
                <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#94a3b8' }} width={55}
                  tickFormatter={(v: number) => fmtBytes(v)} />
                <Tooltip
                  formatter={(value: number, name: string) => [fmtBytes(value), name === 'download' ? 'Download' : 'Upload']}
                  contentStyle={{ borderRadius: 10, border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}
                  labelStyle={{ fontWeight: 600, fontSize: '0.8rem' }} />
                <Bar yAxisId="left" dataKey="download" fill="#F15925" radius={[3, 3, 0, 0]} opacity={0.7} animationDuration={600} name="download" />
                <Bar yAxisId="left" dataKey="upload" fill="#3B82F6" radius={[3, 3, 0, 0]} opacity={0.7} animationDuration={600} name="upload" />
                <Line yAxisId="left" type="monotone" dataKey="sessions" stroke="#8B5CF6" strokeWidth={2} dot={false} name="Sessions" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Daily Usage Trend */}
          <div className="data-card" style={{ padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>Daily Data Usage</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['7d', '30d'] as const).map(r => (
                  <button key={r} onClick={() => setUsageRange(r)}
                    style={{ padding: '5px 14px', borderRadius: 20, border: 'none', fontWeight: 600, fontSize: '0.75rem', cursor: 'pointer',
                      background: usageRange === r ? 'var(--primary)' : '#F1F5F9', color: usageRange === r ? '#fff' : '#64748B' }}>
                    {r === '7d' ? '7 Days' : '30 Days'}
                  </button>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={usageData}>
                <defs>
                  <linearGradient id="dlGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#F15925" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#F15925" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="ulGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#3B82F6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }}
                  tickFormatter={(v: string) => v.slice(5)} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }}
                  tickFormatter={(v: number) => fmtBytes(v)} width={60} />
                <Tooltip formatter={(value: number) => fmtBytes(value)}
                  contentStyle={{ borderRadius: 10, border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}
                  labelStyle={{ fontWeight: 600 }} />
                <Area type="monotone" dataKey="download" stroke="#F15925" strokeWidth={2} fill="url(#dlGrad)" dot={false} animationDuration={500} name="Download" />
                <Area type="monotone" dataKey="upload" stroke="#3B82F6" strokeWidth={2} fill="url(#ulGrad)" dot={false} animationDuration={500} name="Upload" />
              </AreaChart>
            </ResponsiveContainer>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginTop: 10, fontSize: '0.85rem' }}>
              <span><span style={{ color: '#F15925', fontWeight: 700 }}>●</span> Total Download: {fmtBytes(usageData.reduce((s, d) => s + d.download, 0))}</span>
              <span><span style={{ color: '#3B82F6', fontWeight: 700 }}>●</span> Total Upload: {fmtBytes(usageData.reduce((s, d) => s + d.upload, 0))}</span>
            </div>
          </div>

          {/* Billing + Cumulative Combo */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div className="data-card" style={{ padding: 24 }}>
              <div style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 16 }}>Monthly Billing</div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data?.billingTrend ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#94a3b8' }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#94a3b8' }}
                    tickFormatter={(v: number) => fmtKobo(v)} width={55} />
                  <Tooltip formatter={(value: number) => fmtKobo(value)}
                    contentStyle={{ borderRadius: 10, border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }} />
                  <Bar dataKey="total" fill="#F15925" radius={[4, 4, 0, 0]} name="Total Billed" animationDuration={600} />
                  <Bar dataKey="paid" fill="#22c55e" radius={[4, 4, 0, 0]} name="Paid" animationDuration={600} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="data-card" style={{ padding: 24 }}>
              <div style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 16 }}>Session Data Transfer</div>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={cumulativeData}>
                  <defs>
                    <linearGradient id="cumulGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8B5CF6" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#8B5CF6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="t" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#94a3b8' }} interval={5} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#94a3b8' }}
                    tickFormatter={(v: number) => fmtBytes(v)} width={55} />
                  <Tooltip formatter={(value: number) => fmtBytes(value)}
                    contentStyle={{ borderRadius: 10, border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }} />
                  <Area type="monotone" dataKey="total" stroke="#8B5CF6" strokeWidth={2} fill="url(#cumulGrad)" dot={false} animationDuration={400} name="Transferred" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Recent Sessions Table */}
          <div className="data-card" style={{ padding: 0 }}>
            <div style={{ padding: '18px 24px', fontSize: '1.05rem', fontWeight: 700, borderBottom: '1px solid var(--border-color)' }}>Recent Sessions</div>
            <div className="table-container"><div className="table-scroll">
              <table>
                <thead><tr>
                  <th>Start</th><th>Duration</th><th>Download</th><th>Upload</th><th>IP Address</th>
                </tr></thead>
                <tbody>
                  {(data?.recentSessions ?? []).length === 0 ? (
                    <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>No sessions recorded</td></tr>
                  ) : (data?.recentSessions ?? []).slice(0, 10).map((s: any, i: number) => (
                    <tr key={i}>
                      <td style={{ fontSize: '0.85rem' }}>{s.startTime ? new Date(s.startTime).toLocaleString('en-GB') : '—'}</td>
                      <td>{fmtDuration(s.duration)}</td>
                      <td>{fmtBytes(s.download)}</td>
                      <td>{fmtBytes(s.upload)}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{s.ip || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div></div>
          </div>
        </>
      ) : (
        <>
          {/* Live Bandwidth Dials */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="data-card" style={{ padding: '32px 36px', textAlign: 'center' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>Download</div>
              <div style={{ fontSize: '2.6rem', fontWeight: 700, color: '#F15925', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
                {fmtSpeed(liveSpeed * 1_000_000)}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 6 }}>
                {fmtBytes(simDl)} transferred
              </div>
            </div>
            <div className="data-card" style={{ padding: '32px 36px', textAlign: 'center' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>Upload</div>
              <div style={{ fontSize: '2.6rem', fontWeight: 700, color: '#3B82F6', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
                {fmtSpeed(liveUpload * 1_000_000)}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 6 }}>
                {fmtBytes(simUl)} transferred
              </div>
            </div>
          </div>

          {/* Speed Trend Chart */}
          <div className="data-card" style={{ padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>Live Speed Trend</div>
              <div style={{ display: 'flex', gap: 12, fontSize: '0.8rem' }}>
                <span><span style={{ color: '#22C55E', fontWeight: 700 }}>●</span> Avg: {fmtSpeed(avgSpeed * 1_000_000)}</span>
                <span><span style={{ color: '#F15925', fontWeight: 700 }}>●</span> Peak: {fmtSpeed(peakSpeed * 1_000_000)}</span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={speedChart} syncId="live">
                <defs>
                  <linearGradient id="liveDlBig" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#F15925" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#F15925" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="liveUlBig" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#3B82F6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} interval={4} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} width={60}
                  tickFormatter={(v: number) => v + ' Mbps'} domain={[0, 55]} />
                <Tooltip
                  formatter={(value: number, name: string) => [fmtSpeed(value * 1_000_000), name === 'download' ? 'Download' : 'Upload']}
                  contentStyle={{ borderRadius: 10, border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}
                  labelStyle={{ fontWeight: 600 }} />
                <Area type="monotone" dataKey="download" stroke="#F15925" strokeWidth={2.5} fill="url(#liveDlBig)" dot={false} animationDuration={300} name="download" />
                <Area type="monotone" dataKey="upload" stroke="#3B82F6" strokeWidth={2.5} fill="url(#liveUlBig)" dot={false} animationDuration={300} name="upload" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Cumulative Transfer + Quick Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div className="data-card" style={{ padding: 24 }}>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: 12 }}>Session Data Transfer</div>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={cumulativeData}>
                  <defs>
                    <linearGradient id="cumulLive" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8B5CF6" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#8B5CF6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="t" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#94a3b8' }} interval={5} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#94a3b8' }}
                    tickFormatter={(v: number) => fmtBytes(v)} width={55} />
                  <Tooltip formatter={(value: number) => fmtBytes(value)}
                    contentStyle={{ borderRadius: 10, border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }} />
                  <Area type="monotone" dataKey="total" stroke="#8B5CF6" strokeWidth={2} fill="url(#cumulLive)" dot={false} animationDuration={300} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="data-card" style={{ padding: 24 }}>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: 16 }}>Session Stats</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[
                  { label: 'Current DL', value: fmtSpeed(liveSpeed * 1_000_000), accent: '#F15925' },
                  { label: 'Current UL', value: fmtSpeed(liveUpload * 1_000_000), accent: '#3B82F6' },
                  { label: 'Average DL', value: fmtSpeed(avgSpeed * 1_000_000), accent: '#22C55E' },
                  { label: 'Peak DL', value: fmtSpeed(peakSpeed * 1_000_000), accent: '#8B5CF6' },
                ].map(s => (
                  <div key={s.label} style={{ padding: '12px 14px', borderRadius: 10, border: '1px solid ' + s.accent + '22', background: '#FAFBFC' }}>
                    <div style={{ fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 2 }}>{s.label}</div>
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: s.accent, fontVariantNumeric: 'tabular-nums' }}>{s.value}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
