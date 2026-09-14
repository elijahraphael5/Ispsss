import {
  AuthStatus,
  Nas,
  NasInput,
  NasTestResult,
  NetworkStatus,
  NocApi,
  Profile,
  ProfileInput,
  PppoeUser,
  PppoeUserInput,
  validateStaticIp,
} from './api';

const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const pause = (min: number, max: number) => new Promise<void>((resolve) => setTimeout(resolve, rand(min, max)));

const READ_DELAY: [number, number] = [250, 500];
const SAVE_DELAY: [number, number] = [800, 2000];
const TEST_DELAY: [number, number] = [900, 2200];
const DELETE_DELAY: [number, number] = [600, 1200];
const CHECK_DELAY: [number, number] = [300, 600];

function mask(secret: string): string {
  if (!secret) return '(not set)';
  if (secret.length <= 4) return '••••';
  return secret.slice(0, 1) + '••••' + secret.slice(-4);
}

function composeMessage(networkStatus: NetworkStatus, accountingReachable: boolean, authStatus: AuthStatus): string {
  return [
    networkStatus === 'reachable' ? 'NAS reachable' : networkStatus === 'unreachable' ? 'NAS unreachable' : 'NAS did not respond',
    accountingReachable ? 'accounting (1813) reachable' : 'accounting (1813) no reply',
    authStatus === 'accept'
      ? 'RADIUS auth accepted'
      : authStatus === 'reject'
        ? 'RADIUS server up (probe user rejected)'
        : authStatus === 'no-response'
          ? 'RADIUS server did not respond'
          : 'RADIUS auth check failed',
  ].join(' · ');
}

function makeResult(
  nasId: number,
  nasname: string,
  networkStatus: NetworkStatus,
  authStatus: AuthStatus,
  accountingReachable: boolean,
  latencyMs: number | null,
): NasTestResult {
  return {
    nasId,
    nasname,
    reachable: networkStatus === 'reachable',
    networkStatus,
    latencyMs,
    accountingReachable,
    authStatus,
    authLatencyMs: authStatus === 'accept' || authStatus === 'reject' ? rand(4, 60) : null,
    radiusServer: '127.0.0.1:1812',
    checkedAt: new Date().toISOString(),
    message: composeMessage(networkStatus, accountingReachable, authStatus),
  };
}

const seedSecrets: Record<number, string> = {
  1: 'Mtk#Core01Secret',
  2: 'CoreRouter#2024',
  3: 'IkejaEdge#991',
  4: 'Lekki#Edge77',
  5: 'Backup#Nas2024',
  6: 'LabOnly#123',
};
const nasSecrets = new Map<number, string>(Object.entries(seedSecrets).map(([id, secret]) => [Number(id), secret]));

const nasRows: Nas[] = [
  {
    id: 1,
    nasname: '192.168.88.1',
    shortname: 'mtk-core-01',
    type: 'mikrotik',
    ports: 1812,
    description: 'Core router — Ikeja POP',
    hasSecret: true,
    secretMasked: mask(seedSecrets[1]),
    lastTest: makeResult(1, '192.168.88.1', 'reachable', 'accept', true, 8),
  },
  {
    id: 2,
    nasname: '192.168.88.2',
    shortname: 'mtk-core-02',
    type: 'mikrotik',
    ports: 1812,
    description: 'Core router — standby',
    hasSecret: true,
    secretMasked: mask(seedSecrets[2]),
    lastTest: makeResult(2, '192.168.88.2', 'unreachable', 'no-response', false, null),
  },
  {
    id: 3,
    nasname: '192.168.89.10',
    shortname: 'mtk-edge-ikeja',
    type: 'mikrotik',
    ports: 1812,
    description: 'Edge NAS — Ikeja',
    hasSecret: true,
    secretMasked: mask(seedSecrets[3]),
    lastTest: makeResult(3, '192.168.89.10', 'reachable', 'accept', true, 12),
  },
  {
    id: 4,
    nasname: '192.168.89.11',
    shortname: 'mtk-edge-lekki',
    type: 'mikrotik',
    ports: 1812,
    description: 'Edge NAS — Lekki',
    hasSecret: true,
    secretMasked: mask(seedSecrets[4]),
  },
  {
    id: 5,
    nasname: '192.168.90.1',
    shortname: 'mtk-backup',
    type: 'mikrotik',
    ports: 1812,
    description: 'Failover NAS',
    hasSecret: true,
    secretMasked: mask(seedSecrets[5]),
  },
  {
    id: 6,
    nasname: '192.168.91.1',
    shortname: 'mtk-lab',
    type: 'mikrotik',
    ports: 1812,
    description: 'Lab / staging NAS',
    hasSecret: true,
    secretMasked: mask(seedSecrets[6]),
    lastTest: makeResult(6, '192.168.91.1', 'unreachable', 'no-response', false, null),
  },
];

