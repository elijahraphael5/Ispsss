'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore, api, timeAgo } from '@isp/shared';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  PieChart, Pie, Cell,
} from 'recharts';

interface RosDevice {
  id: string; ipAddress: string; name: string; routerosUsername: string | null;
}

interface RosResource {
  'cpu-load': string; 'free-memory': string; 'total-memory': string;
  uptime: string; version: string; 'board-name': string;
}

interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'INFO' | 'WARNING' | 'ERROR';
  link?: string;
  read: boolean;
  createdAt: string;
}

const typeColors: Record<string, { bg: string; fg: string }> = {
  INFO: { bg: '#2563eb18', fg: '#2563eb' },
  WARNING: { bg: '#ea580c18', fg: '#ea580c' },
  ERROR: { bg: '#dc262618', fg: '#dc2626' },
};

interface DashboardData {
  stats: {
    totalCustomers: number;
    activeSubscriptions: number;
    pendingTickets: number;
    revenueThisMonth: number;
  };
  recentTransactions: Array<{
    id: string;
    amount: number;
    status: string;
    createdAt: string;
    subscriber: { email: string } | null;
  }>;
  recentCustomers: Array<{
    id: string;
    email: string;
    phone: string | null;

    status: string;
    plan: { name: string; speedMbps: number; priceKobo: number } | null;
    createdAt: string;
  }>;
}

interface NetDash {
  totalSubscribers: number; activeSubscribers: number; onlineSessions: number;
  authSuccess: number; authFail: number; authSuccessRate: number; nasCount: number;
  downloadToday: number; uploadToday: number;
}

interface ConnectionItem {
  id: string; type: 'PPPOE' | 'STATIC_IP'; status: string; ipAddress: string | null;
  username: string | null; subscriberName: string | null; duration: number | null;
}

interface ConnectionsData {
  connections: ConnectionItem[];
  totalPppoe: number;
  totalStatic: number;
}

interface BWPoint { time: string; download: number; upload: number; }

const CHART_COLORS = ['#2563EB', '#93C5FD', '#F15925', '#FDBA74'];

type BandwidthRange = 'daily' | 'weekly' | 'monthly';

function formatUptime(u: string): string {
  const d = u.match(/(\d+)d/)?.[1] || '0';
  const h = u.match(/(\d+)h/)?.[1] || '0';
  const m = u.match(/(\d+)m/)?.[1] || '0';
  return `${d}d ${h}h ${m}m`;
}

function formatRate(bps: number): string {
  if (bps >= 1_000_000_000) return (bps / 1_000_000_000).toFixed(1) + ' Gbps';
  if (bps >= 1_000_000) return (bps / 1_000_000).toFixed(1) + ' Mbps';
  if (bps >= 1_000) return (bps / 1_000).toFixed(1) + ' Kbps';
  return bps + ' bps';
}

