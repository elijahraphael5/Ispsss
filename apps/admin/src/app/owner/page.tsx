'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api, useAuthStore } from '@isp/shared';
import { SkeletonBlock, SkeletonTable } from '../../components/Skeleton';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  _count: { users: number; subscribers: number };
}

interface ApiTenant {
  id: string;
  name: string;
  slug: string;
  _count: { users: number; subscribers: number };
}

const cellStyle: React.CSSProperties = {
  border: '1px solid #ccc',
  padding: '8px 12px',
  textAlign: 'left',
};

export default function OwnerPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [impersonatingId, setImpersonatingId] = useState<string | null>(null);
  const router = useRouter();
  const { user } = useAuthStore();
  const isSuperAdmin = user?.isSuperAdmin === true;

  async function fetchTenants() {
    try {
      setError('');
      setLoading(true);
      const data = await api<ApiTenant[]>('/owner/tenants');
      setTenants(data);
    } catch {
      setError('Failed to load tenants. Owner access requires SUPERADMIN role.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isSuperAdmin) {
      setError('Access denied. Owner dashboard requires SUPERADMIN role.');
      setLoading(false);
      return;
    }
    fetchTenants();
  }, [isSuperAdmin]);

  async function handleImpersonate(tenantId: string, tenantName: string) {
    setImpersonatingId(tenantId);
    try {
      const res = await api<{ accessToken: string; tenantId: string }>(
        `/owner/impersonate/${tenantId}`,
        { method: 'POST' },
      );
      localStorage.setItem('accessToken', res.accessToken);
      localStorage.setItem('impersonatingTenantName', tenantName);
      router.push('/');
    } catch {
      setError('Impersonation failed.');
      setImpersonatingId(null);
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <SkeletonBlock width={200} height={28} />
        <div className="data-card" style={{ padding: 24 }}>
          <SkeletonTable rows={6} cols={4} />
        </div>
      </div>
    );
  }

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ margin: '0 0 8px 0', fontSize: 24 }}>Owner Dashboard</h1>
      <p style={{ color: '#666', marginBottom: 20, fontSize: 14 }}>
        Cross-tenant management console. Select a tenant to impersonate and manage their data.
      </p>

      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #f87171', borderRadius: 6, padding: '12px 16px', marginBottom: 16, color: '#991b1b' }}>
          {error}
        </div>
      )}

      {tenants.length === 0 && !error ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#888', border: '1px dashed #ccc', borderRadius: 8 }}>
          No tenants found.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#f3f4f6' }}>
                <th style={cellStyle}>Name</th>
                <th style={cellStyle}>Slug</th>
                <th style={cellStyle}>Users</th>
                <th style={cellStyle}>Subscribers</th>
                <th style={cellStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id}>
                  <td style={cellStyle}>{t.name}</td>
                  <td style={cellStyle}>{t.slug}</td>
                  <td style={cellStyle}>{t._count.users}</td>
                  <td style={cellStyle}>{t._count.subscribers}</td>
                  <td style={cellStyle}>
                    <button
                      onClick={() => handleImpersonate(t.id, t.name)}
                      disabled={impersonatingId === t.id}
                      style={{
                        padding: '6px 14px',
                        fontSize: 13,
                        border: 'none',
                        borderRadius: 4,
                        background: impersonatingId === t.id ? '#e5e7eb' : 'var(--accent-orange)',
                        color: impersonatingId === t.id ? '#9ca3af' : '#fff',
                        cursor: impersonatingId === t.id ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {impersonatingId === t.id ? 'Impersonating...' : 'Impersonate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
