'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { api, timeAgo } from '@isp/shared';
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

const typeMeta: Record<string, { bg: string; fg: string; border: string; label: string; icon: string }> = {
  INFO: { bg: '#EFF6FF', fg: '#2563EB', border: '#BFDBFE', label: 'Info', icon: 'M12 16v-4 M12 8h.01' },
  WARNING: { bg: '#FFFBEB', fg: '#D97706', border: '#FDE68A', label: 'Warning', icon: 'M12 9v4 M12 17h.01' },
  ERROR: { bg: '#FEF2F2', fg: '#DC2626', border: '#FECACA', label: 'Error', icon: 'M12 8v4 M12 16h.01' },
};

function groupByDate(notifs: Notification[]) {
  const groups: { label: string; items: Notification[] }[] = [];
  const buckets = new Map<string, Notification[]>();
  const order: string[] = [];
  const fmt = (d: Date) => {
    const now = new Date();
    const diff = Math.floor((now.setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return `${diff} days ago`;
    return new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  };
  for (const n of notifs) {
    const k = fmt(new Date(n.createdAt));
    if (!buckets.has(k)) {
      buckets.set(k, []);
      order.push(k);
    }
    buckets.get(k)!.push(n);
  }
  for (const k of order) groups.push({ label: k, items: buckets.get(k)! });
  return groups;
}

export default function NotificationsPage() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<'ALL' | 'UNREAD'>('ALL');
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

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
    setDismissing(id);
    try {
      await api(`/notifications/${id}/read`, { method: 'PATCH' });
      setNotifications(prev => prev.map(n => (n.id === id ? { ...n, read: true } : n)));
    } catch {
      fetchNotifications();
    } finally {
      setTimeout(() => setDismissing(null), 220);
    }
  };

  const markAllAsRead = async () => {
    if (notifications.every(n => n.read)) return;
    setMarkingAll(true);
    try {
      await api('/notifications/mark-all-read', { method: 'POST' });
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch {
      fetchNotifications();
    } finally {
      setMarkingAll(false);
    }
  };

  const filtered = useMemo(() => (filter === 'UNREAD' ? notifications.filter(n => !n.read) : notifications), [notifications, filter]);
  const unreadCount = useMemo(() => notifications.filter(n => !n.read).length, [notifications]);
  const readCount = notifications.length - unreadCount;
  const groups = useMemo(() => groupByDate(filtered), [filtered]);

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <SkeletonBlock width={46} height={46} borderRadius={14} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <SkeletonBlock width={180} height={22} borderRadius={8} />
            <SkeletonBlock width={220} height={14} borderRadius={8} />
          </div>
        </div>
        <div className="grid-3" style={{ gap: 12 }}>
          <SkeletonCard height={86} />
          <SkeletonCard height={86} />
          <SkeletonCard height={86} />
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <SkeletonBlock width={120} height={36} borderRadius={999} />
          <SkeletonBlock width={120} height={36} borderRadius={999} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} height={84} />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <>
        <div className="page-title-row" style={{ alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <div style={{ width: 46, height: 46, borderRadius: 14, background: 'linear-gradient(135deg, #F59E0B 0%, #EA580C 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', boxShadow: '0 8px 20px rgba(245,158,11,0.22)' }}>
              <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            </div>
            <h1 className="page-title" style={{ letterSpacing: -0.3 }}>Notifications</h1>
          </div>
        </div>
        <div className="data-card" style={{ padding: 36, textAlign: 'center', borderTop: '3px solid #F59E0B' }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: '#FFFBEB', border: '1px solid #FDE68A', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', color: '#D97706' }}>
            <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </div>
          <p style={{ color: '#92400E', fontWeight: 700, fontSize: '0.92rem' }}>Couldn’t load notifications</p>
          <p style={{ color: '#B45309', fontSize: '0.82rem', marginTop: 4 }}>Check your connection and try again.</p>
          <button onClick={fetchNotifications} style={{ margin: '16px auto 0', padding: '10px 18px', borderRadius: 999, border: '1.5px solid #F59E0B', background: '#fff', color: '#92400E', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            Retry
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <style>{`@keyframes slideIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.45}}@keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}@keyframes pop{from{transform:scale(0.96);opacity:0}to{transform:scale(1);opacity:1}}`}</style>

      {/* ── Header ── */}
      <div className="page-title-row" style={{ alignItems: 'flex-start', gap: 16 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', minWidth: 0, flex: 1 }}>
          <div style={{ width: 46, height: 46, borderRadius: 14, background: unreadCount > 0 ? 'linear-gradient(135deg, #F59E0B 0%, #EA580C 100%)' : 'linear-gradient(135deg, #10B981 0%, #059669 100%)', boxShadow: unreadCount > 0 ? '0 8px 20px rgba(245,158,11,0.22)' : '0 8px 20px rgba(16,185,129,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0, position: 'relative' }}>
            <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            {unreadCount > 0 && <span style={{ position: 'absolute', top: -4, right: -4, minWidth: 20, height: 20, padding: '0 5px', borderRadius: 999, background: '#DC2626', border: '2px solid #fff', color: '#fff', fontSize: '0.62rem', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(220,38,38,0.28)' }}>{unreadCount > 99 ? '99+' : unreadCount}</span>}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h1 className="page-title" style={{ letterSpacing: -0.4, lineHeight: 1 }}>Notifications</h1>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, background: unreadCount > 0 ? '#FFFBEB' : '#ECFDF5', border: `1px solid ${unreadCount > 0 ? '#FDE68A' : '#A7F3D0'}`, fontSize: '0.68rem', fontWeight: 800, letterSpacing: 0.3, color: unreadCount > 0 ? '#92400E' : '#065F46' }}>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: unreadCount > 0 ? '#F59E0B' : '#10B981', boxShadow: unreadCount > 0 ? '0 0 8px rgba(245,158,11,0.35)' : '0 0 8px rgba(16,185,129,0.35)', animation: unreadCount > 0 ? 'pulse 1.6s infinite' : 'none' }} />
                {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
              </span>
            </div>
            <p style={{ color: '#64748B', fontSize: '0.84rem', marginTop: 4, lineHeight: 1.5 }}>
              Stay on top of sign-ups, renewals and alerts — <span style={{ color: '#94A3B8' }}>tap any notification to act, dismiss to clear.</span>
            </p>
          </div>
        </div>
        <button
          onClick={markAllAsRead}
          disabled={unreadCount === 0 || markingAll}
          style={{
            flexShrink: 0,
            padding: '10px 18px',
            borderRadius: 999,
            border: '1.5px solid #E2E8F0',
            background: unreadCount === 0 ? '#F8FAFC' : '#0F172A',
            color: unreadCount === 0 ? '#94A3B8' : '#fff',
            fontWeight: 700,
            fontSize: '0.82rem',
            cursor: unreadCount === 0 || markingAll ? 'not-allowed' : 'pointer',
            opacity: unreadCount === 0 || markingAll ? 0.7 : 1,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            boxShadow: unreadCount === 0 ? 'none' : '0 8px 20px rgba(15,23,42,0.12)',
            transition: 'all 0.15s',
          }}
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24" style={{ opacity: markingAll ? 0.6 : 1 }}>
            {markingAll ? <circle cx="12" cy="12" r="10" strokeDasharray="32" style={{ animation: 'spin 0.8s linear infinite' as any }} /> : <><polyline points="20 6 9 17 4 12" /></>}
          </svg>
          {markingAll ? 'Marking…' : 'Mark All Read'}
        </button>
      </div>

      {/* ── Stats ── */}
      <div className="grid-3" style={{ gap: 12 }}>
        {[
          { label: 'Total', value: notifications.length, sub: `${filtered.length} in view`, icon: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 0 1-3.46 0', bg: '#F8FAFC', color: '#334155', accent: '#E2E8F0' },
          { label: 'Unread', value: unreadCount, sub: unreadCount === 0 ? 'nothing pending' : 'needs attention', icon: 'M12 8v4 M12 16h.01 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', bg: unreadCount > 0 ? '#FFFBEB' : '#F8FAFC', color: unreadCount > 0 ? '#D97706' : '#94A3B8', accent: unreadCount > 0 ? '#FDE68A' : '#E2E8F0' },
          { label: 'Read', value: readCount, sub: `${Math.round(notifications.length ? (readCount / notifications.length) * 100 : 0)}% cleared`, icon: 'M22 11.08V12a10 10 0 1 1-5.93-9.14 M22 4L12 14.01l-3-3', bg: '#ECFDF5', color: '#059669', accent: '#A7F3D0' },
        ].map(c => (
          <div key={c.label} className="data-card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, borderTop: `3px solid ${c.accent}`, animation: 'slideIn 0.28s ease both' }}>
            <div style={{ width: 38, height: 38, borderRadius: 12, background: c.bg, border: `1px solid ${c.accent}`, color: c.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d={c.icon} /></svg>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '0.68rem', fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: '#94A3B8', lineHeight: 1 }}>{c.label}</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 800, letterSpacing: -0.3, color: '#0F172A', lineHeight: 1, marginTop: 2 }}>{c.value}</div>
              <div style={{ fontSize: '0.68rem', color: '#94A3B8', fontWeight: 600 }}>{c.sub}</div>
            </div>
            <div style={{ marginLeft: 'auto', width: 36, height: 6, borderRadius: 999, background: '#F1F5F9', overflow: 'hidden', display: notifications.length ? 'block' : 'none' }}>
              <div style={{ height: '100%', width: `${c.label === 'Total' ? 100 : c.label === 'Unread' ? (notifications.length ? (unreadCount / notifications.length) * 100 : 0) : (notifications.length ? (readCount / notifications.length) * 100 : 0)}%`, background: c.color, borderRadius: 999, transition: 'width 0.4s' }} />
            </div>
          </div>
        ))}
      </div>

      {/* ── Tabs ── */}
      <div className="data-card" style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: '#FFFFFF', borderTop: '3px solid #0F172A' }}>
        <div className="badge-tabs" style={{ padding: 3, gap: 3, background: '#F1F5F9' }}>
          {(['ALL', 'UNREAD'] as const).map(f => {
            const isActive = filter === f;
            const count = f === 'ALL' ? notifications.length : unreadCount;
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 14px',
                  borderRadius: 999,
                  border: 'none',
                  background: isActive ? '#0F172A' : 'transparent',
                  color: isActive ? '#fff' : '#64748B',
                  fontWeight: 800,
                  fontSize: '0.78rem',
                  cursor: 'pointer',
                  boxShadow: isActive ? '0 2px 10px rgba(15,23,42,0.14)' : 'none',
                  transition: 'all 0.15s',
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: 999, background: isActive ? '#38BDF8' : f === 'UNREAD' ? '#F59E0B' : '#94A3B8' }} />
                {f === 'ALL' ? 'All' : 'Unread'}
                <span style={{ padding: '2px 7px', borderRadius: 999, background: isActive ? 'rgba(255,255,255,0.14)' : '#fff', border: `1px solid ${isActive ? 'rgba(255,255,255,0.18)' : '#E2E8F0'}`, fontSize: '0.68rem', fontWeight: 800, minWidth: 22, textAlign: 'center' as const }}>{count}</span>
              </button>
            );
          })}
        </div>
        <span style={{ fontSize: '0.72rem', color: '#94A3B8', fontWeight: 600, marginLeft: 2, display: filtered.length ? 'inline' : 'none' }}>{filtered.length} notification{filtered.length !== 1 ? 's' : ''} • {filter === 'UNREAD' ? 'tap Dismiss to clear' : 'newest first'}</span>
        {filter === 'UNREAD' && unreadCount > 0 && (
          <span style={{ marginLeft: 'auto', fontSize: '0.68rem', fontWeight: 700, color: '#D97706', background: '#FFFBEB', border: '1px solid #FDE68A', padding: '4px 8px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: '#F59E0B', animation: 'pulse 1.4s infinite' }} />Live
          </span>
        )}
      </div>

      {/* ── List ── */}
      {filtered.length === 0 ? (
        <div className="data-card" style={{ padding: '42px 24px', textAlign: 'center', borderTop: '3px solid #E2E8F0' }}>
          <div style={{ width: 64, height: 64, borderRadius: 18, background: '#F8FAFC', border: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px', color: '#94A3B8' }}>
            <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </div>
          <div style={{ fontWeight: 800, fontSize: '0.95rem', color: '#0F172A' }}>{filter === 'UNREAD' ? 'You’re all caught up 🎉' : 'No notifications yet'}</div>
          <div style={{ fontSize: '0.82rem', color: '#64748B', marginTop: 4, maxWidth: 420, marginLeft: 'auto', marginRight: 'auto' }}>{filter === 'UNREAD' ? 'Every new sign-up and alert will appear here. Dismiss them as you go.' : 'When customers sign up or the system has news, it will show up here.'}</div>
          {filter === 'UNREAD' && notifications.length > 0 && (
            <button onClick={() => setFilter('ALL')} style={{ marginTop: 16, padding: '8px 16px', borderRadius: 999, border: '1.5px solid #E2E8F0', background: '#fff', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' }}>View all</button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {groups.map(g => (
            <div key={g.label} style={{ display: 'flex', flexDirection: 'column', gap: 10, animation: 'slideIn 0.28s ease both' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 2px' }}>
                <span style={{ fontSize: '0.68rem', fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: '#0F172A', background: '#F8FAFC', border: '1px solid #E2E8F0', padding: '4px 10px', borderRadius: 999 }}>{g.label}</span>
                <span style={{ height: 1, flex: 1, background: '#F1F5F9', borderRadius: 999 }} />
                <span style={{ fontSize: '0.68rem', color: '#94A3B8', fontWeight: 700 }}>{g.items.length} item{g.items.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="data-card" style={{ overflow: 'hidden', padding: 0 }}>
                {g.items.map((n, i) => {
                  const tm = typeMeta[n.type] ?? typeMeta.INFO;
                  const isDismissing = dismissing === n.id;
                  return (
                    <div
                      key={n.id}
                      onClick={() => n.link && router.push(n.link)}
                      style={{
                        display: 'flex',
                        gap: 14,
                        alignItems: 'flex-start',
                        padding: '16px 18px',
                        borderBottom: i < g.items.length - 1 ? '1px solid #F1F5F9' : 'none',
                        background: n.read ? '#FFFFFF' : '#FFFBEB',
                        borderLeft: n.read ? '3px solid transparent' : `3px solid ${tm.fg}`,
                        cursor: n.link ? 'pointer' : 'default',
                        opacity: isDismissing ? 0.55 : 1,
                        transform: isDismissing ? 'scale(0.99)' : 'none',
                        transition: 'all 0.22s ease',
                        position: 'relative',
                      }}
                      onMouseEnter={e => { if (!n.read) (e.currentTarget as HTMLDivElement).style.background = '#FFFBEB'; }}
                      onMouseLeave={e => { if (!n.read) (e.currentTarget as HTMLDivElement).style.background = '#FFFBEB'; }}
                    >
                      {/* type icon */}
                      <div style={{ width: 36, height: 36, borderRadius: 12, background: tm.bg, border: `1px solid ${tm.border}`, color: tm.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1, boxShadow: '0 2px 8px rgba(15,23,42,0.04)' }}>
                        <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" viewBox="0 0 24 24"><path d={tm.icon} /><circle cx="12" cy="12" r="10" strokeOpacity="0.0" /></svg>
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                          <span style={{ fontWeight: 800, fontSize: '0.88rem', color: '#0F172A', lineHeight: 1.1, wordBreak: 'break-word' }}>{n.title}</span>
                          <span style={{ fontSize: '0.62rem', fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', padding: '3px 8px', borderRadius: 999, background: tm.bg, color: tm.fg, border: `1px solid ${tm.border}` }}>{tm.label}</span>
                          {!n.read && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 999, background: '#0F172A', color: '#fff', fontSize: '0.62rem', fontWeight: 800, letterSpacing: 0.3 }}><span style={{ width: 6, height: 6, borderRadius: 999, background: '#38BDF8', animation: 'pulse 1.4s infinite' }} />New</span>}
                          {n.link && <span style={{ fontSize: '0.68rem', color: '#2563EB', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>View →</span>}
                        </div>
                        <p style={{ margin: 0, color: '#475569', fontSize: '0.82rem', lineHeight: 1.5, wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{n.message}</p>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.68rem', color: '#94A3B8', fontWeight: 600, background: '#F8FAFC', border: '1px solid #F1F5F9', padding: '4px 8px', borderRadius: 999 }}>
                            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                            {new Date(n.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            <span style={{ width: 3, height: 3, borderRadius: 999, background: '#CBD5E1' }} />
                            {timeAgo(n.createdAt)}
                          </span>
                          {n.read && <span style={{ fontSize: '0.68rem', color: '#94A3B8', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}><svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg> Read</span>}
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginTop: 2 }}>
                        {!n.read ? (
                          <button
                            onClick={e => { e.stopPropagation(); markAsRead(n.id); }}
                            style={{
                              padding: '7px 12px',
                              borderRadius: 999,
                              border: '1.5px solid #E2E8F0',
                              background: '#fff',
                              color: '#334155',
                              fontWeight: 700,
                              fontSize: '0.74rem',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                              boxShadow: '0 1px 6px rgba(15,23,42,0.04)',
                              transition: 'all 0.15s',
                              whiteSpace: 'nowrap',
                            }}
                            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#F8FAFC'; (e.currentTarget as HTMLButtonElement).style.borderColor = '#CBD5E1'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#fff'; (e.currentTarget as HTMLButtonElement).style.borderColor = '#E2E8F0'; }}
                          >
                            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                            Dismiss
                          </button>
                        ) : (
                          <span style={{ width: 32, height: 32, borderRadius: 999, background: '#F1F5F9', border: '1px solid #E2E8F0', color: '#94A3B8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
