'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@isp/shared';

interface NavItem {
  label: string;
  href: string;
  icon: string;
  module: string;
  modules?: string[];
  superAdminOnly?: boolean;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/', module: 'Dashboard', icon: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>' },
  { label: 'User Control', href: '/users', module: 'User Control', icon: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>' },
  { label: 'Customer', href: '/users/manage', module: 'Customer', icon: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>' },
  { label: 'KYC', href: '/kyc', module: 'Customer', icon: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4"/><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z"/></svg>' },

  { label: 'Package', href: '/subscriptions/plans', module: 'Package', icon: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>' },
  { label: 'Billing & Payments', href: '/billing', module: 'Billing', modules: ['Billing', 'Payments'], icon: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>' },
  { label: 'Support', href: '/tickets', module: 'Support', icon: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' },
  { label: 'NOC', href: '/noc', module: 'NOC', icon: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' },
  { label: 'Coverage Map', href: '/coverage', module: 'Network', icon: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>' },
  { label: 'Notifications', href: '/notifications', module: 'Notifications', icon: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>' },
  { label: 'Audit Logs', href: '/audit-logs', module: 'Audit Logs', icon: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/></svg>' },
  { label: 'Owner', href: '/owner', module: 'Owner', superAdminOnly: true, icon: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>' },
  { label: 'Settings', href: '/settings', module: 'Settings', icon: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>' },
];

const authPaths = ['/login', '/login/2fa'];

export default function Sidebar({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, accessToken, setAccessToken } = useAuthStore();
  const [mounted, setMounted] = useState(false);
  const [impersonatedTenant, setImpersonatedTenant] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
    const name = localStorage.getItem('impersonatingTenantName');
    setImpersonatedTenant(name);
  }, []);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  if (!mounted || !accessToken || authPaths.includes(pathname)) return <>{children}</>;

  const permMap = new Map<string, { canView: boolean }>();
  const isSuperAdmin = user?.isSuperAdmin === true;
  if (!isSuperAdmin && user?.customRole?.permissions) {
    for (const p of user.customRole.permissions) {
      permMap.set(p.module, { canView: p.canView });
    }
  }

  const visibleItems = isSuperAdmin
    ? navItems
    : navItems.filter((item) => {
        if (item.superAdminOnly) return false;
        const modules = item.modules ?? [item.module];
        const entries = modules.map(m => permMap.get(m)).filter(Boolean) as { canView: boolean }[];
        return entries.length === 0 ? true : entries.some(p => p.canView);
      });

  async function handleExitImpersonation() {
    try {
      const res = await fetch('/api/v1/owner/unimpersonate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (data.accessToken) {
        setAccessToken(data.accessToken);
        localStorage.removeItem('impersonatingTenantName');
        setImpersonatedTenant(null);
        router.push('/');
      }
    } catch {
      logout();
      router.push('/login');
    }
  }

  return (
    <div className="app-shell">
      {impersonatedTenant && (
        <div className="app-impersonation">
          <span>Viewing as <strong>{impersonatedTenant}</strong></span>
          <button onClick={handleExitImpersonation} style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', border: 'none', padding: '4px 16px', borderRadius: 20, cursor: 'pointer', fontSize: '0.85rem' }}>
            Exit
          </button>
        </div>
      )}
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
            {visibleItems.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px',
                      color: active ? 'var(--text-dark)' : 'var(--text-light-muted)',
                      textDecoration: 'none', fontWeight: active ? 600 : 500, fontSize: '0.95rem',
                      borderRadius: 20, backgroundColor: active ? '#fff' : 'transparent',
                    }}
                    dangerouslySetInnerHTML={{ __html: item.icon + '<span>' + item.label + '</span>' }}
                  />
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
