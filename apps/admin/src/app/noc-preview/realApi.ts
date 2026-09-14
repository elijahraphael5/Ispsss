import { api } from '@isp/shared';
import { Nas, NasInput, NasTestResult, NocApi, Profile, ProfileInput, PppoeUser, PppoeUserInput } from './api';

const USERS_NOT_IMPLEMENTED = 'PPPoE user management endpoints are not implemented in radius-service yet';

export const realApi: NocApi = {
  listNas: () => api<Nas[]>('/radius/nas'),

  createNas: (input: NasInput) =>
    api<Nas>('/radius/nas', { method: 'POST', body: JSON.stringify(input) }),

  updateNas: (id: number, input: NasInput) =>
    api<Nas>(`/radius/nas/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),

  deleteNas: async (id: number) => {
    await api(`/radius/nas/${id}`, { method: 'DELETE' });
  },

  testNas: (id: number) =>
    api<NasTestResult>(`/radius/nas/${id}/test`, { method: 'POST', body: '{}' }),

  revealNasSecret: async () => {
    throw new Error('NAS secrets are write-only — the API never returns the stored value');
  },

  listProfiles: () => api<Profile[]>('/radius/profiles'),

  createProfile: (input: ProfileInput) =>
    api<Profile>('/radius/profiles', { method: 'POST', body: JSON.stringify(input) }),

  updateProfile: (name: string, input: ProfileInput) =>
    api<Profile & { removedStaticIps?: number }>(`/radius/profiles/${encodeURIComponent(name)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  deleteProfile: async (name: string, force = false) => {
    await api(`/radius/profiles/${encodeURIComponent(name)}${force ? '?force=true' : ''}`, { method: 'DELETE' });
  },

  listUsers: async () => {
    throw new Error(USERS_NOT_IMPLEMENTED);
  },

  createUser: async () => {
    throw new Error(USERS_NOT_IMPLEMENTED);
  },

  updateUser: async () => {
    throw new Error(USERS_NOT_IMPLEMENTED);
  },

  deleteUser: async () => {
    throw new Error(USERS_NOT_IMPLEMENTED);
  },

  checkStaticIp: async () => {
    throw new Error(USERS_NOT_IMPLEMENTED);
  },
};
