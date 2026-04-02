import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getFeishuPairing, approveFeishuPairing } from '../../api/fleet';
import { useInstanceConfig } from '../../hooks/useInstanceConfig';

interface FeishuChannelConfig {
  enabled?: boolean;
  appId?: string;
  appSecret?: string;
  requireMention?: boolean | string;
  groupPolicy?: string;
}

function extractFeishuConfig(raw: unknown): FeishuChannelConfig {
  const obj = raw as Record<string, unknown> | null;
  return (obj?.channels as Record<string, unknown>)?.feishu as FeishuChannelConfig ?? {};
}

export function FeishuTab({ instanceId }: { instanceId: string }) {
  const { t } = useTranslation();
  const { data: rawConfig, isLoading, save, saving } = useInstanceConfig(instanceId);
  const queryClient = useQueryClient();

  const feishu = extractFeishuConfig(rawConfig);
  const [enabled, setEnabled] = useState(true);
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [requireMention, setRequireMention] = useState(true);
  const [groupPolicy, setGroupPolicy] = useState('open');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setEnabled(feishu.enabled !== false);
    setAppId(feishu.appId ?? '');
    setAppSecret(feishu.appSecret ?? '');
    setRequireMention(feishu.requireMention !== false && feishu.requireMention !== 'open');
    setGroupPolicy(feishu.groupPolicy ?? 'open');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  const handleSave = async () => {
    setSaveError(null);
    setSaved(false);
    try {
      const updated = {
        ...(rawConfig as Record<string, unknown>),
        channels: {
          ...((rawConfig as Record<string, unknown>)?.channels as object ?? {}),
          feishu: {
            enabled,
            appId,
            appSecret,
            requireMention,
            groupPolicy,
          },
        },
      };
      await save(updated);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1600);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save');
    }
  };

  const { data: pairingData } = useQuery({
    queryKey: ['feishuPairing', instanceId],
    queryFn: () => getFeishuPairing(instanceId),
    refetchInterval: () => (
      typeof document !== 'undefined' && document.visibilityState === 'hidden'
        ? false
        : 5_000
    ),
  });
  const pending = pairingData?.pending ?? [];
  const rawOutput = pairingData?.raw ?? '';

  const approveMutation = useMutation({
    mutationFn: (code: string) => approveFeishuPairing(instanceId, code),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['feishuPairing', instanceId] });
    },
  });

  if (isLoading) {
    return <div className="panel-card muted">{t('loadingConfig')}</div>;
  }

  return (
    <section className="panel-card">
      <div className="panel-header">
        <div>
          <h3 style={{ margin: 0 }}>{t('feishuChannel')}</h3>
          <p className="muted">{t('feishuChannelDesc')}</p>
        </div>
      </div>

      {/* Config */}
      <div style={{ marginBottom: '1.5rem' }}>
        <p className="muted" style={{ marginTop: 0 }}>{t('feishuConfigHelp')}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <p className="metric-label" style={{ margin: 0 }}>{t('appCredentials')}</p>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginLeft: 'auto', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span className="label">{t('enabled')}</span>
          </label>
        </div>

        <div className="section-grid" style={{ marginBottom: '0.75rem' }}>
          <div>
            <label className="label" style={{ display: 'block', marginBottom: '0.25rem' }}>{t('appId')}</label>
            <input
              className="text-input"
              style={{ width: '100%', boxSizing: 'border-box' }}
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              placeholder="cli_xxx"
            />
          </div>
          <div>
            <label className="label" style={{ display: 'block', marginBottom: '0.25rem' }}>{t('appSecret')}</label>
            <input
              className="text-input"
              style={{ width: '100%', boxSizing: 'border-box' }}
              type="password"
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              placeholder="••••••••"
            />
          </div>
        </div>

        <div className="section-grid" style={{ marginBottom: '0.75rem' }}>
          <div>
            <label className="label" style={{ display: 'block', marginBottom: '0.25rem' }}>{t('groupPolicy')}</label>
            <select
              className="text-input"
              style={{ width: '100%', boxSizing: 'border-box' }}
              value={groupPolicy}
              onChange={(e) => setGroupPolicy(e.target.value)}
            >
              <option value="open">{t('groupPolicyOpen')}</option>
              <option value="allowlist">{t('groupPolicyAllowlist')}</option>
              <option value="disabled">{t('groupPolicyDisabled')}</option>
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', paddingTop: '1.25rem' }}>
            <input
              type="checkbox"
              id={`requireMention-${instanceId}`}
              checked={requireMention}
              onChange={(e) => setRequireMention(e.target.checked)}
            />
            <label className="label" htmlFor={`requireMention-${instanceId}`} style={{ cursor: 'pointer' }}>
              {t('requireMention')}
            </label>
          </div>
        </div>

        <div className="toolbar-row">
          <button className="primary-button" onClick={() => void handleSave()} disabled={saving}>
            {saving ? t('saving') : t('saveConfig')}
          </button>
          {saveError ? <span className="error-text">{saveError}</span> : null}
          {saved ? <span className="success-text">{t('saved')}</span> : null}
        </div>
      </div>

      {/* Pairing */}
      <div>
        <p className="metric-label" style={{ marginBottom: '0.75rem' }}>
          {t('pendingPairingRequests')}
          {pending.length > 0 ? ` — ${pending.length}` : ''}
        </p>

        {pending.length === 0 ? (
          rawOutput.trim() ? (
            <div className="metric-card">
              <p className="metric-label">{t('latestPairingOutput')}</p>
              <pre className="muted" style={{ fontSize: '0.75rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all', marginBottom: 0 }}>
                {rawOutput}
              </pre>
            </div>
          ) : (
            <p className="muted" style={{ fontSize: '0.875rem' }}>{t('noPendingPairing')}</p>
          )
        ) : (
          <div
            className="metric-card"
            style={{ borderColor: 'var(--warning, #f59e0b)' }}
          >
            {pending.map((item) => (
              <div
                key={item.code}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0.25rem 0' }}
              >
                <span className="muted mono" style={{ fontSize: '0.75rem' }}>
                  {item.code}{item.userId ? ` — ${item.userId}` : ''}
                </span>
                <button
                  className="primary-button"
                  style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', marginLeft: '0.5rem' }}
                  onClick={() => approveMutation.mutate(item.code)}
                  disabled={approveMutation.isPending}
                >
                  {t('approve')}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
