'use client';

import { useState, useEffect } from 'react';
import { api } from '@isp/shared';
import { SkeletonTable } from '../../../components/Skeleton';

interface SubscriberItem {
  id: string;
  user: { id: string; email: string; phone: string | null };
  status: string;
  type: string;
  address?: string | null;
  createdAt: string;
  subscriptions?: Array<{ id: string; plan: { name: string; speedMbps: number; priceKobo: number } }>;
  devices?: Array<{ connectionType: string; ipAddress: string | null; status: string }>;
}

const FILTERS = ['All', 'Active', 'Inactive', 'PPPoE', 'Static IP'];

function badge(label: string, color: string) {
  return <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600, backgroundColor: color + '18', color }}>{label}</span>;
}

export default function SubscribersPage() {
  const [subscribers, setSubscribers] = useState<SubscriberItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('All');

  useEffect(() => {
    api<{ data: SubscriberItem[]; total: number }>('/subscriptions?take=200')
      .then(r => setSubscribers(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function hasConnection(s: SubscriberItem, type: string) {
    return s.devices?.some(d => d.connectionType === type) ?? false;
  }

  function isActive(s: SubscriberItem) {
    return s.devices?.some(d => d.status === 'ONLINE') ?? false;
  }

  const filtered = subscribers.filter(s => {
    if (filter === 'All') return true;
    if (filter === 'Active') return isActive(s);
    if (filter === 'Inactive') return !isActive(s);
    if (filter === 'PPPoE') return hasConnection(s, 'PPPOE');
    if (filter === 'Static IP') return hasConnection(s, 'STATIC_IP');
    return true;
  });

  if (loading) {
    return (
      <main style={{ padding: 24 }}>
        <h1 className="page-title">Subscribers</h1>
        <div className="data-card" style={{ padding: 24, marginTop: 20 }}>
          <SkeletonTable rows={5} cols={6} />
        </div>
      </main>
    );
  }

  return (
    <>
      <div className="page-title-row">
        <h1 className="page-title">Subscribers</h1>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ padding: '6px 16px', borderRadius: 20, border: '1px solid var(--border-color)', cursor: 'pointer', fontWeight: 600, fontSize: '0.75rem', backgroundColor: filter === f ? 'var(--primary)' : '#fff', color: filter === f ? '#fff' : 'var(--text-color)' }}>
            {f}
          </button>
        ))}
      </div>
      <div className="data-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>
                <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.75rem' }}>EMAIL</th>
                <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.75rem' }}>PHONE</th>
                <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.75rem' }}>PLAN</th>
                <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.75rem' }}>CONNECTION</th>
                <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.75rem' }}>STATUS</th>
                <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.75rem' }}>CREATED</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>No subscribers</td></tr>
              ) : filtered.map(s => {
                const connectionDevice = s.devices?.[0];
                const hasPppoe = hasConnection(s, 'PPPOE');
                const hasStatic = hasConnection(s, 'STATIC_IP');
                const connLabel = hasPppoe && hasStatic ? 'PPPoE + Static' : hasPppoe ? 'PPPoE' : hasStatic ? 'Static IP' : '—';
                const connColor = hasPppoe ? '#2563EB' : hasStatic ? '#F15925' : '#94A3B8';
                return (
                  <tr key={s.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '10px 16px', fontWeight: 600 }}>{s.user.email}</td>
                    <td style={{ padding: '10px 16px' }}>{s.user.phone || '—'}</td>
                    <td style={{ padding: '10px 16px', color: 'var(--text-muted)' }}>{s.subscriptions?.[0]?.plan?.name || '—'}</td>
                    <td style={{ padding: '10px 16px' }}>
                      {connLabel !== '—' ? badge(connLabel, connColor) : <span style={{ color: '#94A3B8', fontSize: '0.75rem' }}>—</span>}
                      {connectionDevice?.ipAddress && <span style={{ marginLeft: 6, fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--text-muted)' }}>{connectionDevice.ipAddress}</span>}
                    </td>
                    <td style={{ padding: '10px 16px' }}>
                      <span style={{
                        display: 'inline-block', padding: '4px 10px', borderRadius: 12, fontWeight: 600, fontSize: '0.75rem',
                        backgroundColor: s.status === 'ACTIVE' ? '#DCFCE7' : '#FEE2E2',
                        color: s.status === 'ACTIVE' ? '#16A34A' : '#DC2626',
                      }}>{s.status}</span>
                    </td>
                    <td style={{ padding: '10px 16px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>{new Date(s.createdAt).toLocaleDateString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
