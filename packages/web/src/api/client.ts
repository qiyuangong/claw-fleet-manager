const AUTH_DISABLED_KEY = 'fleet_manager_auth_disabled';
const AUTH_SESSION_KEY = 'fleet_manager_session_auth';
const AUTH_MODE_KEY = 'fleet_manager_auth_mode';

type AuthMode = 'default' | 'manual';

function getAuthMode(): AuthMode {
  if (typeof window === 'undefined') return 'default';
  return window.sessionStorage.getItem(AUTH_MODE_KEY) === 'manual' ? 'manual' : 'default';
}

function isAuthDisabled(): boolean {
  if (typeof window === 'undefined') return false;
  return window.sessionStorage.getItem(AUTH_DISABLED_KEY) === '1';
}

export function logoutApiClient(): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(AUTH_MODE_KEY, 'manual');
  window.sessionStorage.setItem(AUTH_DISABLED_KEY, '1');
}

export function isApiClientLoggedOut(): boolean {
  if (typeof window === 'undefined') return false;
  if (isAuthDisabled()) return true;
  if (getAuthMode() !== 'manual') return false;
  return !window.sessionStorage.getItem(AUTH_SESSION_KEY);
}

export function enableApiClientAuth(): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(AUTH_MODE_KEY, 'default');
  window.sessionStorage.removeItem(AUTH_DISABLED_KEY);
}

export function setApiClientSessionAuth(username: string, password: string): void {
  if (typeof window === 'undefined') return;
  const encoded = btoa(`${username}:${password}`);
  window.sessionStorage.setItem(AUTH_MODE_KEY, 'manual');
  window.sessionStorage.setItem(AUTH_SESSION_KEY, encoded);
  window.sessionStorage.removeItem(AUTH_DISABLED_KEY);
}

export function clearApiClientSessionAuth(): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(AUTH_SESSION_KEY);
}

function getActiveAuthToken(): string | null {
  if (isAuthDisabled()) {
    return btoa('logged_out:logged_out');
  }
  if (typeof window !== 'undefined') {
    const sessionAuth = window.sessionStorage.getItem(AUTH_SESSION_KEY);
    if (sessionAuth) return sessionAuth;
    if (getAuthMode() === 'manual') return btoa('logged_out:logged_out');
  }
  const username = import.meta.env.VITE_BASIC_AUTH_USER;
  const password = import.meta.env.VITE_BASIC_AUTH_PASSWORD;
  if (!username || !password) return null;
  return btoa(`${username}:${password}`);
}

export function getApiClientAuthToken(): string | null {
  return getActiveAuthToken();
}

function basicAuthHeaders(): HeadersInit {
  const token = getActiveAuthToken();
  if (!token) return {};
  return { Authorization: `Basic ${token}` };
}

export async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...opts,
    headers: {
      ...(opts?.body != null ? { 'Content-Type': 'application/json' } : {}),
      ...basicAuthHeaders(),
      ...opts?.headers,
    },
  });

  if (!response.ok) {
    const method = (opts?.method ?? 'GET').toUpperCase();
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error ?? `${method} ${path} failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}
