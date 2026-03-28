import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { revealToken, getPendingDevices, approveDevice } from '../../api/fleet';
import type { FleetInstance } from '../../types';

interface Props {
  instance: FleetInstance;
}

export function ControlUiTab({ instance }: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const { data: devicesData } = useQuery({
    queryKey: ['devices', instance.id],
    queryFn: () => getPendingDevices(instance.id),
    refetchInterval: 5000,
  });
  const pendingDevices = devicesData?.pending ?? [];

  const approveMutation = useMutation({
    mutationFn: ({ requestId }: { requestId: string }) =>
      approveDevice(instance.id, requestId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['devices', instance.id] });
    },
  });

  const handleApproveAll = () => {
    for (const device of pendingDevices) {
      approveMutation.mutate({ requestId: device.requestId });
    }
  };

  const isRemote = window.location.hostname !== 'localhost' &&
                   window.location.hostname !== '127.0.0.1';
  const useProxy = !instance.tailscaleUrl && isRemote;
  const baseUrl = instance.tailscaleUrl
    ? `${instance.tailscaleUrl}/`
    : useProxy
      ? `${window.location.origin}/proxy/${instance.id}/`
      : `http://${window.location.hostname}:${instance.port}/`;

  const buildLaunchUrl = async (): Promise<string> => {
    if (useProxy) {
      // Proxy route injects the token automatically via server-side script
      return baseUrl;
    }
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
      setStatus(t('openedControlUi'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('failedOpenControlUi'));
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
        setStatus(t('launchUrlCopied'));
      } catch {
        window.prompt(t('copyLaunchUrl'), url);
        setStatus(t('launchUrlPrepared'));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('failedBuildLaunchUrl'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel-card">
      <div className="panel-header">
        <div>
          <h3 style={{ margin: 0 }}>{t('controlUi')}</h3>
          <p className="muted">{t('controlUiDesc')}</p>
        </div>
      </div>

      <div className="section-grid">
        <div className="metric-card">
          <p className="metric-label">{useProxy ? t('gatewayUrlProxied') : t('gatewayUrl')}</p>
          <p className="metric-value mono">{baseUrl}</p>
        </div>
        <div className="metric-card">
          <p className="metric-label">{t('instance')}</p>
          <p className="metric-value mono">{instance.id}</p>
        </div>
      </div>

      {pendingDevices.length > 0 && (
        <div className="metric-card" style={{ marginTop: '1rem', borderColor: 'var(--warning, #f59e0b)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <p className="metric-label" style={{ margin: 0 }}>
              {t('pairingRequired', {
                count: pendingDevices.length,
                requests: pendingDevices.length === 1 ? t('request') : t('requests'),
              })}
            </p>
            <button
              className="primary-button"
              style={{ fontSize: '0.75rem', padding: '0.25rem 0.75rem' }}
              onClick={handleApproveAll}
              disabled={approveMutation.isPending}
            >
              {approveMutation.isPending ? t('approving') : t('approveAll')}
            </button>
          </div>
          {pendingDevices.map((device) => (
            <div key={device.requestId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0.25rem 0 0' }}>
              <p className="muted mono" style={{ margin: 0, fontSize: '0.75rem' }}>
                {device.ip} — {device.requestId}
              </p>
              <button
                className="primary-button"
                style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', marginLeft: '0.5rem' }}
                onClick={() => approveMutation.mutate({ requestId: device.requestId })}
                disabled={approveMutation.isPending}
              >
                {t('approve')}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="action-row" style={{ marginTop: '1rem' }}>
        <button
          className="primary-button"
          onClick={() => void handleOpen()}
          disabled={loading}
        >
          {loading ? t('preparing') : t('openControlUi')}
        </button>
        <button
          className="secondary-button"
          onClick={() => void handleCopy()}
          disabled={loading}
        >
          {t('copyLaunchUrl')}
        </button>
      </div>

      {status ? <p className="token-status success-text">{status}</p> : null}
      {error ? <p className="token-status error-text">{error}</p> : null}
    </section>
  );
}
