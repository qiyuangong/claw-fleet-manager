import { useState } from 'react';
import { revealToken } from '../../api/fleet';
import type { FleetInstance } from '../../types';

interface Props {
  instance: FleetInstance;
}

function fleetAuth(): string {
  const user = import.meta.env.VITE_BASIC_AUTH_USER;
  const pass = import.meta.env.VITE_BASIC_AUTH_PASSWORD;
  return user && pass ? btoa(`${user}:${pass}`) : '';
}

async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // fall through to execCommand
  }
  try {
    const el = document.createElement('textarea');
    el.value = value;
    el.setAttribute('readonly', '');
    el.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(el);
    el.focus();
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

export function ControlUiTab({ instance }: Props) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Build the proxy launch URL:
  //   ?auth=      — fleet manager Basic Auth (initial HTML + cookie for sub-resources)
  //   ?gatewayUrl — tells Control UI to connect WS through the proxy (auth embedded)
  //   #token=     — gateway token read natively by Control UI from URL hash
  async function buildLaunchUrl(): Promise<string> {
    const { token: gatewayToken } = await revealToken(instance.id);
    const auth = fleetAuth();
    const origin = window.location.origin;
    const wsOrigin = origin.replace(/^http/, 'ws');

    // The WS gateway URL the Control UI should connect to — includes fleet auth.
    const wsProxyUrl = auth
      ? `${wsOrigin}/proxy/${instance.id}?auth=${auth}`
      : `${wsOrigin}/proxy/${instance.id}`;

    const url = new URL(`${origin}/proxy/${instance.id}/`);
    if (auth) url.searchParams.set('auth', auth);
    url.searchParams.set('gatewayUrl', wsProxyUrl);
    url.hash = `token=${gatewayToken}`;
    return url.toString();
  }

  const handleOpen = async () => {
    const popup = window.open('', '_blank', 'noopener,noreferrer');
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const url = await buildLaunchUrl();
      if (popup) popup.location.href = url;
      setStatus('Opened Control UI in a new tab.');
    } catch (cause) {
      popup?.close();
      setError(cause instanceof Error ? cause.message : 'Failed to build launch URL');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const url = await buildLaunchUrl();
      const copied = await copyText(url);
      if (!copied) {
        window.prompt('Copy launch URL:', url);
        setStatus('Launch URL prepared. Copy it from the prompt.');
        return;
      }
      setStatus('Launch URL copied to clipboard.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to build launch URL');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel-card">
      <div className="panel-header">
        <div>
          <h3 style={{ margin: 0 }}>Control UI Launch</h3>
          <p className="muted">
            Opens the gateway Control UI through the fleet proxy with auto-auth.
          </p>
        </div>
      </div>

      <div className="section-grid">
        <div className="metric-card">
          <p className="metric-label">Proxy URL</p>
          <p className="metric-value mono">{`/proxy/${instance.id}/`}</p>
        </div>
        <div className="metric-card">
          <p className="metric-label">Instance</p>
          <p className="metric-value mono">{instance.id}</p>
        </div>
      </div>

      <div className="action-row" style={{ marginTop: '1rem' }}>
        <button className="primary-button" onClick={() => void handleOpen()} disabled={loading}>
          {loading ? 'Preparing...' : 'Open Control UI'}
        </button>
        <button className="secondary-button" onClick={() => void handleCopy()} disabled={loading}>
          Copy launch URL
        </button>
      </div>

      {status ? <p className="token-status success-text">{status}</p> : null}
      {error ? <p className="token-status error-text">{error}</p> : null}
    </section>
  );
}
