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
      <div style={{ padding: 24 }}>
        <h1 style={{ margin: 0, fontSize: 28 }}>Notifications</h1>
        <p style={{ color: '#888', marginTop: 8 }}>Failed to load notifications.</p>
        <button onClick={fetchNotifications} style={{ padding: '8px 16px', cursor: 'pointer', borderRadius: 20, border: '1px solid #ccc', background: '#fff' }}>Retry</button>
      </div>
    );
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28 }}>Notifications</h1>
          <p style={{ margin: '4px 0 0', color: '#888', fontSize: 14 }}>
            {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {unreadCount > 0 && (
            <button
              onClick={markAllAsRead}
              style={{
                padding: '8px 20px', borderRadius: 20, border: 'none',
                background: '#FF6224', color: '#fff', cursor: 'pointer',
                fontSize: 13, fontWeight: 500,
              }}
            >
              Mark All Read
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {(['ALL', 'UNREAD'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '6px 18px', borderRadius: 20, border: '1px solid #ddd',
              background: filter === f ? '#FF6224' : '#fff',
              color: filter === f ? '#fff' : '#333',
              cursor: 'pointer', fontSize: 13, fontWeight: 500,
            }}
          >
            {f === 'ALL' ? `All (${notifications.length})` : `Unread (${unreadCount})`}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: 24, padding: 40, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', textAlign: 'center', color: '#888' }}>
          No notifications.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map((n) => {
            const tc = typeColors[n.type] ?? typeColors.INFO;
            return (
              <div
                key={n.id}
                onClick={() => n.link && router.push(n.link)}
                style={{
                  background: '#fff', borderRadius: 24, padding: '16px 20px',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                  borderLeft: `4px solid ${tc.fg}`,
                  opacity: n.read ? 0.6 : 1,
                  cursor: n.link ? 'pointer' : 'default',
                  transition: 'opacity 0.2s',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 15 }}>{n.title}</strong>
                      <span
                        style={{
                          fontSize: 11, fontWeight: 600, borderRadius: 20,
                          padding: '2px 10px', background: tc.bg, color: tc.fg,
                        }}
                      >
                        {tc.label}
                      </span>
                      {!n.read && (
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#FF6224', display: 'inline-block' }} />
                      )}
                    </div>
                    <p style={{ margin: '4px 0', color: '#555', fontSize: 14, lineHeight: 1.4 }}>{n.message}</p>
                    <span style={{ fontSize: 12, color: '#aaa' }}>{new Date(n.createdAt).toLocaleString()}</span>
                  </div>
                  {!n.read && (
                    <button
                      onClick={(e) => { e.stopPropagation(); markAsRead(n.id); }}
                      style={{
                        padding: '6px 16px', cursor: 'pointer', fontSize: 12,
                        borderRadius: 20, border: '1px solid #ddd',
                        background: '#fff', whiteSpace: 'nowrap', flexShrink: 0,
                      }}
                    >
                      Dismiss
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
