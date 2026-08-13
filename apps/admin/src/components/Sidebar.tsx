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
  superAdminOnly?: boolean;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/', module: 'Dashboard', icon: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>' },
  { label: 'User Control', href: '/users', module: 'User Control', icon: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>' },
  { label: 'Customer', href: '/users/manage', module: 'Customer', icon: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>' },

  { label: 'Package', href: '/subscriptions/plans', module: 'Package', icon: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>' },
  { label: 'Billing', href: '/billing', module: 'Billing', icon: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>' },
  { label: 'Payments', href: '/payments', module: 'Payments', icon: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>' },
  { label: 'Support', href: '/tickets', module: 'Support', icon: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' },
  { label: 'NOC', href: '/noc', module: 'NOC', icon: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' },
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

  useEffect(() => {
    setMounted(true);
    const name = localStorage.getItem('impersonatingTenantName');
    setImpersonatedTenant(name);
  }, []);

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
        const perm = permMap.get(item.module);
        return perm ? perm.canView : true;
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
    <div style={{ width: '100%', height: '100vh', backgroundColor: 'var(--bg-dark)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {impersonatedTenant && (
        <div style={{ backgroundColor: '#dc2626', color: '#fff', padding: '8px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem', flexShrink: 0 }}>
          <span>Viewing as <strong>{impersonatedTenant}</strong></span>
          <button onClick={handleExitImpersonation} style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', border: 'none', padding: '4px 16px', borderRadius: 20, cursor: 'pointer', fontSize: '0.85rem' }}>
            Exit
          </button>
        </div>
      )}
      <header style={{ backgroundColor: 'var(--bg-dark)', padding: '16px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <div style={{ backgroundColor: '#202226', padding: '8px 18px', borderRadius: 20, display: 'flex', alignItems: 'center' }}>
          <img src="/logo.png" alt="Hikonnect" style={{ height: 30, width: 'auto' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ color: 'var(--text-light)', fontSize: '0.9rem' }}>{user?.email}</span>
          <button onClick={() => { logout(); router.push('/login'); }} style={{ backgroundColor: 'var(--accent-orange)', color: '#fff', border: 'none', padding: '8px 18px', borderRadius: 20, fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }}>
            Logout
          </button>
        </div>
      </header>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <nav style={{ width: 240, backgroundColor: 'var(--bg-dark)', padding: '10px 20px 24px 20px', flexShrink: 0, overflow: 'hidden' }}>
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
        <main style={{ flex: 1, backgroundColor: 'var(--bg-main)', borderTopLeftRadius: 32, padding: 32, display: 'flex', flexDirection: 'column', gap: 24, minWidth: 0, overflowY: 'auto' }}>
          {children}
        </main>
      </div>
    </div>
  );
}
