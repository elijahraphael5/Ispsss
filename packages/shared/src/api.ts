const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

interface FetchOptions extends RequestInit {
  skipAuth?: boolean;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
        if (!res.ok) return null;
        const data = await res.json();
        localStorage.setItem('accessToken', data.accessToken);
        return data.accessToken;
      } catch {
        return null;
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
}

function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('accessToken');
}

export async function api<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const { skipAuth, ...fetchOpts } = options;
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(fetchOpts.headers as Record<string, string>) };

  if (!skipAuth) {
    const token = getAccessToken();
    if (token) headers['Authorization'] = token;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...fetchOpts, headers, credentials: 'include' });

  if (res.status === 401 && !skipAuth) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      headers['Authorization'] = newToken;
      const retryRes = await fetch(`${API_BASE}${path}`, { ...fetchOpts, headers, credentials: 'include' });
      if (!retryRes.ok) { let m: string; try { const j = await retryRes.json(); m = j.message?.message || j.message || retryRes.statusText; } catch { m = await retryRes.text(); } throw new ApiError(retryRes.status, m); }
      return retryRes.json();
    }
    localStorage.removeItem('accessToken');
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
    throw new ApiError(401, 'Session expired');
  }

  if (!res.ok) {
    let msg: string;
    try { const json = await res.json(); msg = json.message?.message || json.message || res.statusText; } catch { msg = await res.text(); }
    throw new ApiError(res.status, msg);
  }
  return res.json();
}

export async function apiUpload<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  const headers: Record<string, string> = {};
  const token = getAccessToken();
  if (token) headers['Authorization'] = token;
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', body: form, headers });
  if (!res.ok) {
    let msg: string;
    try { const json = await res.json(); msg = json.message?.message || json.message || res.statusText; } catch { msg = await res.text(); }
    throw new ApiError(res.status, msg);
  }
  return res.json();
}

export async function apiFileUrl(uploadId: string): Promise<string> {
  const headers: Record<string, string> = {};
  const token = getAccessToken();
  if (token) headers['Authorization'] = token;
  const res = await fetch(`${API_BASE}/chat/attachments/${uploadId}`, { headers });
  if (!res.ok) throw new ApiError(res.status, 'Failed to fetch file');
  return URL.createObjectURL(await res.blob());
}
