'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore, api, startIdleSessionTimeout } from '@isp/shared';

const queryClient = new QueryClient();

function AuthInit({ children }: { children: React.ReactNode }) {
  const { accessToken, user, setUser, setAccessToken } = useAuthStore();
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const isAuthPath = pathname.startsWith('/login');

  // Idle session guard: no pointer/keyboard activity for the configured window
  // → revoke the refresh-token family server-side and bounce to /login.
  useEffect(() => {
    if (!accessToken) return;
    return startIdleSessionTimeout(() => {
      useAuthStore.getState().logout();
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.href = '/login?reason=idle';
      }
    });
  }, [accessToken]);

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    if (stored) setAccessToken(stored);
    setReady(true);
  }, [setAccessToken]);

  useEffect(() => {
    if (!ready || !accessToken) return;
    api<{ id: string; email: string; isSuperAdmin?: boolean; phone?: string; twoFaEnabled: boolean }>('/auth/me')
      .then(setUser)
      .catch(() => useAuthStore.getState().logout());
  }, [ready, accessToken, setUser]);

  useEffect(() => {
    if (ready && !accessToken && !isAuthPath) router.replace('/login');
  }, [ready, accessToken, isAuthPath, router]);

  if (isAuthPath) return <>{children}</>;
  if (!ready || !accessToken || !user) return null;

  return <>{children}</>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthInit>{children}</AuthInit>
    </QueryClientProvider>
  );
}
