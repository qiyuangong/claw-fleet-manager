const upstreamHost = process.env.OPENCLAW_UPSTREAM_HOST?.trim() || '127.0.0.1';

export function getOpenClawUpstreamHost(): string {
  return upstreamHost;
}

export function getOpenClawHttpUrl(port: number, path = ''): string {
  return `http://${upstreamHost}:${port}${path}`;
}

export function getOpenClawWsUrl(port: number, path = ''): string {
  return `ws://${upstreamHost}:${port}${path}`;
}

export function getOpenClawHttpOrigin(port: number): string {
  return `http://localhost:${port}`;
}
