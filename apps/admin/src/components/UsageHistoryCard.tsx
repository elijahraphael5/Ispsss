'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api, timeAgo } from '@isp/shared';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';

const GAP_MS = 120000;

const RANGES = [
  { key: 'live', label: 'Live' },
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'yearly', label: 'Yearly' },
] as const;

type RangeKey = (typeof RANGES)[number]['key'];

interface LivePoint { t: string; downMbps: number; upMbps: number; }
interface UsagePoint { bucket: string; usageMb: number; peakDownMbps: number; peakUpMbps: number; }

function fmtUsage(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

function fmtMbps(mbps: number): string {
  if (mbps >= 1000) return `${(mbps / 1000).toFixed(2)} Gbps`;
  return `${mbps.toFixed(2)} Mbps`;
}

function splitRateToMbps(rate: string | null | undefined): { down: number; up: number } {
  if (!rate) return { down: 0, up: 0 };
  const parts = String(rate).split('/');
  return {
    down: (parseFloat(parts[0]) || 0) / 1e6,
    up: (parseFloat(parts[1]) || 0) / 1e6,
  };
}

function shortBucket(b: string): string {
  if (b.length === 10) {
    const d = new Date(b + 'T00:00:00Z');
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  if (b.length === 7) {
    const d = new Date(b + '-01T00:00:00Z');
    return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
  }
  return b;
}

export default function UsageHistoryCard({ username, ip, planSpeedMbps }: { username?: string; ip?: string; planSpeedMbps?: number | null }) {
  const [range, setRange] = useState<RangeKey>('live');
  const [live, setLive] = useState<LivePoint[]>([]);
  const [usage, setUsage] = useState<UsagePoint[]>([]);
  const [latest, setLatest] = useState<any | null>(null);
  const [snapOnline, setSnapOnline] = useState<boolean | null>(null);
  const [samples, setSamples] = useState<Date[]>([]);
  const [noQueueData, setNoQueueData] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLive = async (uname?: string, address?: string) => {
    const q = uname ? 'username=' + encodeURIComponent(uname) : address ? 'ip=' + encodeURIComponent(address) : '';
    if (!q) return;
    const rows = await api<any[]>('/routeros/metrics?' + q + '&limit=120').catch(() => []);
    const pts = rows
      .filter(r => r.queueRate || r.queueBytes)
      .map(r => {
        const { down, up } = splitRateToMbps(r.queueRate);
        return { t: new Date(r.capturedAt).toLocaleTimeString(), downMbps: down, upMbps: up };
      });
    setNoQueueData(rows.length > 0 && pts.length === 0);
    setLatest(rows[0] ?? null);
    setLive(pts);
    setSamples(rows.map(r => new Date(r.capturedAt)).sort((a, b) => a.getTime() - b.getTime()));
    if (uname) {
      const snaps = await api<any[]>('/routeros/snapshots?username=' + encodeURIComponent(uname)).catch(() => []);
      const snap = snaps[0];
      if (snap) setSnapOnline(!!snap.isOnline);
    }
  };

  const fetchUsage = async (uname?: string, address?: string, rng?: string) => {
    if (!uname && !address) return;
    const q = uname ? 'username=' + encodeURIComponent(uname) : 'ip=' + encodeURIComponent(address);
    const rows = await api<any[]>('/routeros/usage?' + q + '&range=' + rng).catch(() => []);
    setUsage(rows.map(r => ({
      bucket: r.bucket,
      usageMb: (parseInt(r.usageBytes || '0', 10) || 0) / 1e6,
      peakDownMbps: ((parseInt(r.peakDownBps || '0', 10) || 0) / 1e6),
      peakUpMbps: ((parseInt(r.peakUpBps || '0', 10) || 0) / 1e6),
    })));
  };

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (range === 'live') {
      fetchLive(username, ip);
      timerRef.current = setInterval(() => fetchLive(username, ip), 30000);
    } else {
      fetchUsage(username, ip, range);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [range, username, ip]);

  const chartData = range === 'live' ? live : usage;
  const isLive = range === 'live';
  const stale = !!latest && Date.now() - new Date(latest.capturedAt).getTime() > 120000;
  const offline = stale || (snapOnline === false && !!latest);
  const connected = !!latest && !offline;

  const segs = useMemo(() => {
    if (samples.length === 0) return [];
    const out: { up: boolean; from: Date; to: Date }[] = [];
    for (let i = 0; i < samples.length - 1; i++) {
      const from = samples[i];
      const to = samples[i + 1];
      const up = to.getTime() - from.getTime() <= GAP_MS;
      const last = out[out.length - 1];
      if (last && last.up === up && from.getTime() - last.to.getTime() <= 2000) {
        last.to = to;
      } else {
        out.push({ up, from, to });
      }
    }
    out.push({ up: !offline, from: samples[samples.length - 1], to: new Date() });
    return out;
  }, [samples, offline]);

  const upMs = segs.filter(s => s.up).reduce((a, s) => a + (s.to.getTime() - s.from.getTime()), 0);
  const totalMs = segs.reduce((a, s) => a + (s.to.getTime() - s.from.getTime()), 0);
  const upPct = totalMs ? Math.round((upMs / totalMs) * 100) : 100;
  const downMins = Math.round((totalMs - upMs) / 60000);
  const segDur = (s: { up: boolean; from: Date; to: Date }) => {
    const m = Math.round((s.to.getTime() - s.from.getTime()) / 60000);
    return m > 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
  };

  return (
    <div className="data-card" style={{ padding: 24, marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 700 }}>
          METRICS HISTORY {isLive && latest && (connected ? <span style={{ color: '#16A34A', fontSize: '0.68rem', fontWeight: 600 }}>● live · every 30s</span> : <span style={{ color: '#B45309', fontSize: '0.68rem', fontWeight: 600 }}>● offline · last sample {timeAgo(latest.capturedAt)}</span>)}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {RANGES.map(r => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              style={{
                padding: '5px 14px', borderRadius: 20, border: range === r.key ? 'none' : '1px solid var(--border-color)',
                background: range === r.key ? 'var(--primary)' : 'transparent',
                color: range === r.key ? '#fff' : 'var(--text-muted)', fontWeight: 600, fontSize: '0.75rem', cursor: 'pointer',
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {isLive && (latest || planSpeedMbps || !username) && (
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>↓ Download</div>
            <div style={{ fontSize: '1rem', fontWeight: 700, fontFamily: 'monospace', color: '#2563EB' }}>
              {latest?.queueRate ? fmtMbps(splitRateToMbps(latest.queueRate).down) : planSpeedMbps ? `${planSpeedMbps} Mbps (plan)` : !username ? 'Unlimited (no queue)' : '—'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>↑ Upload</div>
            <div style={{ fontSize: '1rem', fontWeight: 700, fontFamily: 'monospace', color: '#F15925' }}>
              {latest?.queueRate ? fmtMbps(splitRateToMbps(latest.queueRate).up) : planSpeedMbps ? `${planSpeedMbps} Mbps (plan)` : !username ? 'Unlimited (no queue)' : '—'}
            </div>
          </div>
          {latest && (
            <div>
              <div style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Cumulative (queue)</div>
              <div style={{ fontSize: '1rem', fontWeight: 700, fontFamily: 'monospace' }}>{latest.queueBytes ? fmtUsage((parseInt(latest.queueBytes, 10) || 0) / 1e6) : '—'}</div>
            </div>
          )}
          {latest && (
            <div>
              <div style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Status</div>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: connected && latest.isOnline ? undefined : '#94A3B8' }}>{connected && latest.isOnline ? 'Online' : 'Offline'}</div>
            </div>
          )}
          {latest && (
            <div>
              <div style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>IP / Uptime</div>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, fontFamily: 'monospace' }}>{latest.ipAddress || '—'}{latest.sessionUptime ? ` · ${latest.sessionUptime}` : ''}</div>
            </div>
          )}
        </div>
      )}

      {isLive && !latest && !username && (
        <div style={{ width: '100%', marginBottom: 16 }}>
          <div style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>Configured speed</div>
          {planSpeedMbps ? (
            <div style={{ width: '100%', height: 130 }}>
              <ResponsiveContainer width="100%" height={130}>
                <BarChart data={[{ name: '↓ Download', value: planSpeedMbps }, { name: '↑ Upload', value: planSpeedMbps }]} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: '#94A3B8' }} tickFormatter={(v: number) => `${v} Mbps`} />
                  <YAxis type="category" dataKey="name" width={95} tick={{ fontSize: 11, fill: '#64748B' }} />
                  <Tooltip formatter={(v: number) => [`${v} Mbps`, 'Configured']} />
                  <Bar dataKey="value" name="speed" radius={[0, 6, 6, 0]} barSize={18}>
                    <Cell fill="#2563EB" />
                    <Cell fill="#F15925" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {([['↓ Download', '#2563EB'], ['↑ Upload', '#F15925']] as const).map(([label, c]) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 90, fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>{label}</span>
                  <div style={{ flex: 1, height: 18, borderRadius: 6, background: 'var(--border-color)', overflow: 'hidden' }}>
                    <div style={{ width: '100%', height: '100%', background: `repeating-linear-gradient(45deg, ${c}30 0 8px, transparent 8px 16px)` }} />
                  </div>
                  <span style={{ width: 132, fontSize: '0.75rem', fontWeight: 700, fontFamily: 'monospace', color: c }}>UNLIMITED · no queue</span>
                </div>
              ))}
            </div>
          )}
          <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: 8 }}>
            This router has no per-customer queue for static IPs — speed is whatever the network allows. Live ↓/↑ counters would need a queue per customer on the router.
          </p>
        </div>
      )}

      {noQueueData && isLive ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          No bandwidth counters for this connection (static clients are tracked via ARP — connect/disconnect history only).
        </p>
      ) : chartData.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          {isLive
            ? !username
              ? 'No live traffic counters yet (configured speed shown above).'
              : planSpeedMbps
                ? 'No live bandwidth counters yet for this connection (plan speed shown above).'
                : 'No live samples yet — the cron writes a row every 30s.'
            : 'No usage for this period yet. Usage history starts accumulating from the first poll.'}
        </p>
      ) : (
        <>
        <div style={{ width: '100%', height: 240 }}>
          {isLive && (
            <div style={{ display: 'flex', gap: 16, marginBottom: 8, fontSize: '0.72rem', fontWeight: 600 }}>
              <span style={{ color: '#2563EB' }}>● ↓ Download</span>
              <span style={{ color: '#F15925' }}>● ↑ Upload</span>
            </div>
          )}
          <ResponsiveContainer>
            {isLive ? (
              <AreaChart data={chartData as any}>
                <defs>
                  <linearGradient id="downGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563EB" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#2563EB" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="upGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#F15925" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#F15925" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="t" tick={{ fontSize: 10, fill: '#94A3B8' }} interval="preserveStartEnd" minTickGap={40} />
                <YAxis tick={{ fontSize: 10, fill: '#94A3B8' }} width={52} tickFormatter={(v: number) => fmtMbps(v)} />
                <Tooltip
                  formatter={(v: number, name: string) => (name === 'downMbps' ? [fmtMbps(v), '↓ Download'] : [fmtMbps(v), '↑ Upload'])}
                  labelFormatter={(l: string) => `Poll ${l}`}
                />
                <Area type="monotone" dataKey="downMbps" name="downMbps" stroke="#2563EB" strokeWidth={2} fill="url(#downGrad)" />
                <Area type="monotone" dataKey="upMbps" name="upMbps" stroke="#F15925" strokeWidth={2} fill="url(#upGrad)" />
              </AreaChart>
            ) : (
              <BarChart data={chartData as any}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: '#94A3B8' }} tickFormatter={shortBucket} interval="preserveStartEnd" minTickGap={24} />
                <YAxis tick={{ fontSize: 10, fill: '#94A3B8' }} width={52} tickFormatter={(v: number) => fmtUsage(v)} />
                <Tooltip
                  formatter={(v: number, name: string) => {
                    if (name === 'usageMb') return [fmtUsage(v), 'Usage'];
                    if (name === 'peakDownMbps') return [fmtMbps(v), '↓ Peak down'];
                    return [fmtMbps(v), '↑ Peak up'];
                  }}
                  labelFormatter={shortBucket}
                />
                <Bar dataKey="usageMb" name="usageMb" fill="#F15925" radius={[4, 4, 0, 0]} />
                <Bar dataKey="peakDownMbps" name="peakDownMbps" fill="#2563EB" hide />
                <Bar dataKey="peakUpMbps" name="peakUpMbps" fill="#F15925" hide />
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
        {isLive && samples.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: 0.5 }}>Connection status</span>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                <span style={{ color: '#16A34A' }}>● up {upPct}%</span>
                {downMins > 0 && <span style={{ color: '#EF4444' }}> · down {downMins}m</span>}
              </span>
            </div>
            <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', gap: 2 }}>
              {segs.map((s, i) => (
                <div
                  key={i}
                  title={`${s.up ? 'Connected' : 'Downtime'}: ${s.from.toLocaleTimeString()} → ${s.to.toLocaleTimeString()} (${segDur(s)})`}
                  style={{
                    flexGrow: Math.max(1, (s.to.getTime() - s.from.getTime()) / 60000),
                    backgroundColor: s.up ? '#16A34A' : '#EF4444',
                    minWidth: 3,
                  }}
                />
              ))}
            </div>
          </div>
        )}
        </>
      )}
    </div>
  );
}
