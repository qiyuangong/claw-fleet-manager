import { useState } from 'react';
import { revealToken } from '../../api/fleet';
import type { FleetInstance } from '../../types';

interface Props {
  instance: FleetInstance;
}

export function ControlUiTab({ instance }: Props) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const host = window.location.hostname || 'localhost';
  const baseUrl = `http://${host}:${instance.port}/`;

  const buildLaunchUrl = async (): Promise<string> => {
    const { token } = await revealToken(instance.id);
    return `${baseUrl}#token=${token}`;
  };

  const handleOpen = async () => {
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const url = await buildLaunchUrl();
      window.open(url, '_blank', 'noreferrer');
      setStatus('Opened Control UI in a new tab.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to open Control UI');
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
      try {
        await navigator.clipboard.writeText(url);
        setStatus('Launch URL copied to clipboard.');
      } catch {
        window.prompt('Copy launch URL:', url);
        setStatus('Launch URL prepared. Copy it from the prompt.');
      }
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
          <h3 style={{ margin: 0 }}>Control UI</h3>
          <p className="muted">Open the gateway Control UI with a one-time token.</p>
        </div>
      </div>

      <div className="section-grid">
        <div className="metric-card">
          <p className="metric-label">Gateway URL</p>
          <p className="metric-value mono">{baseUrl}</p>
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
