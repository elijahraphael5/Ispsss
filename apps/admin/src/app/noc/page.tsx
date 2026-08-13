'use client';

import { useState, useEffect } from 'react';
import { api } from '@isp/shared';
import { SkeletonBlock, SkeletonCard, SkeletonTable } from '../../components/Skeleton';

interface Device {
  id: string;
  name: string;
  type: string;
  status: string;
  ipAddress: string;

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

export default function NocPage() {
  const [data, setData] = useState<NocDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [updating, setUpdating] = useState<Record<string, boolean>>({});

  const fetchDashboard = () => {
    setLoading(true);
    setError(false);
    api<NocDashboard>('/noc')
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchDashboard(); }, []);

  const toggleStatus = (device: Device) => {
    const newStatus = device.status === 'ONLINE' ? 'OFFLINE' : 'ONLINE';
    setUpdating((prev) => ({ ...prev, [device.id]: true }));
    api<Device>(`/noc/devices/${device.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: newStatus }),
    })
      .then(() => fetchDashboard())
      .catch(() => fetchDashboard())
      .finally(() => setUpdating((prev) => ({ ...prev, [device.id]: false })));
  };

  const offlineCount = data
    ? data.summary.totalDevices - data.summary.onlineDevices - data.summary.warningDevices - data.summary.criticalDevices
    : 0;
  const alertCount = data ? data.summary.warningDevices + data.summary.criticalDevices : 0;

  const cards = data
    ? [
        { label: 'Total Devices', value: data.summary.totalDevices, color: '#333' },
        { label: 'Online Devices', value: data.summary.onlineDevices, color: '#16a34a' },
        { label: 'Offline Devices', value: offlineCount, color: '#dc2626' },
        { label: 'Alerts', value: alertCount, color: '#ea580c' },
      ]
    : [];

  const statusColor = (status: string) => {
    switch (status) {
      case 'ONLINE':
        return '#16a34a';
      case 'OFFLINE':
        return '#dc2626';
      case 'WARNING':
        return '#ea580c';
      case 'CRITICAL':
        return '#b91c1c';
      default:
        return '#888';
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <SkeletonBlock width={200} height={28} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} height={90} />)}
        </div>
        <div className="data-card" style={{ padding: 24 }}>
          <SkeletonTable rows={8} cols={5} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <main style={{ padding: 24 }}>
        <h1 style={{ margin: 0 }}>NOC Dashboard</h1>
        <p>Failed to load NOC data.</p>
        <button onClick={fetchDashboard} style={{ padding: '8px 16px', cursor: 'pointer' }}>Retry</button>
      </main>
    );
  }

  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ margin: 0 }}>NOC Dashboard</h1>
      <hr style={{ margin: '16px 0' }} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 32 }}>
        {cards.map((card) => (
          <div
            key={card.label}
            style={{
              background: '#fff',
              borderRadius: 8,
              padding: 24,
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            }}
          >
            <div style={{ fontSize: 14, color: '#888', marginBottom: 8 }}>{card.label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: card.color }}>{card.value}</div>
          </div>
        ))}
      </div>

      {data.devices.length === 0 ? (
        <p>No devices found.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', borderRadius: 8 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #eee' }}>
              <th style={{ padding: 12, textAlign: 'left' }}>Name</th>
              <th style={{ padding: 12, textAlign: 'left' }}>Type</th>
              <th style={{ padding: 12, textAlign: 'left' }}>Status</th>
              <th style={{ padding: 12, textAlign: 'left' }}>IP</th>
              <th style={{ padding: 12, textAlign: 'left' }}>Location</th>
              <th style={{ padding: 12, textAlign: 'left' }}>Last Seen</th>
              <th style={{ padding: 12, textAlign: 'left' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {data.devices.map((device) => (
              <tr key={device.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: 12 }}>{device.name}</td>
                <td style={{ padding: 12 }}>{device.type}</td>
                <td style={{ padding: 12 }}>
                  <span
                    style={{
                      color: '#fff',
                      background: statusColor(device.status),
                      padding: '4px 8px',
                      borderRadius: 4,
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {device.status}
                  </span>
                </td>
                <td style={{ padding: 12 }}>{device.ipAddress}</td>

                <td style={{ padding: 12 }}>{new Date(device.updatedAt).toLocaleString()}</td>
                <td style={{ padding: 12 }}>
                  <button
                    onClick={() => toggleStatus(device)}
                    disabled={updating[device.id]}
                    style={{
                      padding: '6px 12px',
                      cursor: 'pointer',
                      fontSize: 12,
                      borderRadius: 4,
                      border: '1px solid #ccc',
                      background: updating[device.id] ? '#eee' : '#fff',
                    }}
                  >
                    {updating[device.id] ? '...' : device.status === 'ONLINE' ? 'Set Offline' : 'Set Online'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
