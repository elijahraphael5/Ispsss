import { create } from 'zustand';

export interface PermissionInfo {
  module: string;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export interface CustomRoleInfo {
  id: string;
  name: string;
  permissions: PermissionInfo[];
}

export interface User {
  id: string;
  email: string;
  name?: string | null;
  isSuperAdmin?: boolean;
  phone?: string;
  twoFaEnabled: boolean;
  customRoleId?: string | null;
  customRole?: CustomRoleInfo | null;
}

interface AuthState {
  user: User | null;
  setUser: (user: User | null) => void;
  accessToken: string | null;
  setAccessToken: (token: string | null) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  setUser: (user) => set({ user }),
  setAccessToken: (token) => {
    if (typeof window !== 'undefined') {
      if (token) localStorage.setItem('accessToken', token);
      else localStorage.removeItem('accessToken');
    }
    set({ accessToken: token });
  },
  logout: () => {
    // Revoke the refresh-token family server-side, then wipe every local trace
    // of the session (access token, impersonation context) before redirecting.
    fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
    if (typeof window !== 'undefined') {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('impersonatingTenantName');
    }
    set({ user: null, accessToken: null });
  },
}));
