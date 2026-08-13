'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@isp/shared';

const navItems = [
  { label: 'Dashboard', href: '/', icon: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>' },
  { label: 'Analytics', href: '/analytics', icon: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg>' },
  { label: 'My Internet', href: '/internet', icon: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>' },
  { label: 'Subscription', href: '/subscription', icon: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>' },
  { label: 'Billing', href: '/billing', icon: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>' },
  { label: 'Payments', href: '/payments', icon: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>' },
  { label: 'Support', href: '/support', icon: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' },
  { label: 'Account', href: '/account', icon: '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' },
];

const authPaths = ['/login', '/login/2fa'];

export default function CustomerSidebar({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, accessToken } = useAuthStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !accessToken || authPaths.includes(pathname)) return <>{children}</>;

  return (
    <div style={{ width: '100%', height: '100vh', backgroundColor: 'var(--bg-dark)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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
            {navItems.map((item) => {
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
