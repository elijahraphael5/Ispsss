'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api, useAuthStore } from '@isp/shared';

export interface InstallationInvoice {
  id: string;
  invoiceNumber: string;
  amountKobo: number;
  status: string;
  dueAt: string;
}

interface GateState {
  locked: boolean;
  invoice: InstallationInvoice | null;
  refresh: () => void;
}

const InstallationGateContext = createContext<GateState>({ locked: false, invoice: null, refresh: () => {} });

export const useInstallationGate = () => useContext(InstallationGateContext);

// While the installation invoice is unpaid only billing/payment routes work.
const ALLOWED_PREFIXES = ['/billing', '/payment/callback'];

export function InstallationGate({ children }: { children: React.ReactNode }) {
  const { accessToken } = useAuthStore();
  const pathname = usePathname();
  const router = useRouter();
  const [invoice, setInvoice] = useState<InstallationInvoice | null>(null);

  const refresh = useCallback(() => {
    if (!accessToken) { setInvoice(null); return; }
    api<{ installationDue: boolean; invoice: InstallationInvoice | null }>('/customer/access')
      .then(r => setInvoice(r.installationDue ? r.invoice : null))
      .catch(() => {});
  }, [accessToken]);

  useEffect(() => { refresh(); }, [refresh]);

  // Poll so the portal unlocks shortly after the customer pays.
  useEffect(() => {
    if (!accessToken) return;
    const timer = setInterval(refresh, 15000);
    return () => clearInterval(timer);
  }, [accessToken, refresh]);

  useEffect(() => {
    if (!invoice) return;
    const allowed = ALLOWED_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/'));
    if (!allowed) router.replace('/billing');
  }, [invoice, pathname, router]);

  return (
    <InstallationGateContext.Provider value={{ locked: !!invoice, invoice, refresh }}>
      {children}
    </InstallationGateContext.Provider>
  );
}
