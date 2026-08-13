'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { useAuthStore, api } from '@isp/shared';

const queryClient = new QueryClient();

function AuthInit({ children }: { children: React.ReactNode }) {
  const { accessToken, setUser, setAccessToken } = useAuthStore();

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    if (stored && !accessToken) {
      setAccessToken(stored);
    }
  }, [accessToken, setAccessToken]);

  useEffect(() => {
    if (accessToken) {
      api('/auth/me')
        .then((u: any) => setUser(u))
        .catch(() => useAuthStore.getState().logout());
    }
  }, [accessToken, setUser]);

  return <>{children}</>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthInit>{children}</AuthInit>
    </QueryClientProvider>
  );
}