type ProfileRecord = Omit<Profile, 'users'>;

const profileRows: ProfileRecord[] = [
  { name: 'FIBER_10M', rateLimit: '10M/10M', sessionTimeout: null, idleTimeout: null, framedPool: null, staticIpMode: false },
  { name: 'FIBER_20M', rateLimit: '20M/20M', sessionTimeout: null, idleTimeout: null, framedPool: 'pool-fiber', staticIpMode: false },
  { name: 'HOME_STATIC_10M', rateLimit: '10M/10M', sessionTimeout: 86400, idleTimeout: null, framedPool: null, staticIpMode: true },
  { name: 'RESIDENTIAL_STATIC_15M', rateLimit: '15M/15M', sessionTimeout: 86400, idleTimeout: null, framedPool: null, staticIpMode: true },
];

let userSeq = 10;
const userRows: PppoeUser[] = [
  { id: 'u1', username: 'ppp_adebayo01', profile: 'FIBER_10M', framedIpAddress: null, status: 'active' },
  { id: 'u2', username: 'ppp_chinedu02', profile: 'FIBER_10M', framedIpAddress: null, status: 'active' },
  { id: 'u3', username: 'ppp_fatima03', profile: 'FIBER_20M', framedIpAddress: null, status: 'suspended' },
  { id: 'u4', username: 'ppp_emeka04', profile: 'FIBER_20M', framedIpAddress: null, status: 'active' },
  { id: 'u5', username: 'ppp_ngozi05', profile: 'HOME_STATIC_10M', framedIpAddress: '192.168.10.11', status: 'active' },
  { id: 'u6', username: 'ppp_tunde06', profile: 'HOME_STATIC_10M', framedIpAddress: '192.168.10.12', status: 'active' },
  { id: 'u7', username: 'ppp_amaka07', profile: 'HOME_STATIC_10M', framedIpAddress: '192.168.10.13', status: 'suspended' },
  { id: 'u8', username: 'ppp_ibrahim08', profile: 'RESIDENTIAL_STATIC_15M', framedIpAddress: '192.168.10.21', status: 'active' },
  { id: 'u9', username: 'ppp_grace09', profile: 'RESIDENTIAL_STATIC_15M', framedIpAddress: '192.168.10.22', status: 'active' },
];

function userCount(profileName: string): number {
  return userRows.filter((u) => u.profile === profileName).length;
}

function toProfile(record: ProfileRecord): Profile {
  return { ...record, users: userCount(record.name) };
}

function assertUserInput(input: PppoeUserInput, existingId?: string): void {
  const username = input.username.trim();
  if (!username) throw new Error('Username is required');
  if (userRows.some((u) => u.username.toLowerCase() === username.toLowerCase() && u.id !== existingId)) {
    throw new Error(`PPPoE user ${username} already exists`);
  }
  if (input.profile) {
    const profile = profileRows.find((p) => p.name === input.profile);
    if (!profile) throw new Error(`Profile ${input.profile} not found`);
    if (profile.staticIpMode) {
      const ip = input.framedIpAddress?.trim() ?? '';
      if (!ip) throw new Error('Framed-IP-Address is required for static IP profiles');
      const err = validateStaticIp(ip);
      if (err) throw new Error(err);
      const clash = userRows.find((u) => u.framedIpAddress === ip && u.id !== existingId);
      if (clash) throw new Error(`Static IP ${ip} is already applied to PPPoE user ${clash.username}`);
    }
  }
}

