export type NetworkStatus = 'reachable' | 'unreachable' | 'no-response';
export type AuthStatus = 'accept' | 'reject' | 'no-response' | 'error';

export interface NasTestResult {
  nasId: number;
  nasname: string;
  reachable: boolean;
  networkStatus: NetworkStatus;
  latencyMs: number | null;
  accountingReachable: boolean;
  authStatus: AuthStatus;
  authLatencyMs: number | null;
  radiusServer: string;
  checkedAt: string;
  message: string;
}

export interface Nas {
  id: number;
  nasname: string;
  shortname: string | null;
  type: string | null;
  ports: number | null;
  description: string | null;
  hasSecret: boolean;
  secretMasked: string;
  lastTest?: NasTestResult;
}

export interface NasInput {
  nasname: string;
  shortname?: string;
  type?: string;
  ports?: number;
  secret?: string;
  description?: string;
}

export interface Profile {
  name: string;
  rateLimit: string | null;
  sessionTimeout: number | null;
  idleTimeout: number | null;
  framedPool: string | null;
  staticIpMode: boolean;
  users: number;
}

export interface ProfileInput {
  name?: string;
  rateLimit?: string;
  sessionTimeout?: number;
  idleTimeout?: number;
  framedPool?: string;
  staticIpMode?: boolean;
}

export type PppoeUserStatus = 'active' | 'suspended';

export interface PppoeUser {
  id: string;
  username: string;
  profile: string | null;
  framedIpAddress: string | null;
  status: PppoeUserStatus;
}

export interface PppoeUserInput {
  username: string;
  profile: string | null;
  framedIpAddress?: string | null;
  status: PppoeUserStatus;
}

export interface NocApi {
  listNas(): Promise<Nas[]>;
  createNas(input: NasInput): Promise<Nas>;
  updateNas(id: number, input: NasInput): Promise<Nas>;
  deleteNas(id: number): Promise<void>;
  testNas(id: number): Promise<NasTestResult>;
  revealNasSecret(id: number): Promise<{ secret: string }>;

  listProfiles(): Promise<Profile[]>;
  createProfile(input: ProfileInput): Promise<Profile>;
  updateProfile(name: string, input: ProfileInput): Promise<Profile & { removedStaticIps?: number }>;
  deleteProfile(name: string, force?: boolean): Promise<void>;

  listUsers(): Promise<PppoeUser[]>;
  createUser(input: PppoeUserInput): Promise<PppoeUser>;
  updateUser(id: string, input: PppoeUserInput): Promise<PppoeUser>;
  deleteUser(id: string): Promise<void>;
  checkStaticIp(ip: string, excludeUserId?: string): Promise<{ available: boolean; usedBy?: string }>;
}

export function validateStaticIp(ip: string): string | null {
  const value = String(ip ?? '').trim();
  const parts = value.split('.');
  if (parts.length !== 4 || parts[0] !== '192') return 'Static IP must be in the 192.x.x.x range';
  for (const part of parts) {
    const n = Number(part);
    if (!/^\d{1,3}$/.test(part) || n < 0 || n > 255) return 'Static IP is not a valid IPv4 address';
  }
  return null;
}
