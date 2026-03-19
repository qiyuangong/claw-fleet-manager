import { useState } from 'react';
import type { FleetInstance } from '../../types';

interface Props {
  instance: FleetInstance;
}

function buildProxyUrl(instanceId: string): string {
  const path = `/proxy/${instanceId}/`;
  const user = import.meta.env.VITE_BASIC_AUTH_USER;
  const pass = import.meta.env.VITE_BASIC_AUTH_PASSWORD;
  if (user && pass) {
    return `${path}?auth=${btoa(`${user}:${pass}`)}`;
  }
  return path;
}

async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall back to execCommand below.
  }

  try {
    const textArea = document.createElement('textarea');
    textArea.value = value;
    textArea.setAttribute('readonly', '');
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textArea);
    return ok;
  } catch {
    return false;
  }
}

export function ControlUiTab({ instance }: Props) {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const proxyPath = buildProxyUrl(instance.id);
  const fullUrl = `${window.location.origin}${proxyPath}`;

  const handleOpen = () => {
    window.open(proxyPath, '_blank', 'noreferrer');
    setStatus('Opened Control UI in a new tab.');
  };

  const handleCopy = async () => {
    setError(null);
    setStatus(null);
    try {
      const copied = await copyText(fullUrl);
      if (!copied) {
        window.prompt('Copy launch URL:', fullUrl);
        setStatus('Launch URL prepared. Copy it from the prompt.');
        return;
      }
      setStatus('Launch URL copied to clipboard.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to copy launch URL');
    }
  };

  return (
    <section className="panel-card">
      <div className="panel-header">
        <div>
          <h3 style={{ margin: 0 }}>Control UI Launch</h3>
          <p className="muted">
            Open the gateway&apos;s Control UI through the fleet manager proxy with auto-auth.
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
        <button className="primary-button" onClick={handleOpen}>
          Open Control UI
        </button>
        <button className="secondary-button" onClick={() => void handleCopy()}>
          Copy launch URL
        </button>
      </div>

      {status ? <p className="token-status success-text">{status}</p> : null}
      {error ? <p className="token-status error-text">{error}</p> : null}
    </section>
  );
}