export const mockApi: NocApi = {
  async listNas() {
    await pause(...READ_DELAY);
    return nasRows.map((n) => ({ ...n }));
  },

  async createNas(input: NasInput) {
    await pause(...SAVE_DELAY);
    const nasname = input.nasname.trim();
    if (!nasname) throw new Error('NAS IP / hostname is required');
    if (!input.secret || input.secret.length < 8) throw new Error('Shared secret must be at least 8 characters');
    if (nasRows.some((n) => n.nasname.toLowerCase() === nasname.toLowerCase())) {
      throw new Error(`A NAS with address ${nasname} already exists`);
    }
    const id = nasRows.reduce((max, n) => Math.max(max, n.id), 0) + 1;
    const row: Nas = {
      id,
      nasname,
      shortname: input.shortname?.trim() || null,
      type: input.type?.trim() || 'other',
      ports: input.ports ?? 1812,
      description: input.description?.trim() || null,
      hasSecret: true,
      secretMasked: mask(input.secret),
    };
    nasRows.push(row);
    nasSecrets.set(id, input.secret);
    return { ...row };
  },

  async updateNas(id: number, input: NasInput) {
    await pause(...SAVE_DELAY);
    const row = nasRows.find((n) => n.id === id);
    if (!row) throw new Error(`NAS ${id} not found`);
    const nasname = input.nasname.trim();
    if (!nasname) throw new Error('NAS IP / hostname is required');
    if (nasRows.some((n) => n.id !== id && n.nasname.toLowerCase() === nasname.toLowerCase())) {
      throw new Error(`A NAS with address ${nasname} already exists`);
    }
    if (input.secret) {
      if (input.secret.length < 8) throw new Error('Shared secret must be at least 8 characters');
      nasSecrets.set(id, input.secret);
    }
    row.nasname = nasname;
    row.shortname = input.shortname?.trim() || null;
    row.type = input.type?.trim() || 'other';
    row.ports = input.ports ?? 1812;
    row.description = input.description?.trim() || null;
    row.hasSecret = nasSecrets.has(id);
    row.secretMasked = mask(nasSecrets.get(id) ?? '');
    return { ...row };
  },

  async deleteNas(id: number) {
    await pause(...DELETE_DELAY);
    const idx = nasRows.findIndex((n) => n.id === id);
    if (idx === -1) throw new Error(`NAS ${id} not found`);
    nasRows.splice(idx, 1);
    nasSecrets.delete(id);
  },

  async testNas(id: number) {
    await pause(...TEST_DELAY);
    const row = nasRows.find((n) => n.id === id);
    if (!row) throw new Error(`NAS ${id} not found`);
    const roll = Math.random();
    let networkStatus: NetworkStatus;
    let authStatus: AuthStatus;
    let accountingReachable: boolean;
    if (roll < 0.5) {
      networkStatus = 'reachable';
      authStatus = 'accept';
      accountingReachable = Math.random() > 0.25;
    } else if (roll < 0.72) {
      networkStatus = 'reachable';
      authStatus = 'reject';
      accountingReachable = Math.random() > 0.25;
    } else if (roll < 0.9) {
      networkStatus = 'unreachable';
      authStatus = 'no-response';
      accountingReachable = false;
    } else {
      networkStatus = 'no-response';
      authStatus = 'error';
      accountingReachable = false;
    }
    const result = makeResult(id, row.nasname, networkStatus, authStatus, accountingReachable, networkStatus === 'reachable' ? rand(3, 45) : null);
    row.lastTest = result;
    return result;
  },

  async revealNasSecret(id: number) {
    await pause(600, 1200);
    const secret = nasSecrets.get(id);
    if (!secret) throw new Error('No secret stored for this NAS');
    return { secret };
  },

  async listProfiles() {
    await pause(...READ_DELAY);
    return profileRows.map(toProfile);
  },

  async createProfile(input: ProfileInput) {
    await pause(...SAVE_DELAY);
    const name = (input.name ?? '').trim();
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
      throw new Error('Profile name may only contain letters, numbers, dot, dash and underscore');
    }
    if (profileRows.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`Profile ${name} already exists`);
    }
    const record: ProfileRecord = {
      name,
      rateLimit: input.rateLimit?.trim() || null,
      sessionTimeout: input.sessionTimeout ?? null,
      idleTimeout: input.idleTimeout ?? null,
      framedPool: input.framedPool?.trim() || null,
      staticIpMode: input.staticIpMode ?? false,
    };
    profileRows.push(record);
    return toProfile(record);
  },

  async updateProfile(name: string, input: ProfileInput) {
    await pause(...SAVE_DELAY);
    const record = profileRows.find((p) => p.name === name);
    if (!record) throw new Error(`Profile ${name} not found`);
    let removedStaticIps = 0;
    if (record.staticIpMode && input.staticIpMode === false) {
      removedStaticIps = userRows.filter((u) => u.profile === name && u.framedIpAddress).length;
    }
    if (input.rateLimit !== undefined) record.rateLimit = input.rateLimit.trim() || null;
    if (input.sessionTimeout !== undefined) record.sessionTimeout = input.sessionTimeout;
    if (input.idleTimeout !== undefined) record.idleTimeout = input.idleTimeout;
    if (input.framedPool !== undefined) record.framedPool = input.framedPool.trim() || null;
    if (input.staticIpMode !== undefined) record.staticIpMode = input.staticIpMode;
    return { ...toProfile(record), removedStaticIps };
  },

  async deleteProfile(name: string, force = false) {
    await pause(...DELETE_DELAY);
    const idx = profileRows.findIndex((p) => p.name === name);
    if (idx === -1) throw new Error(`Profile ${name} not found`);
    const assigned = userCount(name);
    if (assigned > 0 && !force) throw new Error(`Profile ${name} is assigned to ${assigned} customer(s)`);
    if (force) userRows.forEach((u) => { if (u.profile === name) u.profile = null; });
    profileRows.splice(idx, 1);
  },

  async listUsers() {
    await pause(...READ_DELAY);
    return userRows.map((u) => ({ ...u }));
  },

  async createUser(input: PppoeUserInput) {
    await pause(...SAVE_DELAY);
    assertUserInput(input);
    const row: PppoeUser = {
      id: `u${userSeq++}`,
      username: input.username.trim(),
      profile: input.profile,
      framedIpAddress: input.framedIpAddress?.trim() || null,
      status: input.status,
    };
    userRows.push(row);
    return { ...row };
  },

  async updateUser(id: string, input: PppoeUserInput) {
    await pause(...SAVE_DELAY);
    const row = userRows.find((u) => u.id === id);
    if (!row) throw new Error(`PPPoE user ${id} not found`);
    assertUserInput(input, id);
    row.username = input.username.trim();
    row.profile = input.profile;
    row.framedIpAddress = input.framedIpAddress?.trim() || null;
    row.status = input.status;
    return { ...row };
  },

  async deleteUser(id: string) {
    await pause(...DELETE_DELAY);
    const idx = userRows.findIndex((u) => u.id === id);
    if (idx === -1) throw new Error(`PPPoE user ${id} not found`);
    userRows.splice(idx, 1);
  },

  async checkStaticIp(ip: string, excludeUserId?: string) {
    await pause(...CHECK_DELAY);
    const value = ip.trim();
    const clash = userRows.find((u) => u.framedIpAddress === value && u.id !== excludeUserId);
    return clash ? { available: false, usedBy: clash.username } : { available: true };
  },
};
