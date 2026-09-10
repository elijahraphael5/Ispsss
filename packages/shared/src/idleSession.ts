'use client';

import { refreshAccessToken } from './api';

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'mousemove', 'touchstart', 'wheel', 'scroll'] as const;

/** Idle minutes from env (`NEXT_PUBLIC_SESSION_IDLE_MINUTES`), default 60. */
export function idleSessionMinutes(): number {
  if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_SESSION_IDLE_MINUTES) {
    const n = parseInt(process.env.NEXT_PUBLIC_SESSION_IDLE_MINUTES, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 60;
}

/** True when the stored access token is close to (or past) its `exp`. */
function tokenNearExpiry(token: string, slackMs = 2 * 60 * 1000): boolean {
  try {
    const parts = token.replace(/^Bearer\s+/i, '').split('.');
    if (parts.length !== 3) return false;
    const payload = JSON.parse(atob(parts[1]));
    if (typeof payload.exp !== 'number') return false;
    return Date.now() > payload.exp * 1000 - slackMs;
  } catch {
    return false;
  }
}

/**
 * Session idle guard. Call from `useEffect` while a session is active; returns
 * a cleanup function that must be returned from that effect.
 *
 * - Fires `onTimeout` after `minutes` of inactivity (no pointer/keyboard/scroll
 *   events), also checking elapsed time when a background tab becomes visible
 *   again (browsers throttle timers in hidden tabs).
 * - Keeps the server-side session's idle window in sync with real user
 *   activity: when activity resumes and the access token is near expiry it is
 *   silently refreshed, so an actively-working user is never dropped while a
 *   genuinely idle one is.
 */
export function startIdleSessionTimeout(onTimeout: () => void, minutes = idleSessionMinutes()): () => void {
  if (typeof window === 'undefined') return () => {};

  const limitMs = minutes * 60 * 1000;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastActivityAt = Date.now();
  let lastPingAt = 0;

  const reset = () => {
    lastActivityAt = Date.now();
    if (timer) clearTimeout(timer);
    timer = setTimeout(onTimeout, limitMs);
  };

  const onActivity = () => {
    reset();
    const now = Date.now();
    if (now - lastPingAt > 60 * 1000) {
      lastPingAt = now;
      const token = window.localStorage.getItem('accessToken');
      if (token && tokenNearExpiry(token)) {
        refreshAccessToken().catch(() => {});
      }
    }
  };

  const onVisibility = () => {
    if (document.visibilityState === 'visible') {
      if (Date.now() - lastActivityAt > limitMs) {
        onTimeout();
      } else {
        reset();
      }
    }
  };

  for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, onActivity, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);
  reset();

  return () => {
    if (timer) clearTimeout(timer);
    for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, onActivity);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
