'use client';

import { useState, useEffect } from 'react';
import { api, timeAgo } from '@isp/shared';
import { SkeletonBlock, SkeletonCard } from '../../components/Skeleton';

interface Device {
  id: string;
  name: string;
  type: string;
  status: string;
  ipAddress: string;
  location?: string | null;
  vendor?: string | null;
  routerosUsername?: string | null;
  routerosPassword?: string | null;
  updatedAt: string;
}

interface NocDashboard {
  summary: {
    totalDevices: number;
    onlineDevices: number;
    warningDevices: number;
    criticalDevices: number;
  };
  devices: Device[];
}

interface RouterHealth {
  id: string;
  deviceId: string;
  linkStatus: string;
  lastSeenAt?: string | null;
  lastErrorAt?: string | null;
}

interface RadiusStats {
  dbOnline: boolean;
  radcheckUsers: number;
  radcheckWithExpiry: number;
  activeSessions: number;
  acctRecords: number;
  radusergroup: number;
  subscribersWithUsername: number;
  staticCpes: number;
  config: {
    sharedSecret: string;
    defaultPassword: string;
    dbHost: string;
    dbPort: number;
    dbUser: string;
    dbName: string;
    coaEnabled: boolean;
  };
}

interface Connection {
  id: string;
  type: 'PPPOE' | 'STATIC_IP';
  username: string | null;
  ipAddress: string | null;
  macAddress: string | null;
  nasIpAddress: string | null;
  status: string;
  duration: number | null;
  downloadBytes: string;
  uploadBytes: string;
  lastSeen: string | null;
  subscriberName: string | null;
  subscriberId: string | null;
}

const TABS = ['Overview', 'RouterOS', 'RADIUS', 'Connections'];

function StatCard({ label, value, color = '#333', sub }: { label: string; value: number | string; color?: string; sub?: string }) {
  return (
    <div style={{ background: '#fff', borderRadius: 24, padding: '18px 22px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', border: '1px solid var(--border-color)' }}>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color }}>{value}</div>
      {sub && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function badge(label: string, color: string) {
  return <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 10, fontSize: '0.7rem', fontWeight: 600, backgroundColor: color + '20', color }}>{label}</span>;
}

function maskSecret(s: string) {
  if (!s || s === '(not set)') return '(not set)';
  return s;
}