function formatTime(iso: string | null | undefined) {
  if (!iso) return 'unknown time';
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const revenueData = [
  { name: 'Jan', revenue: 400, collected: 380 },
  { name: 'Feb', revenue: 600, collected: 520 },
  { name: 'Mar', revenue: 500, collected: 490 },
  { name: 'Apr', revenue: 800, collected: 720 },
  { name: 'May', revenue: 700, collected: 680 },
  { name: 'Jun', revenue: 900, collected: 850 },
  { name: 'Jul', revenue: 750, collected: 710 },
  { name: 'Aug', revenue: 650, collected: 620 },
  { name: 'Sep', revenue: 850, collected: 800 },
  { name: 'Oct', revenue: 950, collected: 900 },
  { name: 'Nov', revenue: 820, collected: 780 },
  { name: 'Dec', revenue: 1100, collected: 1020 },
];

export default function Dashboard() {
  const { user, accessToken } = useAuthStore();
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [netDash, setNetDash] = useState<NetDash | null>(null);
  const [bandwidthRange, setBandwidthRange] = useState<BandwidthRange>('daily');
  const [bandwidthData, setBandwidthData] = useState<BWPoint[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [rosDevice, setRosDevice] = useState<RosDevice | null>(null);
  const [activeSessions, setActiveSessions] = useState<any[]>([]);
  const [rosResource, setRosResource] = useState<RosResource | null>(null);
  const [rosBandwidth, setRosBandwidth] = useState<any>(null);
  const [rosSubscribers, setRosSubscribers] = useState<any[]>([]);
  const [routerHealth, setRouterHealth] = useState<any[]>([]);
  const [connectionsData, setConnectionsData] = useState<ConnectionsData | null>(null);
  const [bwHistory, setBwHistory] = useState<{ time: string; down: number; up: number; pppoe: number; static: number }[]>([]);

  const fetchBandwidth = useCallback(async (range: BandwidthRange) => {
    try {
      const raw = await api<BWPoint[]>(`/network/bandwidth?range=${range === 'daily' ? 'hourly' : range === 'weekly' ? 'daily' : 'monthly'}`);
      setBandwidthData(raw.slice(-(range === 'daily' ? 24 : range === 'weekly' ? 7 : 12)));
    } catch { setBandwidthData([]); }
  }, []);

  useEffect(() => {
    if (!accessToken) { router.push('/login'); }
  }, [accessToken, router]);

  useEffect(() => {
    if (!accessToken) return;
    api<DashboardData>('/admin/dashboard').then(setData).catch(() => {});
    api<Notification[]>('/notifications').then(setNotifications).catch(() => {});
    api<NetDash>('/network/dashboard').then(setNetDash).catch(() => {});
    fetchBandwidth('daily');
    api<ConnectionsData>('/network/connections').then(setConnectionsData).catch(() => {});

    api<RosDevice[]>('/network/devices').then(devices => {
      const ros = devices.find(d => d.routerosUsername);
      if (!ros) return;
      setRosDevice(ros);
      api<any[]>(`/routeros/devices/${ros.id}/sessions`).then(setActiveSessions).catch(() => {});
      api<RosResource>(`/routeros/devices/${ros.id}/system`).then(setRosResource).catch(() => {});
      api<any>(`/routeros/devices/${ros.id}/bandwidth`).then(setRosBandwidth).catch(() => {});
      api<any[]>(`/routeros/devices/${ros.id}/subscribers`).then(setRosSubscribers).catch(() => {});
    }).catch(() => {});
  }, [accessToken, fetchBandwidth]);

  useEffect(() => {
    fetchBandwidth(bandwidthRange);
    const interval = setInterval(() => fetchBandwidth(bandwidthRange), 15000);
    return () => clearInterval(interval);
  }, [bandwidthRange, fetchBandwidth]);

  useEffect(() => {
    const refresh = async () => {
      try {
        if (!rosDevice) {
          const devices = await api<RosDevice[]>('/network/devices');
          const ros = devices.find(d => d.routerosUsername);
          if (ros) setRosDevice(ros);
          return;
        }
        const [bw, sessions, conns, resource, routerHealth] = await Promise.all([
          api<any>(`/routeros/devices/${rosDevice.id}/bandwidth`),
          api<any[]>(`/routeros/devices/${rosDevice.id}/sessions`),
          api<ConnectionsData>('/network/connections'),
          api<RosResource>(`/routeros/devices/${rosDevice.id}/system`),
          api<any[]>('/router-health'),
        ]);
        setRosBandwidth(bw);
        setActiveSessions(sessions);
        setConnectionsData(conns);
        setRosResource(resource);
        setRouterHealth(routerHealth);
        const now = new Date();
        const t = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0') + ':' + now.getSeconds().toString().padStart(2, '0');
        const staticActive = conns.connections.filter(c => c.type === 'STATIC_IP' && (c.status === 'ACTIVE' || c.status === 'ONLINE')).length;
        setBwHistory(prev => {
          const next = [...prev, { time: t, down: bw.totalRateDown, up: bw.totalRateUp, pppoe: sessions.length, static: staticActive }];
          return next.slice(-60);
        });
      } catch {}
    };
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [rosDevice]);

  if (!user) return null;

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const stats = data?.stats;
  const payments = data?.recentTransactions ?? [];

  const pppoeConns = (connectionsData?.connections ?? []).filter(c => c.type === 'PPPOE');
  const totalPPPoE = rosSubscribers.length > 0 ? rosSubscribers.length : (connectionsData?.totalPppoe ?? 0);
  const activePPPoE = rosSubscribers.length > 0 ? rosSubscribers.filter(s => s.active).length : pppoeConns.filter(c => c.status === 'ACTIVE').length;
  const staticConns = (connectionsData?.connections ?? []).filter(c => c.type === 'STATIC_IP');
  const activeStatic = staticConns.filter(c => c.status === 'ACTIVE' || c.status === 'ONLINE').length;
  const totalStatic = staticConns.length;

  const totalConnections = totalPPPoE + totalStatic;
  const activeConnections = activePPPoE + activeStatic;

  const rosHealth = routerHealth.find(h => h.deviceId === rosDevice?.id);
  const staleDevice = rosHealth && rosHealth.linkStatus !== 'up' ? rosHealth : null;

  const connDistData = [
    { name: 'PPPoE Active', value: activePPPoE },
    { name: 'PPPoE Disabled', value: totalPPPoE - activePPPoE },
    { name: 'Static IP Active', value: activeStatic },
    { name: 'Static IP Offline', value: totalStatic - activeStatic },
  ];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            Hey, {user.email?.split('@')[0] ?? 'Admin'} 👋
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Welcome back to your dashboard overview</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          <span>{today}</span>
          <div style={{ backgroundColor: '#fff', padding: '8px 16px', borderRadius: 16, fontWeight: 600, color: 'var(--text-dark)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
            Today
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
          </div>
        </div>
      </div>

      {routerHealth.some(h => h.linkStatus === 'unreachable') && (
        <div className="data-card" style={{ background: '#FEE', borderLeft: '4px solid #F15925' }}>
          {routerHealth.filter(h => h.linkStatus === 'unreachable').map(h => (
            <p key={h.deviceId} style={{ margin: 0, fontSize: '0.85rem', color: '#B33A1D' }}>⚠ {h.device.name} unreachable since {formatTime(h.lastErrorAt)} — showing last-known data</p>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 20 }}>
        {[
          { label: 'Total Connections', value: totalConnections || '—', change: '', positive: true, stale: !!staleDevice, icon: '<path d="M4 20h16M4 4h16v12H4z"/>' },
          { label: 'Active Connections', value: activeConnections || '—', change: '', positive: true, stale: !!staleDevice, icon: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>' },
          { label: 'Due Amount', value: stats ? `₦${(stats.revenueThisMonth / 100).toLocaleString()}` : '—', change: '', positive: true, stale: false, icon: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>' },
          { label: 'PPPoE', value: totalPPPoE ? `${activePPPoE}/${totalPPPoE}` : '—', change: '', positive: true, stale: !!staleDevice, icon: '<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>' },
          { label: 'Static IP', value: totalStatic ? `${activeStatic}/${totalStatic}` : '—', change: '', positive: true, stale: false, icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>' },
        ].map((card) => (
          <div key={card.label} style={{ backgroundColor: 'var(--bg-card)', padding: '20px 24px', borderRadius: 'var(--border-radius-lg)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-dark)', fontWeight: 500, fontSize: '0.9rem' }}>
              <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: card.icon }} />
              {card.label}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 16 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{card.value}</div>
                {card.stale && staleDevice && (
                  <span title={`Last seen ${formatTime(staleDevice.lastSeenAt)}`} style={{ fontSize: '0.68rem', fontWeight: 600, padding: '2px 8px', borderRadius: 10, backgroundColor: '#F1592518', color: '#B33A1D', whiteSpace: 'nowrap' }}>
                    stale · {timeAgo(staleDevice.lastSeenAt)}
                  </span>
                )}
              </div>
              {card.change && (
                <div style={{ fontSize: '0.8rem', fontWeight: 600, padding: '2px 8px', borderRadius: 6, color: card.positive ? 'var(--badge-green-text)' : 'var(--badge-red-text)' }}>
                  ↑ {card.change}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20 }}>
        <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--border-radius-lg)', padding: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>Revenue Overview</div>
            <div style={{ display: 'flex', gap: 16, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: 'var(--accent-orange)' }}></span> Revenue</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#3b82f6' }}></span> Collected</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={revenueData}>
              <defs>
                <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#F15925" stopOpacity={0.3}/>
                  <stop offset="100%" stopColor="#F15925" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="colGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3}/>
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#6c757d' }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#6c757d' }} />
              <Tooltip />
              <Area type="monotone" dataKey="revenue" stroke="#F15925" fill="url(#revGrad)" strokeWidth={2} />
              <Area type="monotone" dataKey="collected" stroke="#3b82f6" fill="url(#colGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--border-radius-lg)', padding: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>Connections Distribution</div>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={connDistData} cx="50%" cy="50%" innerRadius={50} outerRadius={70} paddingAngle={2} dataKey="value">
                {connDistData.map((_, idx) => (
                  <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.85rem', marginTop: 12 }}>
            {connDistData.filter(d => d.value > 0).map((d, idx) => (
              <div key={d.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span><span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: CHART_COLORS[idx], display: 'inline-block', marginRight: 6 }}></span> {d.name}</span>
                <strong>{d.value}</strong>
              </div>
            ))}
            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 8, marginTop: 4, display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
              <span>Total</span>
              <strong>{totalConnections}</strong>
            </div>
          </div>
        </div>
      </div>

      <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--border-radius-lg)', padding: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>Network Overview</div>
          {rosDevice && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{rosDevice.name} ({rosDevice.ipAddress})</span>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          <div style={{ textAlign: 'center', padding: '16px 12px', borderRadius: 16, background: '#F0FDF4' }}>
            <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#16A34A' }}>{(activeSessions.length || netDash?.onlineSessions) ?? '—'}</div>
            <div style={{ fontSize: '0.75rem', color: '#666', marginTop: 4 }}>Active Sessions</div>
          </div>
          <div style={{ textAlign: 'center', padding: '16px 12px', borderRadius: 16, background: '#F0FDF4' }}>
            <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#16A34A' }}>{rosResource ? rosResource['cpu-load'] + '%' : netDash?.authSuccessRate ? netDash.authSuccessRate + '%' : '—'}</div>
            <div style={{ fontSize: '0.75rem', color: '#666', marginTop: 4 }}>CPU Load</div>
          </div>
          <div style={{ textAlign: 'center', padding: '16px 12px', borderRadius: 16, background: '#EFF6FF' }}>
            <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#2563EB' }}>{rosResource ? formatUptime(rosResource.uptime) : netDash?.nasCount ?? '—'}</div>
            <div style={{ fontSize: '0.75rem', color: '#666', marginTop: 4 }}>Uptime</div>
          </div>
          <div style={{ textAlign: 'center', padding: '16px 12px', borderRadius: 16, background: '#FEF2F2' }}>
            <div style={{ fontSize: '1.8rem', fontWeight: 700, color: rosBandwidth?.totalRate ? '#16A34A' : '#DC2626' }}>{rosBandwidth ? formatRate(rosBandwidth.totalRate) : '—'}</div>
            <div style={{ fontSize: '0.75rem', color: '#666', marginTop: 4 }}>Live Throughput</div>
          </div>
        </div>
      </div>

      <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--border-radius-lg)', padding: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>Traffic & Connections</div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            <span>↓ {formatRate(rosBandwidth?.totalRateDown ?? 0)}</span>
            <span>↑ {formatRate(rosBandwidth?.totalRateUp ?? 0)}</span>
            <span>{activePPPoE} PPPoE</span>
            <span>{activeStatic} Static</span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={bwHistory.length > 1
            ? bwHistory
            : bandwidthData.length > 0
              ? bandwidthData.map(p => ({ time: p.time, down: p.download, up: p.upload, pppoe: activePPPoE, static: activeStatic }))
              : [{ time: '—', down: 0, up: 0, pppoe: 0, static: 0 }]}
            margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="bwDownGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#F15925" stopOpacity={0.35}/>
                <stop offset="100%" stopColor="#F15925" stopOpacity={0}/>
              </linearGradient>
              <linearGradient id="bwUpGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3}/>
                <stop offset="100%" stopColor="#3b82f6" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#9ca3af' }} minTickGap={40} />
            <YAxis yAxisId="bw" orientation="left" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#9ca3af' }} width={55} tickFormatter={(v: number) => formatRate(v)} />
            <YAxis yAxisId="conn" orientation="right" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#9ca3af' }} width={30} />
            <Tooltip
              contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', padding: '10px 14px', fontSize: '0.8rem' }}
              formatter={(value: number, name: string) => {
                if (name === 'down') return [formatRate(value), 'Download'];
                if (name === 'up') return [formatRate(value), 'Upload'];
                if (name === 'pppoe') return [value, 'PPPoE Active'];
                if (name === 'static') return [value, 'Static IP Active'];
                return [value, name];
              }}
              labelFormatter={(label: string) => `Time: ${label}`}
            />
            <Legend
              verticalAlign="bottom" height={30}
              onClick={(e) => {
                const el = document.querySelector(`.recharts-legend-item-${e.dataKey}`);
                if (el) (el as HTMLElement).style.opacity = (el as HTMLElement).style.opacity === '0.3' ? '1' : '0.3';
              }}
              formatter={(value: string) => <span style={{ fontSize: '0.75rem', color: '#555' }}>{value}</span>}
            />
            <Area yAxisId="bw" type="monotone" dataKey="down" stroke="#F15925" strokeWidth={2} fill="url(#bwDownGrad)" dot={false} activeDot={{ r: 4, fill: '#F15925', stroke: '#fff', strokeWidth: 2 }} isAnimationActive={true} animationDuration={300} name="down" />
            <Area yAxisId="bw" type="monotone" dataKey="up" stroke="#3b82f6" strokeWidth={2} fill="url(#bwUpGrad)" dot={false} activeDot={{ r: 4, fill: '#3b82f6', stroke: '#fff', strokeWidth: 2 }} isAnimationActive={true} animationDuration={300} name="up" />
            <Area yAxisId="conn" type="monotone" dataKey="pppoe" stroke="#16A34A" strokeWidth={2} fill="none" dot={false} activeDot={{ r: 4, fill: '#16A34A', stroke: '#fff', strokeWidth: 2 }} isAnimationActive={true} animationDuration={300} name="pppoe" />
            <Area yAxisId="conn" type="monotone" dataKey="static" stroke="#F59E0B" strokeWidth={2} fill="none" dot={false} activeDot={{ r: 4, fill: '#F59E0B', stroke: '#fff', strokeWidth: 2 }} isAnimationActive={true} animationDuration={300} name="static" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--border-radius-lg)', padding: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>Recent Notifications</div>
            <button onClick={() => router.push('/notifications')} style={{
              padding: '6px 16px', borderRadius: 20, border: '1px solid var(--primary)', background: 'transparent',
              color: 'var(--primary)', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer',
            }}>View All</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {notifications.length === 0 ? (
              <p style={{ color: '#888', fontSize: 14 }}>No recent notifications.</p>
            ) : notifications.slice(0, 5).map((n) => {
              const tc = typeColors[n.type] ?? typeColors.INFO;
              return (
                <div key={n.id}
                  onClick={() => n.link && router.push(n.link)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                    borderRadius: 16, background: n.read ? 'transparent' : '#fff9f5',
                    borderLeft: `3px solid ${tc.fg}`, cursor: n.link ? 'pointer' : 'default',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{n.title}</span>
                      {!n.read && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#FF6224' }} />}
                    </div>
                    <p style={{ margin: 0, fontSize: 12, color: '#666', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.message}</p>
                  </div>
                  <span style={{ fontSize: 11, color: '#aaa', flexShrink: 0 }}>{new Date(n.createdAt).toLocaleDateString()}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--border-radius-lg)', padding: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>Recent Transactions</div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', color: 'var(--text-muted)', fontWeight: 500, paddingBottom: 14, borderBottom: '1px solid #f0f0f0' }}>Customer</th>
                <th style={{ textAlign: 'left', color: 'var(--text-muted)', fontWeight: 500, paddingBottom: 14, borderBottom: '1px solid #f0f0f0' }}>Amount</th>
                <th style={{ textAlign: 'left', color: 'var(--text-muted)', fontWeight: 500, paddingBottom: 14, borderBottom: '1px solid #f0f0f0' }}>Status</th>
                <th style={{ textAlign: 'left', color: 'var(--text-muted)', fontWeight: 500, paddingBottom: 14, borderBottom: '1px solid #f0f0f0' }}>Time</th>
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 ? (
                <tr><td colSpan={4} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>No recent payments</td></tr>
              ) : payments.map((p) => (
                <tr key={p.id}>
                  <td style={{ padding: '12px 0', fontWeight: 600 }}>{p.subscriber?.email ?? '—'}</td>
                  <td style={{ padding: '12px 0' }}>₦{(p.amount / 100).toFixed(2)}</td>
                  <td style={{ padding: '12px 0' }}>
                    <span style={{
                      backgroundColor: p.status === 'SUCCESSFUL' ? 'var(--badge-green-bg)' : 'var(--badge-red-bg)',
                      color: p.status === 'SUCCESSFUL' ? 'var(--badge-green-text)' : 'var(--badge-red-text)',
                      padding: '4px 10px', borderRadius: 12, fontWeight: 600, fontSize: '0.75rem', display: 'inline-block',
                    }}>
                      {p.status === 'SUCCESSFUL' ? 'PAID' : p.status}
                    </span>
                  </td>
                  <td style={{ padding: '12px 0', color: 'var(--text-muted)' }}>{new Date(p.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {payments.length > 0 && (
            <div style={{ marginTop: 16, textAlign: 'center' }}>
              <button
                onClick={() => router.push('/payments')}
                style={{
                  padding: '8px 24px', borderRadius: 20, border: '1px solid var(--primary)', background: 'transparent',
                  color: 'var(--primary)', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer',
                }}
              >
                See More
              </button>
            </div>
          )}
        </div>

      </div>
    </>
  );
}