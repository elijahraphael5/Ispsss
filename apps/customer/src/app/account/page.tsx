'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore, api } from '@isp/shared';
import { SkeletonBlock, SkeletonCard } from '../components/Skeleton';

export default function AccountPage() {
  const { user, accessToken, logout } = useAuthStore();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [subscriber, setSubscriber] = useState<any>(null);

  useEffect(() => {
    if (!accessToken) {
      if (typeof window !== 'undefined' && !localStorage.getItem('accessToken')) router.push('/login');
      return;
    }
    api('/customer/dashboard').then((d: any) => setSubscriber(d.subscriber)).catch(() => {}).finally(() => setLoading(false));
  }, [accessToken, router]);

  if (!accessToken) return null;

  if (loading) {
    return <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <SkeletonBlock width={200} height={28} />
      <SkeletonCard height={200} />
      <SkeletonCard height={150} />
    </div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 700 }}>My Account</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Profile, security, and settings</p>
      </div>

      <div className="data-card" style={{ padding: 24 }}>
        <div style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 16 }}>Profile</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 18 }}>
          {[
            { label: 'Name', value: user?.email?.split('@')[0] ?? '—' },
            { label: 'Email', value: user?.email ?? '—' },
            { label: 'Phone', value: user?.phone ?? '—' },
            { label: 'Customer ID', value: subscriber?.id?.slice(0, 8).toUpperCase() ?? '—' },
            { label: 'Account Number', value: subscriber?.id?.slice(0, 8).toUpperCase() ?? '—' },
            { label: 'Address', value: subscriber?.address ?? '—' },
          ].map(f => (
            <div key={f.label}>
              <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700, marginBottom: 4 }}>{f.label}</div>
              <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{f.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="data-card" style={{ padding: 24 }}>
        <div style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 16 }}>Security</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--border-color)' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Change Password</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Update your account password</div>
            </div>
            <button className="btn-sm-outline">Change</button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--border-color)' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Two-Factor Auth</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{user?.twoFaEnabled ? 'Enabled' : 'Not configured'}</div>
            </div>
            <button className="btn-sm-outline">{user?.twoFaEnabled ? 'Disable' : 'Enable'}</button>
          </div>
        </div>
      </div>

      <div className="data-card" style={{ padding: 24 }}>
        <div style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 16 }}>Connected Devices</div>
        {subscriber?.id ? (
          <div style={{ padding: '14px 18px', background: '#F8FAFC', borderRadius: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>CPE Device</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>MAC: {subscriber.id?.slice(0, 8) ?? '—'}</div>
            </div>
            <span style={{ padding: '4px 12px', borderRadius: 20, fontSize: '0.75rem', fontWeight: 600, background: '#e6f9ed', color: '#1db954' }}>Active</span>
          </div>
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No devices registered</p>
        )}
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <button className="btn-outline" onClick={() => { logout(); router.push('/login'); }} style={{ color: '#DC2626', borderColor: '#DC2626' }}>Logout</button>
      </div>
    </div>
  );
}
