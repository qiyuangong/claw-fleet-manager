function basicAuthHeaders(): HeadersInit {
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
