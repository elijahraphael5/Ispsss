'use client';

import { useState, useEffect, useRef } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '@isp/shared';

interface DashboardData {
  totalSubscribers: number;
  activeSubscribers: number;
  inactiveSubscribers: number;
  suspendedSubscribers: number;
  onlineSessions: number;
  offlineSessions: number;
  nasCount: number;
  downloadToday: number;
  uploadToday: number;
  authSuccess: number;
  authFail: number;
  authSuccessRate: number;
  authFailRate: number;
}

interface Device {
  id: string;
  name: string;
  type: string;
  ipAddress: string;
  status: string;
  vendor: string | null;
  location: string | null;
  cpu: number | null;
  memory: number | null;
  sessions: number;
  secret?: string;
  routerosUsername?: string;
  routerosPassword?: string;
  routerosPort?: number;
  updatedAt: string;
}

interface Session {
  id: string;
  username: string;
  sessionId: string;
  nasIpAddress: string | null;
  framedIpAddress: string | null;
  profile: string | null;
  startTime: string | null;
  sessionDuration: number | null;
  downloadBytes: number | null;
  uploadBytes: number | null;
  downloadRate: number | null;
  uploadRate: number | null;
  isActive: boolean;
  lastSyncedAt: string;
}

function fmtBytes(b: number) {
  if (b >= 1_000_000_000) return (b / 1_000_000_000).toFixed(1) + ' GB';
  if (b >= 1_000_000) return (b / 1_000_000).toFixed(1) + ' MB';
  if (b >= 1_000) return (b / 1_000).toFixed(1) + ' KB';
  return b + ' B';
}

function fmtK(k: number) { return '\u20A6' + k.toLocaleString(); }
function fmtD(d: string) { return new Date(d).toLocaleDateString('en-GB'); }
function fmtDT(d: string) { return new Date(d).toLocaleString('en-GB'); }

function badge(label: string, color: string) {
  return <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600, backgroundColor: color + '18', color }}>{label}</span>;
}

