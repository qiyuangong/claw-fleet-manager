const AUTH_DISABLED_KEY = 'fleet_manager_auth_disabled';

function isAuthDisabled(): boolean {
  if (typeof window === 'undefined') return false;
  return window.sessionStorage.getItem(AUTH_DISABLED_KEY) === '1';
}

export function logoutApiClient(): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(AUTH_DISABLED_KEY, '1');
}

export function enableApiClientAuth(): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(AUTH_DISABLED_KEY);
}

function basicAuthHeaders(): HeadersInit {
  if (isAuthDisabled()) {
    // Force unauthorized even if the browser has cached Basic Auth credentials.
    return { Authorization: `Basic ${btoa('logged_out:logged_out')}` };
  }
  const username = import.meta.env.VITE_BASIC_AUTH_USER;
  const password = import.meta.env.VITE_BASIC_AUTH_PASSWORD;
  if (!username || !password) return {};
  const encoded = btoa(`${username}:${password}`);
  return { Authorization: `Basic ${encoded}` };
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
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error ?? `Request failed: ${response.status}`);
  }

  return response.json();
}
