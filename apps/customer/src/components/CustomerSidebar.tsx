'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@isp/shared';
import { useInstallationGate } from './InstallationGate';

const navItems: Array<{ label: string; href: string; icon: React.ReactNode }> = [
  { label: 'Dashboard', href: '/', icon: <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg> },
  { label: 'Subscription', href: '/subscription', icon: <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg> },
  { label: 'Coverage', href: '/coverage', icon: <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> },
  { label: 'Billing & Payments', href: '/billing', icon: <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg> },
  { label: 'Support', href: '/support', icon: <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> },
  { label: 'Account', href: '/account', icon: <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> },
];

const authPaths = ['/login', '/login/2fa'];

export default function CustomerSidebar({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, accessToken } = useAuthStore();
  const { locked } = useInstallationGate();
  const [mounted, setMounted] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  if (!mounted || !accessToken || authPaths.includes(pathname)) return <>{children}</>;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-left">
          <button className="app-menu-btn" aria-label="Open navigation" onClick={() => setNavOpen(true)}>
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
          <div className="app-logo">
            <img src="/logo.png" alt="Hikonnect" style={{ height: 30, width: 'auto' }} />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span className="app-header-user" style={{ color: 'var(--text-light)', fontSize: '0.9rem' }}>{user?.email}</span>
          <button onClick={() => { logout(); router.push('/login'); }} style={{ backgroundColor: 'var(--accent-orange)', color: '#fff', border: 'none', padding: '8px 18px', borderRadius: 20, fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            Logout
          </button>
        </div>
      </header>
      <div className="app-body">
        <div className={`app-nav-overlay${navOpen ? ' open' : ''}`} onClick={() => setNavOpen(false)} />
        <nav className={`app-nav${navOpen ? ' open' : ''}`}>
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {navItems.map((item) => {
              const active = pathname === item.href;
              const disabled = locked && item.href !== '/billing' && item.href !== '/coverage';
              return (
                <li key={item.href}>
                  {disabled ? (
                    <span
                      title="Pay your installation fee to unlock this section"
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px',
                        color: 'var(--text-light-muted)', opacity: 0.4, cursor: 'not-allowed',
                        fontWeight: 500, fontSize: '0.95rem', borderRadius: 20,
                      }}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </span>
                  ) : (
                    <Link
                      href={item.href}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px',
                        color: active ? 'var(--text-dark)' : 'var(--text-light-muted)',
                        textDecoration: 'none', fontWeight: active ? 600 : 500, fontSize: '0.95rem',
                        borderRadius: 20, backgroundColor: active ? '#fff' : 'transparent',
                      }}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>
        <main className="app-main">
          {children}
        </main>
      </div>
    </div>
  );
}