export default function NocPage() {
  const [tab, setTab] = useState('Overview');
  const [data, setData] = useState<NocDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [updating, setUpdating] = useState<Record<string, boolean>>({});
  const [health, setHealth] = useState<RouterHealth[]>([]);
  const [radiusStats, setRadiusStats] = useState<RadiusStats | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connTotals, setConnTotals] = useState<{ totalPppoe: number; totalStatic: number }>({ totalPppoe: 0, totalStatic: 0 });
  const [editDevice, setEditDevice] = useState<Device | null>(null);
  const [creds, setCreds] = useState({ routerosUsername: '', routerosPassword: '' });
  const [savingCreds, setSavingCreds] = useState(false);
  const [toastMsg, setToastMsg] = useState('');

  const toast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 4000);
  };

  const fetchAll = () => {
    setLoading(true);
    setError(false);
    Promise.all([
      api<NocDashboard>('/noc').catch(() => null),
      api<RouterHealth[]>('/router-health').catch(() => []),
      api<RadiusStats>('/radius/stats').catch(() => null),
      api<{ connections: Connection[]; totalPppoe: number; totalStatic: number }>('/network/connections').catch(() => ({ connections: [], totalPppoe: 0, totalStatic: 0 })),
    ])
      .then(([d, h, rs, c]) => {
        setData(d);
        setHealth(h);
        setRadiusStats(rs);
        setConnections(c.connections);
        setConnTotals({ totalPppoe: c.totalPppoe, totalStatic: c.totalStatic });
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchAll(); }, []);

  const toggleStatus = (device: Device) => {
    const newStatus = device.status === 'ONLINE' ? 'OFFLINE' : 'ONLINE';
    setUpdating((prev) => ({ ...prev, [device.id]: true }));
    api<Device>(`/noc/devices/${device.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: newStatus }),
    })
      .then(fetchAll)
      .catch(() => fetchAll())
      .finally(() => setUpdating((prev) => ({ ...prev, [device.id]: false })));
  };

  const openCreds = (d: Device) => {
    setEditDevice(d);
    setCreds({ routerosUsername: d.routerosUsername ?? '', routerosPassword: d.routerosPassword ?? '' });
  };

  const saveCreds = async () => {
    if (!editDevice) return;
    setSavingCreds(true);
    try {
      await api(`/network/devices/${editDevice.id}`, { method: 'PATCH', body: JSON.stringify(creds) });
      toast('RouterOS credentials saved');
      setEditDevice(null);
      fetchAll();
    } catch (e: any) {
      toast(e?.message ?? 'Failed to save credentials');
    } finally {
      setSavingCreds(false);
    }
  };

  const healthOf = (deviceId: string) => health.find(h => h.deviceId === deviceId);

  const offlineCount = data ? data.summary.totalDevices - data.summary.onlineDevices - data.summary.warningDevices - data.summary.criticalDevices : 0;

  const statusColor = (status: string) => {
    switch (status) {
      case 'ONLINE': return '#16a34a';
      case 'OFFLINE': return '#dc2626';
      case 'WARNING': return '#ea580c';
      case 'CRITICAL': return '#b91c1c';
      default: return '#888';
    }
  };

  const linkColor = (s?: string) => (s === 'up' ? '#16a34a' : s === 'unreachable' ? '#dc2626' : '#94A3B8');

  const fmtBytes = (b: string | number) => {
    const n = Number(b);
    if (!n) return '0 B';
    if (n > 1e9) return (n / 1e9).toFixed(1) + ' GB';
    if (n > 1e6) return (n / 1e6).toFixed(1) + ' MB';
    if (n > 1e3) return (n / 1e3).toFixed(1) + ' KB';
    return n + ' B';
  };

  const fmtDur = (s: number | null) => {
    if (!s) return '—';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h) return `${h}h ${m}m`;
    return `${m}m`;
  };

  const tableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' } as const;
  const thStyle = { padding: '10px 14px', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.72rem', textAlign: 'left' as const, borderBottom: '1px solid var(--border-color)' };
  const tdStyle = { padding: '9px 14px', borderBottom: '1px solid #f0f0f0' };

  if (loading && !data) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <SkeletonBlock width={200} height={28} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} height={90} />)}
        </div>
        <SkeletonCard height={200} />
      </div>
    );
  }

  const devices = data?.devices ?? [];

  return (
    <>
      <div className="page-title-row">
        <h1 className="page-title">NOC — Network Operations</h1>
        <button className="btn-primary" onClick={fetchAll}>Refresh</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '8px 20px', borderRadius: 20, border: '1px solid var(--border-color)', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
            backgroundColor: tab === t ? 'var(--primary)' : '#fff', color: tab === t ? '#fff' : 'var(--text-color)',
          }}>{t}</button>
        ))}
      </div>

      {toastMsg && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 200, background: '#0F172A', color: '#fff', padding: '12px 20px', borderRadius: 12, fontSize: '0.85rem', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}>
          {toastMsg}
        </div>
      )}

      {error && !data && (
        <div className="data-card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          Failed to load NOC data. <button onClick={fetchAll} style={{ marginLeft: 12, padding: '6px 16px', borderRadius: 20, border: '1px solid var(--border-color)', cursor: 'pointer' }}>Retry</button>
        </div>
      )}

      {tab === 'Overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
            <StatCard label="Total Devices" value={data?.summary.totalDevices ?? 0} />
            <StatCard label="Online Devices" value={data?.summary.onlineDevices ?? 0} color="#16a34a" />
            <StatCard label="Offline Devices" value={offlineCount} color="#dc2626" />
            <StatCard label="Alerts" value={data ? data.summary.warningDevices + data.summary.criticalDevices : 0} color="#ea580c" />
          </div>

          <div className="data-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', fontWeight: 700, fontSize: '0.9rem', borderBottom: '1px solid var(--border-color)' }}>Network Devices</div>
            {devices.length === 0 ? (
              <p style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>No devices found.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>NAME</th><th style={thStyle}>TYPE</th><th style={thStyle}>STATUS</th>
                      <th style={thStyle}>IP</th><th style={thStyle}>ROUTEROS</th><th style={thStyle}>LINK</th><th style={thStyle}>LAST SEEN</th><th style={thStyle}>ACTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {devices.map(d => {
                      const h = healthOf(d.id);
                      return (
                        <tr key={d.id}>
                          <td style={tdStyle}><strong>{d.name}</strong>{d.location ? <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{d.location}</div> : null}</td>
                          <td style={tdStyle}>{d.type}</td>
                          <td style={tdStyle}>{badge(d.status, statusColor(d.status))}</td>
                          <td style={tdStyle}>{d.ipAddress}</td>
                          <td style={tdStyle}>{d.routerosUsername ? badge('Configured', '#16a34a') : badge('No creds', '#94A3B8')}</td>
                          <td style={tdStyle}>{h ? badge(h.linkStatus, linkColor(h.linkStatus)) : badge('n/a', '#CBD5E1')}</td>
                          <td style={tdStyle}>{h?.lastSeenAt ? timeAgo(h.lastSeenAt) : new Date(d.updatedAt).toLocaleString()}</td>
                          <td style={tdStyle}>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button onClick={() => toggleStatus(d)} disabled={updating[d.id]} style={{ padding: '4px 10px', borderRadius: 14, border: '1px solid var(--border-color)', background: '#fff', cursor: 'pointer', fontSize: '0.72rem' }}>
                                {updating[d.id] ? '...' : d.status === 'ONLINE' ? 'Set Offline' : 'Set Online'}
                              </button>
                              <button onClick={() => openCreds(d)} style={{ padding: '4px 10px', borderRadius: 14, border: '1px solid var(--border-color)', background: '#fff', cursor: 'pointer', fontSize: '0.72rem' }}>Creds</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'RouterOS' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {devices.map(d => {
            const h = healthOf(d.id);
            return (
              <div key={d.id} className="data-card" style={{ padding: '18px 22px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                    <strong style={{ fontSize: '0.95rem' }}>{d.name}</strong>
                    {badge(d.type, '#3B82F6')}
                    {badge(d.status, statusColor(d.status))}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    <span>IP: <strong>{d.ipAddress}</strong></span>
                    {d.vendor && <span>Vendor: <strong>{d.vendor}</strong></span>}
                    {d.location && <span>Location: <strong>{d.location}</strong></span>}
                  </div>
                  <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
                    {d.routerosUsername ? badge(`RouterOS: ${d.routerosUsername}`, '#16a34a') : badge('No RouterOS credentials', '#94A3B8')}
                    {h && (
                      <>
                        {badge(h.linkStatus, linkColor(h.linkStatus))}
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>last {h.lastSeenAt ? timeAgo(h.lastSeenAt) : h.lastErrorAt ? timeAgo(h.lastErrorAt) : 'never'}</span>
                      </>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => openCreds(d)} style={{ padding: '8px 18px', borderRadius: 20, border: '1px solid var(--primary)', background: 'transparent', color: 'var(--primary)', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer' }}>
                    {d.routerosUsername ? 'Edit Credentials' : 'Add Credentials'}
                  </button>
                  <button onClick={() => toggleStatus(d)} disabled={updating[d.id]} style={{ padding: '8px 18px', borderRadius: 20, border: '1px solid var(--border-color)', background: '#fff', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer' }}>
                    {updating[d.id] ? '...' : d.status === 'ONLINE' ? 'Set Offline' : 'Set Online'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'RADIUS' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
            <StatCard label="RADIUS Users (radcheck)" value={radiusStats?.radcheckUsers ?? '—'} color="#7C3AED" sub={radiusStats?.dbOnline ? 'FreeRADIUS DB online' : 'RADIUS DB unreachable'} />
            <StatCard label="With Expiry" value={radiusStats?.radcheckWithExpiry ?? '—'} color="#0284C7" />
            <StatCard label="Active Sessions (radacct)" value={radiusStats?.activeSessions ?? '—'} color="#16a34a" />
            <StatCard label="Subscribers w/ Username" value={radiusStats?.subscribersWithUsername ?? '—'} color="#F59E0B" />
            <StatCard label="Static IP CPEs" value={radiusStats?.staticCpes ?? '—'} color="#DC2626" />
          </div>

          <div className="data-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', fontWeight: 700, fontSize: '0.9rem', borderBottom: '1px solid var(--border-color)' }}>
              RADIUS Configuration {radiusStats?.dbOnline === false && badge('DB UNREACHABLE', '#dc2626')}
            </div>
            {radiusStats ? (
              <table style={{ ...tableStyle, maxWidth: 720 }}>
                <tbody>
                  <tr><td style={tdStyle}><span style={{ color: 'var(--text-muted)' }}>Shared Secret</span></td><td style={{ ...tdStyle, fontWeight: 600 }}>{maskSecret(radiusStats.config.sharedSecret)}</td></tr>
                  <tr><td style={tdStyle}><span style={{ color: 'var(--text-muted)' }}>Default RADIUS Password</span></td><td style={{ ...tdStyle, fontWeight: 600 }}>{maskSecret(radiusStats.config.defaultPassword)}</td></tr>
                  <tr><td style={tdStyle}><span style={{ color: 'var(--text-muted)' }}>RADIUS Database</span></td><td style={{ ...tdStyle, fontWeight: 600 }}>{radiusStats.config.dbHost}:{radiusStats.config.dbPort}/{radiusStats.config.dbName} as {radiusStats.config.dbUser}</td></tr>
                  <tr><td style={tdStyle}><span style={{ color: 'var(--text-muted)' }}>CoA / Rate-limit (change-plan)</span></td><td style={{ ...tdStyle, fontWeight: 600 }}>{radiusStats.config.coaEnabled ? 'Enabled' : 'Not configured'}</td></tr>
                </tbody>
              </table>
            ) : (
              <p style={{ padding: 24, color: 'var(--text-muted)', fontSize: '0.85rem' }}>RADIUS stats unavailable — is radius-service running?</p>
            )}
          </div>
        </div>
      )}

      {tab === 'Connections' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
            <StatCard label="Active PPPoE Sessions" value={connTotals.totalPppoe} color="#0284C7" />
            <StatCard label="Static IP CPEs" value={connTotals.totalStatic} color="#DC2626" />
          </div>

          <div className="data-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', fontWeight: 700, fontSize: '0.9rem', borderBottom: '1px solid var(--border-color)' }}>Live Connections</div>
            {connections.length === 0 ? (
              <p style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>No active connections.</p>
            ) : (
              <div style={{ overflowX: 'auto', maxHeight: 480, overflowY: 'auto' }}>
                <table style={tableStyle}>
                  <thead style={{ position: 'sticky', top: 0, background: '#fff' }}>
                    <tr>
                      <th style={thStyle}>TYPE</th><th style={thStyle}>USERNAME</th><th style={thStyle}>IP</th><th style={thStyle}>NAS</th>
                      <th style={thStyle}>STATUS</th><th style={thStyle}>DURATION</th><th style={thStyle}>IN / OUT</th><th style={thStyle}>LAST SEEN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {connections.map(c => (
                      <tr key={c.id}>
                        <td style={tdStyle}>{badge(c.type, c.type === 'PPPOE' ? '#0284C7' : '#DC2626')}</td>
                        <td style={tdStyle}><strong>{c.username ?? c.subscriberName ?? '—'}</strong></td>
                        <td style={tdStyle}>{c.ipAddress}</td>
                        <td style={tdStyle}>{c.nasIpAddress ?? '—'}</td>
                        <td style={tdStyle}>{badge(c.status, c.status === 'ACTIVE' ? '#16a34a' : '#94A3B8')}</td>
                        <td style={tdStyle}>{fmtDur(c.duration)}</td>
                        <td style={tdStyle}>{fmtBytes(c.downloadBytes)} / {fmtBytes(c.uploadBytes)}</td>
                        <td style={tdStyle}>{c.lastSeen ? timeAgo(c.lastSeen) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {editDevice && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}
          onClick={() => setEditDevice(null)}>
          <div style={{ background: 'white', padding: 32, width: 440, maxWidth: '95vw', height: '100vh', overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.1)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>RouterOS Credentials — {editDevice.name}</h2>
              <span style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setEditDevice(null)}>✕</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>RouterOS Username</label>
                <input value={creds.routerosUsername} onChange={e => setCreds({ ...creds, routerosUsername: e.target.value })} placeholder="e.g. admin"
                  style={{ width: '100%', padding: '10px 14px', borderRadius: 12, border: '1px solid var(--border-color)', fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>RouterOS Password</label>
                <input type="password" value={creds.routerosPassword} onChange={e => setCreds({ ...creds, routerosPassword: e.target.value })} placeholder="password"
                  style={{ width: '100%', padding: '10px 14px', borderRadius: 12, border: '1px solid var(--border-color)', fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
                <button onClick={() => setEditDevice(null)} style={{ padding: '10px 22px', borderRadius: 20, border: '1px solid var(--border-color)', background: '#fff', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }}>Cancel</button>
                <button onClick={saveCreds} disabled={savingCreds} style={{ padding: '10px 22px', borderRadius: 20, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }}>
                  {savingCreds ? 'Saving...' : 'Save Credentials'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}