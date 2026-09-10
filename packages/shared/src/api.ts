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

export async function refreshAccessToken(): Promise<string | null> {
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

async function errorMessage(res: Response): Promise<string> {
  let text: string;
  try { text = await res.text(); } catch { return res.statusText; }
  try {
    const json = JSON.parse(text);
    if (json && typeof json === 'object') {
      const m = (json as any).message;
      if (typeof m === 'string') return m;
      if (typeof m?.message === 'string') return m.message;
    }
  } catch { /* not JSON */ }
  return text || res.statusText;
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
      if (!retryRes.ok) throw new ApiError(retryRes.status, await errorMessage(retryRes));
      return retryRes.json();
    }
    localStorage.removeItem('accessToken');
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
    throw new ApiError(401, 'Session expired');
  }

  if (!res.ok) {
    throw new ApiError(res.status, await errorMessage(res));
  }
  return res.json();
}

export async function apiUpload<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  const send = (token: string | null) => {
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = token;
    return fetch(`${API_BASE}${path}`, { method: 'POST', body: form, headers, credentials: 'include' });
  };

  let res = await send(getAccessToken());
  if (res.status === 401) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      res = await send(newToken);
    } else {
      localStorage.removeItem('accessToken');
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
      throw new ApiError(401, 'Session expired');
    }
  }
  if (!res.ok) {
    throw new ApiError(res.status, await errorMessage(res));
  }
  return res.json();
}

export async function apiFileUrl(uploadId: string): Promise<string> {
  const send = (token: string | null) => {
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = token;
    return fetch(`${API_BASE}/chat/attachments/${uploadId}`, { headers, credentials: 'include' });
  };

  let res = await send(getAccessToken());
  if (res.status === 401) {
    const newToken = await refreshAccessToken();
    if (newToken) res = await send(newToken);
  }
  if (!res.ok) throw new ApiError(res.status, 'Failed to fetch file');
  return URL.createObjectURL(await res.blob());
}

/** Call when a URL from apiFileUrl is no longer shown, to free the blob. */
export function revokeFileUrl(url: string): void {
  if (typeof window !== 'undefined' && url.startsWith('blob:')) URL.revokeObjectURL(url);
}