function statusColor(s: string) {
  if (s === 'ONLINE' || s === 'ACTIVE') return '#16A34A';
  if (s === 'WARNING') return '#CA8A04';
  if (s === 'SUSPENDED') return '#DC2626';
  return '#94A3B8';
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

const TABS = ['Dashboard', 'Sessions', 'Connections', 'RouterOS'];
const inp: React.CSSProperties = { width: '100%', padding: '9px 12px', border: '1px solid var(--border-color)', borderRadius: 10, fontSize: '0.85rem', outline: 'none' };
const sel: React.CSSProperties = { ...inp, background: 'white' };

export default function NetworkPage() {
  const [tab, setTab] = useState('Dashboard');
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionsTotals, setConnectionsTotals] = useState({ totalPppoe: 0, totalStatic: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // RouterOS
  const [rosDeviceId, setRosDeviceId] = useState('');
  const [rosBandwidth, setRosBandwidth] = useState<any>(null);
  const [rosQueues, setRosQueues] = useState<any[]>([]);
  const [rosLoading, setRosLoading] = useState(false);
  const [rosError, setRosError] = useState('');
  const [bwHistory, setBwHistory] = useState<{ time: string; down: number; up: number }[]>([]);
  const bwInterval = useRef<NodeJS.Timeout | null>(null);

  // Drawers
  const [showAddDevice, setShowAddDevice] = useState(false);
  const [showEditDevice, setShowEditDevice] = useState<Device | null>(null);
  const [showSessionDetail, setShowSessionDetail] = useState<string | null>(null);
  const [showCreateQueue, setShowCreateQueue] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Forms
  const [deviceForm, setDeviceForm] = useState({ name: '', type: 'router', ipAddress: '', vendor: 'MikroTik', location: '', secret: '', routerosUsername: '', routerosPassword: '', routerosPort: 80 });
  const [editDeviceForm, setEditDeviceForm] = useState({ name: '', ipAddress: '', secret: '', location: '', routerosUsername: '', routerosPassword: '', routerosPort: 443 });
  const [queueForm, setQueueForm] = useState({ name: '', target: '', maxLimit: '10M/10M', disabled: false });

  useEffect(() => { fetchAll(); }, []);

  // RouterOS live bandwidth poll
  useEffect(() => {
    if (!rosDeviceId) { setBwHistory([]); return; }
    const poll = async () => {
      try {
        const data = await api<any>(`/routeros/devices/${rosDeviceId}/bandwidth`);
        const now = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setBwHistory(prev => [...prev.slice(-59), { time: now, down: Math.round(data.totalRateDown / 1000), up: Math.round(data.totalRateUp / 1000) }]);
      } catch {}
    };
    poll();
    bwInterval.current = setInterval(poll, 3000);
    return () => { if (bwInterval.current) clearInterval(bwInterval.current); };
  }, [rosDeviceId]);

  async function fetchAll() {
    setLoading(true);
    try {
      const [d, dev, sess, conn] = await Promise.all([
        api<DashboardData>('/network/dashboard').catch(() => null),
        api<Device[]>('/network/devices').catch(() => []),
        api<Session[]>('/network/sessions').catch(() => []),
        api<{ connections: Connection[]; totalPppoe: number; totalStatic: number }>('/network/connections').catch(() => null),
      ]);
      if (d) setDash(d);
      setDevices(dev);
      setSessions(sess);
      if (conn) { setConnections(conn.connections); setConnectionsTotals({ totalPppoe: conn.totalPppoe, totalStatic: conn.totalStatic }); }
    } catch { setError('Failed to load network data'); }
    finally { setLoading(false); }
  }

  async function addDevice() {
    setSubmitting(true);
    try {
      const body: any = { name: deviceForm.name, type: deviceForm.type, ipAddress: deviceForm.ipAddress };
      if (deviceForm.vendor) body.vendor = deviceForm.vendor;
      if (deviceForm.location) body.location = deviceForm.location;
      if (deviceForm.secret) body.secret = deviceForm.secret;
      if (deviceForm.type === 'router') {
        body.routerosUsername = deviceForm.routerosUsername || undefined;
        body.routerosPassword = deviceForm.routerosPassword || undefined;
        body.routerosPort = deviceForm.routerosPort || undefined;
      }
      await api('/network/devices', { method: 'POST', body: JSON.stringify(body) });
      setShowAddDevice(false);
      setDeviceForm({ name: '', type: 'router', ipAddress: '', vendor: 'MikroTik', location: '', secret: '', routerosUsername: '', routerosPassword: '', routerosPort: 80 });
      await fetchAll();
    } catch { setError('Failed to add device'); }
    finally { setSubmitting(false); }
  }

  function openEditDevice(d: Device) {
    setEditDeviceForm({ name: d.name, ipAddress: d.ipAddress, secret: d.secret ?? '', location: d.location ?? '', routerosUsername: d.routerosUsername ?? '', routerosPassword: d.routerosPassword ?? '', routerosPort: d.routerosPort ?? 80 });
    setShowEditDevice(d);
  }

  async function handleEditDevice() {
    if (!showEditDevice) return;
    setSubmitting(true);
    try {
      const body: any = { ...editDeviceForm };
      if (showEditDevice.type !== 'router') {
        delete body.routerosUsername;
        delete body.routerosPassword;
        delete body.routerosPort;
      }
      await api(`/network/devices/${showEditDevice.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      setShowEditDevice(null);
      await fetchAll();
    } catch { setError('Failed to update device'); }
    finally { setSubmitting(false); }
  }

  async function disconnectSession(id: string) {
    try { await api(`/network/sessions/${id}/disconnect`, { method: 'POST' }); await fetchAll(); }
    catch { setError('Failed to disconnect'); }
  }

  async function fetchRouterOs(deviceId: string) {
    if (!deviceId) { setRosBandwidth(null); setRosQueues([]); return; }
    setRosLoading(true);
    setRosError('');
    try {
      const [bw, queues] = await Promise.all([
        api<any>(`/routeros/devices/${deviceId}/bandwidth`).catch(() => null),
        api<any[]>(`/routeros/devices/${deviceId}/queues`).catch(() => []),
      ]);
      if (bw) setRosBandwidth(bw);
      setRosQueues(queues);
    } catch { setRosError('Failed to fetch RouterOS data'); }
    finally { setRosLoading(false); }
  }

  async function createRouterOsQueue() {
    if (!rosDeviceId) return;
    setSubmitting(true);
    try {
      await api(`/routeros/devices/${rosDeviceId}/queues`, {
        method: 'POST',
        body: JSON.stringify({ name: queueForm.name, target: queueForm.target, 'max-limit': queueForm.maxLimit, disabled: queueForm.disabled ? 'yes' : 'no' }),
      });
      setShowCreateQueue(false);
      setQueueForm({ name: '', target: '', maxLimit: '10M/10M', disabled: false });
      await fetchRouterOs(rosDeviceId);
    } catch { setRosError('Failed to create queue'); }
    finally { setSubmitting(false); }
  }

  async function deleteRouterOsQueue(queueId: string) {
    if (!rosDeviceId) return;
    try {
      await api(`/routeros/devices/${rosDeviceId}/queues/${queueId}`, { method: 'DELETE' });
      await fetchRouterOs(rosDeviceId);
    } catch { setRosError('Failed to delete queue'); }
  }

  async function syncRouterOsSessions() {
    if (!rosDeviceId) return;
    try {
      const res = await api<any>(`/routeros/devices/${rosDeviceId}/sync-sessions`, { method: 'POST' });
      alert(`Synced: ${res.created} created, ${res.updated} updated, ${res.deactivated} deactivated`);
      await fetchAll();
    } catch { setRosError('Failed to sync sessions'); }
  }

  return (
    <>
      {/* ── Dashboard Tab ───────────────────────────────── */}
      {tab === 'Dashboard' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 20 }}>
            {[
              { label: 'Total Subscribers', value: dash?.totalSubscribers ?? '—', color: '#6366F1' },
              { label: 'Active', value: dash?.activeSubscribers ?? '—', color: '#16A34A' },
              { label: 'Suspended', value: dash?.suspendedSubscribers ?? '—', color: '#DC2626' },
              { label: 'Online Sessions', value: dash?.onlineSessions ?? '—', color: '#2563EB' },
            ].map(s => (
              <div key={s.label} className="data-card" style={{ padding: '16px 20px' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 20 }}>
            {[
              { label: 'NAS Devices', value: dash?.nasCount ?? '—', color: '#8B5CF6' },
              { label: 'Auth Success Rate', value: dash ? `${dash.authSuccessRate}%` : '—', color: '#16A34A' },
              { label: 'Download Today', value: dash ? fmtBytes(dash.downloadToday) : '—', color: '#F15925' },
              { label: 'Upload Today', value: dash ? fmtBytes(dash.uploadToday) : '—', color: '#3B82F6' },
            ].map(s => (
              <div key={s.label} className="data-card" style={{ padding: '16px 20px' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            {[
              { label: 'Inactive', value: dash?.inactiveSubscribers ?? '—', color: '#94A3B8' },
              { label: 'Offline Sessions', value: dash?.offlineSessions ?? '—', color: '#94A3B8' },
              { label: 'Auth Success', value: dash?.authSuccess ?? '—', color: '#16A34A' },
              { label: 'Auth Failures', value: dash?.authFail ?? '—', color: '#DC2626' },
            ].map(s => (
              <div key={s.label} className="data-card" style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500 }}>{s.label}</span>
                <span style={{ fontSize: '1rem', fontWeight: 700, color: s.color }}>{s.value}</span>
              </div>
            ))}
          </div>
          <div className="data-card" style={{ marginTop: 20, padding: 20 }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: 12 }}>Network Devices</h3>
            <div className="table-container">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>NAME</th>
                      <th>TYPE</th>
                      <th>IP ADDRESS</th>
                      <th>VENDOR</th>
                      <th>STATUS</th>
                      <th>SESSIONS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {devices.length === 0 ? (
                      <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>No devices</td></tr>
                    ) : devices.slice(0, 10).map(d => (
                      <tr key={d.id}>
                        <td style={{ fontWeight: 600 }}>{d.name}</td>
                        <td>{badge(d.type, '#6366F1')}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{d.ipAddress}</td>
                        <td>{d.vendor ?? '—'}</td>
                        <td>{badge(d.status, statusColor(d.status))}</td>
                        <td>{d.sessions}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Sessions Tab ────────────────────────────────── */}
      {tab === 'Sessions' && (
        <div className="data-card" style={{ padding: 0 }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: 8 }}>
            {[true, false, undefined].map(v => (
              <button key={String(v)} onClick={() => {}} style={{ padding: '5px 12px', borderRadius: 16, border: '1px solid var(--border-color)', cursor: 'pointer', fontWeight: 500, fontSize: '0.75rem', background: '#fff' }}>
                {v === undefined ? 'All' : v ? 'Active' : 'Inactive'}
              </button>
            ))}
          </div>
          <div className="table-container">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>USERNAME</th>
                    <th>SESSION ID</th>
                    <th>IP ADDRESS</th>
                    <th>NAS</th>
                    <th>DURATION</th>
                    <th>DOWN</th>
                    <th>UP</th>
                    <th>STATUS</th>
                    <th style={{ width: 80 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.length === 0 ? (
                    <tr><td colSpan={9} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>No sessions</td></tr>
                  ) : sessions.map(s => (
                    <tr key={s.id} onClick={() => setShowSessionDetail(s.id)} style={{ cursor: 'pointer' }}>
                      <td style={{ fontWeight: 600 }}>{s.username}</td>
                      <td style={{ fontSize: '0.8rem', fontFamily: 'monospace' }}>{s.sessionId.slice(0, 12)}...</td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{s.framedIpAddress ?? '—'}</td>
                      <td style={{ fontSize: '0.85rem' }}>{s.nasIpAddress ?? '—'}</td>
                      <td>{s.sessionDuration ? Math.floor(s.sessionDuration / 60) + 'm' : '—'}</td>
                      <td style={{ fontSize: '0.85rem' }}>{s.downloadBytes ? fmtBytes(Number(s.downloadBytes)) : '—'}</td>
                      <td style={{ fontSize: '0.85rem' }}>{s.uploadBytes ? fmtBytes(Number(s.uploadBytes)) : '—'}</td>
                      <td>{badge(s.isActive ? 'Active' : 'Offline', s.isActive ? '#16A34A' : '#94A3B8')}</td>
                      <td onClick={e => e.stopPropagation()}>
                        {s.isActive && <button className="btn-sm-outline" onClick={() => disconnectSession(s.id)}>Kill</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Connections Tab ─────────────────────────────── */}
      {tab === 'Connections' && (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
            <button className="btn-sm" onClick={async () => {
              try {
                const res = await api<any>('/routeros/sync-arp', { method: 'POST' });
                alert(`ARP sync complete: ${res.created} created, ${res.skipped} skipped, ${res.total} total`);
                await fetchAll();
              } catch { setError('Failed to sync ARP entries'); }
            }}>
              Sync ARP (Static IP)
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 20 }}>
            {[
              { label: 'Total Connections', value: connections.length, color: '#6366F1' },
              { label: 'PPPoE', value: connectionsTotals.totalPppoe, color: '#2563EB' },
              { label: 'Static IP', value: connectionsTotals.totalStatic, color: '#F15925' },
            ].map(s => (
              <div key={s.label} className="data-card" style={{ padding: '16px 20px' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>
          <div className="data-card" style={{ padding: 0 }}>
            <div className="table-container">
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>TYPE</th>
                      <th>USER / SUBSCRIBER</th>
                      <th>IP ADDRESS</th>
                      <th>MAC ADDRESS</th>
                      <th>NAS</th>
                      <th>STATUS</th>
                      <th>DOWN</th>
                      <th>UP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {connections.length === 0 ? (
                      <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>No connections</td></tr>
                    ) : connections.map(c => (
                      <tr key={c.id}>
                        <td>{badge(c.type, c.type === 'PPPOE' ? '#2563EB' : '#F15925')}</td>
                        <td style={{ fontWeight: 600 }}>{c.username ?? c.subscriberName ?? '—'}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{c.ipAddress ?? '—'}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{c.macAddress ?? '—'}</td>
                        <td style={{ fontSize: '0.85rem' }}>{c.nasIpAddress ?? '—'}</td>
                        <td>{badge(c.status, statusColor(c.status))}</td>
                        <td style={{ fontSize: '0.85rem' }}>{fmtBytes(Number(c.downloadBytes))}</td>
                        <td style={{ fontSize: '0.85rem' }}>{fmtBytes(Number(c.uploadBytes))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── RouterOS Tab ────────────────────────────────── */}
      {tab === 'RouterOS' && (
        <>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
            <select value={rosDeviceId} onChange={e => { setRosDeviceId(e.target.value); fetchRouterOs(e.target.value); }}
              style={{ ...inp, width: 260 }}>
              <option value="">Select RouterOS device...</option>
              {devices.filter(d => d.routerosUsername).map(d => (
                <option key={d.id} value={d.id}>{d.name} ({d.ipAddress})</option>
              ))}
            </select>
            {rosDeviceId && (
              <button className="btn-sm-outline" onClick={() => fetchRouterOs(rosDeviceId)} disabled={rosLoading}>
                {rosLoading ? 'Loading...' : 'Refresh'}
              </button>
            )}
            {rosDeviceId && (
              <button className="btn-sm-outline" onClick={syncRouterOsSessions}>
                Sync Sessions
              </button>
            )}
            {rosDeviceId && (
              <button className="btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setShowCreateQueue(true)}>
                + Add Queue
              </button>
            )}
          </div>

          {rosError && (
            <div style={{ padding: '12px 16px', background: '#FEE2E2', color: '#DC2626', borderRadius: 12, marginBottom: 16, fontSize: '0.85rem' }}>
              {rosError} <button onClick={() => setRosError('')} style={{ marginLeft: 12, background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626', fontWeight: 600 }}>Dismiss</button>
            </div>
          )}

          {!rosDeviceId && (
            <div className="data-card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
              Select a RouterOS device above
            </div>
          )}

          {rosBandwidth && rosDeviceId && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 20 }}>
                {[
                  { label: 'Total Queues', value: rosBandwidth.queueCount, color: '#6366F1' },
                  { label: 'Download (Total)', value: fmtBytes(rosBandwidth.totalBytesDown), color: '#F15925' },
                  { label: 'Upload (Total)', value: fmtBytes(rosBandwidth.totalBytesUp), color: '#3B82F6' },
                  { label: 'Current Rate', value: fmtBytes(rosBandwidth.totalRate) + '/s', color: '#16A34A' },
                ].map(s => (
                  <div key={s.label} className="data-card" style={{ padding: '16px 20px' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>{s.label}</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: s.color }}>{s.value}</div>
                  </div>
                ))}
              </div>

              {bwHistory.length > 1 && (
                <div className="data-card" style={{ padding: 20, marginBottom: 20 }}>
                  <h3 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: 12 }}>Live Bandwidth (last 3 min)</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={bwHistory}>
                      <defs>
                        <linearGradient id="downGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#F15925" stopOpacity={0.3}/><stop offset="95%" stopColor="#F15925" stopOpacity={0}/></linearGradient>
                        <linearGradient id="upGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3}/><stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/></linearGradient>
                      </defs>
                      <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94A3B8' }} minTickGap={40} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94A3B8' }} tickFormatter={v => v >= 1000 ? (v/1000).toFixed(1)+'M' : v+'K'} width={50} />
                      <Tooltip contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} labelStyle={{ fontWeight: 600 }} />
                      <Area type="monotone" dataKey="down" stroke="#F15925" strokeWidth={2} fill="url(#downGrad)" dot={false} name="Down" unit=" Kbps" />
                      <Area type="monotone" dataKey="up" stroke="#3B82F6" strokeWidth={2} fill="url(#upGrad)" dot={false} name="Up" unit=" Kbps" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}

              <div className="data-card" style={{ padding: 0 }}>
                <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-color)', fontWeight: 700, fontSize: '0.9rem' }}>
                  Simple Queues
                </div>
                <div className="table-container">
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>NAME</th>
                          <th>TARGET</th>
                          <th>MAX LIMIT</th>
                          <th>DOWN</th>
                          <th>UP</th>
                          <th>RATE</th>
                          <th>STATUS</th>
                          <th style={{ width: 60 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {rosQueues.length === 0 ? (
                          <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>No queues</td></tr>
                        ) : rosQueues.map(q => (
                          <tr key={q['.id']}>
                            <td style={{ fontWeight: 600 }}>{q.name}</td>
                            <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{q.target}</td>
                            <td style={{ fontSize: '0.85rem' }}>{q['max-limit']}</td>
                            <td style={{ fontSize: '0.85rem' }}>{fmtBytes(Number(q.bytes?.split('/')[0] || 0))}</td>
                            <td style={{ fontSize: '0.85rem' }}>{fmtBytes(Number(q.bytes?.split('/')[1] || 0))}</td>
                            <td style={{ fontSize: '0.85rem' }}>{q.rate}</td>
                            <td>{badge(q.disabled === 'true' ? 'Disabled' : 'Enabled', q.disabled === 'true' ? '#94A3B8' : '#16A34A')}</td>
                            <td>
                              <button className="btn-sm-outline" onClick={() => deleteRouterOsQueue(q['.id'])} style={{ color: '#DC2626', borderColor: '#DC2626' }}>
                                Del
                              </button>
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
        </>
      )}

      {/* ── Create Queue Drawer ─────────────────────────── */}
      {showCreateQueue && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}
          onClick={() => setShowCreateQueue(false)}>
          <div style={{ background: 'white', padding: 32, width: 480, maxWidth: '95vw', height: '100vh', overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.1)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Create Simple Queue</h2>
              <span style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setShowCreateQueue(false)}>
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Queue Name</label>
                <input value={queueForm.name} onChange={e => setQueueForm(f => ({ ...f, name: e.target.value }))} placeholder="customer-name" style={inp} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Target (IP)</label>
                <input value={queueForm.target} onChange={e => setQueueForm(f => ({ ...f, target: e.target.value }))} placeholder="192.168.1.100/32" style={inp} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Max Limit (upload/download)</label>
                <input value={queueForm.maxLimit} onChange={e => setQueueForm(f => ({ ...f, maxLimit: e.target.value }))} placeholder="10M/10M" style={inp} />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
                <input type="checkbox" checked={queueForm.disabled} onChange={e => setQueueForm(f => ({ ...f, disabled: e.target.checked }))} />
                Disabled
              </label>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn-outline" onClick={() => setShowCreateQueue(false)}>Cancel</button>
                <button className="btn-primary" disabled={submitting || !queueForm.name || !queueForm.target} onClick={createRouterOsQueue}>
                  {submitting ? 'Creating...' : 'Create Queue'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Session Detail Drawer ───────────────────────── */}
      {showSessionDetail && (() => {
        const s = sessions.find(x => x.id === showSessionDetail);
        if (!s) return null;
        return (
          <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}
            onClick={() => setShowSessionDetail(null)}>
            <div style={{ background: 'white', padding: 32, width: 480, maxWidth: '95vw', height: '100vh', overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.1)' }}
              onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>{s.username}</h2>
                <span style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setShowSessionDetail(null)}>
                  <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  ['Session ID', s.sessionId],
                  ['NAS IP', s.nasIpAddress ?? '—'],
                  ['Framed IP', s.framedIpAddress ?? '—'],
                  ['Profile', s.profile ?? '—'],
                  ['Service Type', (s as any).serviceType ?? '—'],
                  ['Caller ID', (s as any).callerId ?? '—'],
                  ['Start Time', s.startTime ? fmtDT(s.startTime) : '—'],
                  ['Duration', s.sessionDuration ? Math.floor(s.sessionDuration / 60) + ' min' : '—'],
                  ['Download', s.downloadBytes ? fmtBytes(Number(s.downloadBytes)) : '—'],
                  ['Upload', s.uploadBytes ? fmtBytes(Number(s.uploadBytes)) : '—'],
                  ['Status', s.isActive ? 'Active' : 'Inactive'],
                ].map(([label, value]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--text-muted)' }}>{label}</span>
                    <span style={{ fontWeight: 600 }}>{value}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 20 }}>
                {s.isActive && <button className="btn-outline" onClick={() => { disconnectSession(s.id); setShowSessionDetail(null); }}>Disconnect Session</button>}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Tabs ─────────────────────────────────────────── */}
      {error && (
        <div style={{ padding: '12px 16px', background: '#FEE2E2', color: '#DC2626', borderRadius: 12, marginBottom: 16, fontSize: '0.85rem' }}>
          {error} <button onClick={() => setError('')} style={{ marginLeft: 12, background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626', fontWeight: 600 }}>Dismiss</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '8px 18px', borderRadius: 20, border: '1px solid var(--border-color)', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem', backgroundColor: tab === t ? 'var(--primary)' : '#fff', color: tab === t ? '#fff' : 'var(--text-color)' }}>
            {t}
          </button>
        ))}
      </div>

      {/* ── Add Device/NAS Drawer ───────────────────────── */}
      {showAddDevice && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}
          onClick={() => setShowAddDevice(false)}>
          <div style={{ background: 'white', padding: 32, width: 480, maxWidth: '95vw', height: '100vh', overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.1)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Add NAS Device</h2>
              <span style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setShowAddDevice(false)}>
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Device Name</label>
                <input value={deviceForm.name} onChange={e => setDeviceForm(f => ({ ...f, name: e.target.value }))} style={inp} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Type</label>
                  <select value={deviceForm.type} onChange={e => setDeviceForm(f => ({ ...f, type: e.target.value }))} style={sel}>
                    {['router', 'switch', 'olt', 'ap', 'nas'].map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Vendor</label>
                  <select value={deviceForm.vendor} onChange={e => setDeviceForm(f => ({ ...f, vendor: e.target.value }))} style={sel}>
                    {['', 'MikroTik', 'Cisco', 'Huawei', 'Juniper', 'Ubiquiti'].map(v => <option key={v} value={v}>{v || 'Select...'}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>IP Address</label>
                <input value={deviceForm.ipAddress} onChange={e => setDeviceForm(f => ({ ...f, ipAddress: e.target.value }))} placeholder="10.0.0.1" style={inp} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Location</label>
                <input value={deviceForm.location} onChange={e => setDeviceForm(f => ({ ...f, location: e.target.value }))} placeholder="Data Center" style={inp} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>RADIUS Secret</label>
                <input value={deviceForm.secret} onChange={e => setDeviceForm(f => ({ ...f, secret: e.target.value }))} style={inp} />
              </div>
              {deviceForm.type === 'router' && (
                <>
                  <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 14, marginTop: 4 }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 10 }}>RouterOS REST API</div>
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>API Username</label>
                    <input value={deviceForm.routerosUsername} onChange={e => setDeviceForm(f => ({ ...f, routerosUsername: e.target.value }))} placeholder="user1-api" style={inp} />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>API Password</label>
                    <input type="password" value={deviceForm.routerosPassword} onChange={e => setDeviceForm(f => ({ ...f, routerosPassword: e.target.value }))} style={inp} />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>API Port</label>
                    <input type="number" value={deviceForm.routerosPort} onChange={e => setDeviceForm(f => ({ ...f, routerosPort: Number(e.target.value) }))} style={{ ...inp, width: 120 }} />
                  </div>
                </>
              )}
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn-outline" onClick={() => setShowAddDevice(false)}>Cancel</button>
                <button className="btn-primary" disabled={submitting || !deviceForm.name || !deviceForm.ipAddress} onClick={addDevice}>
                  {submitting ? 'Adding...' : 'Add Device'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit NAS Device Drawer ──────────────────────── */}
      {showEditDevice && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}
          onClick={() => setShowEditDevice(null)}>
          <div style={{ background: 'white', padding: 32, width: 480, maxWidth: '95vw', height: '100vh', overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,0.1)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Edit NAS Device</h2>
              <span style={{ cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setShowEditDevice(null)}>
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Device Name</label>
                <input value={editDeviceForm.name} onChange={e => setEditDeviceForm(f => ({ ...f, name: e.target.value }))} style={inp} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>IP Address</label>
                <input value={editDeviceForm.ipAddress} onChange={e => setEditDeviceForm(f => ({ ...f, ipAddress: e.target.value }))} placeholder="10.0.0.1" style={inp} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>Location</label>
                <input value={editDeviceForm.location} onChange={e => setEditDeviceForm(f => ({ ...f, location: e.target.value }))} placeholder="Data Center" style={inp} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>RADIUS Secret</label>
                <input value={editDeviceForm.secret} onChange={e => setEditDeviceForm(f => ({ ...f, secret: e.target.value }))} style={inp} />
              </div>
              {showEditDevice?.type === 'router' && (
                <>
                  <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 14, marginTop: 4 }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 10 }}>RouterOS REST API</div>
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>API Username</label>
                    <input value={editDeviceForm.routerosUsername} onChange={e => setEditDeviceForm(f => ({ ...f, routerosUsername: e.target.value }))} placeholder="user1-api" style={inp} />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>API Password</label>
                    <input type="password" value={editDeviceForm.routerosPassword} onChange={e => setEditDeviceForm(f => ({ ...f, routerosPassword: e.target.value }))} style={inp} />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-muted)' }}>API Port</label>
                    <input type="number" value={editDeviceForm.routerosPort} onChange={e => setEditDeviceForm(f => ({ ...f, routerosPort: Number(e.target.value) }))} style={{ ...inp, width: 120 }} />
                  </div>
                </>
              )}
              <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
                <button className="btn-outline" onClick={() => setShowEditDevice(null)}>Cancel</button>
                <button className="btn-primary" disabled={submitting || !editDeviceForm.name || !editDeviceForm.ipAddress} onClick={handleEditDevice}>
                  {submitting ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
