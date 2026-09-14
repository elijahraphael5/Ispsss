'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { NocApi } from './api';

const NocApiContext = createContext<NocApi | null>(null);

export function NocApiProvider({ client, children }: { client: NocApi; children: ReactNode }) {
  return <NocApiContext.Provider value={client}>{children}</NocApiContext.Provider>;
}

export function useNocApi(): NocApi {
  const client = useContext(NocApiContext);
  if (!client) throw new Error('useNocApi must be used within a NocApiProvider');
  return client;
}
