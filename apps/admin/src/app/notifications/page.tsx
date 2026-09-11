'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@isp/shared';
import { SkeletonBlock, SkeletonCard } from '../../components/Skeleton';

interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'INFO' | 'WARNING' | 'ERROR';
  link?: string;
  read: boolean;
  createdAt: string;
}

const typeColors: Record<string, { bg: string; fg: string; label: string }> = {
  INFO: { bg: '#2563eb18', fg: '#2563eb', label: 'Info' },
  WARNING: { bg: '#ea580c18', fg: '#ea580c', label: 'Warning' },
  ERROR: { bg: '#dc262618', fg: '#dc2626', label: 'Error' },
};

export default function NotificationsPage() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<'ALL' | 'UNREAD'>('ALL');

  const fetchNotifications = useCallback(() => {
    setError(false);
    api<Notification[]>('/notifications')
      .then(setNotifications)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  const markAsRead = async (id: string) => {
    try {
      await api(`/notifications/${id}/read`, { method: 'PATCH' });
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    } catch {
      fetchNotifications();
    }
  };

  const markAllAsRead = async () => {
    try {
      await api('/notifications/mark-all-read', { method: 'POST' });
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch {
      fetchNotifications();
    }
  };

  const filtered = filter === 'UNREAD' ? notifications.filter((n) => !n.read) : notifications;
  const unreadCount = notifications.filter((n) => !n.read).length;

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <SkeletonBlock width={200} height={28} />
        <SkeletonBlock width={140} height={14} />
        <div style={{ display: 'flex', gap: 8 }}>
          <SkeletonBlock width={120} height={34} borderRadius={20} />
          <SkeletonBlock width={120} height={34} borderRadius={20} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} height={80} />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <>
        <div className="page-title-row">
          <h1 className="page-title">Notifications</h1>
        </div>
        <div className="data-card" style={{ padding: 40, textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>Failed to load notifications.</p>
          <button onClick={fetchNotifications} className="btn-outline" style={{ margin: '0 auto' }}>Retry</button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Notifications</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 4 }}>
            {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
          </p>
        </div>
        {unreadCount > 0 && (
          <button onClick={markAllAsRead} className="btn-primary">
            <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
            Mark All Read
          </button>
        )}
      </div>

      <div className="badge-tabs" style={{ width: 'fit-content' }}>
        {(['ALL', 'UNREAD'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`tab-item${filter === f ? ' active' : ''}`}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', font: 'inherit', fontWeight: 600 }}
          >
            {f === 'ALL' ? `All (${notifications.length})` : `Unread (${unreadCount})`}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="data-card" style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, color: 'var(--text-muted)' }}>
            <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" style={{ opacity: 0.45 }}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>No notifications</span>
            <span style={{ fontSize: '0.78rem' }}>{filter === 'UNREAD' ? 'You are all caught up.' : 'Nothing here yet.'}</span>
          </div>
        </div>
      ) : (
        <div className="data-card" style={{ overflow: 'hidden' }}>
          {filtered.map((n, i) => {
            const tc = typeColors[n.type] ?? typeColors.INFO;
            return (
              <div
                key={n.id}
                onClick={() => n.link && router.push(n.link)}
                style={{
                  display: 'flex', gap: 12, alignItems: 'flex-start', padding: '14px 18px',
                  borderBottom: i < filtered.length - 1 ? '1px solid var(--border-color)' : 'none',
                  background: n.read ? 'transparent' : '#FFF9F5',
                  cursor: n.link ? 'pointer' : 'default',
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: tc.fg, marginTop: 6, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>{n.title}</span>
                    <span style={{ fontSize: '0.66rem', fontWeight: 700, borderRadius: 20, padding: '2px 9px', background: tc.bg, color: tc.fg }}>{tc.label}</span>
                    {!n.read && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--primary)' }} />}
                  </div>
                  <p style={{ margin: '2px 0', color: 'var(--text-muted)', fontSize: '0.82rem', lineHeight: 1.45 }}>{n.message}</p>
                  <span style={{ fontSize: '0.7rem', color: '#94A3B8' }}>{new Date(n.createdAt).toLocaleString()}</span>
                </div>
                {!n.read && (
                  <button
                    onClick={(e) => { e.stopPropagation(); markAsRead(n.id); }}
                    className="btn-sm-outline"
                    style={{ padding: '5px 12px', flexShrink: 0 }}
                  >
                    Dismiss
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
