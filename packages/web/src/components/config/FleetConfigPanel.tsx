import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { scaleFleet } from '../../api/fleet';
import { useFleet } from '../../hooks/useFleet';
import { useFleetConfig } from '../../hooks/useFleetConfig';
import { ConfirmDialog } from '../common/ConfirmDialog';

export function FleetConfigPanel() {
  const { t } = useTranslation();
  const { data, isLoading, save, saving } = useFleetConfig();
  const { data: fleetData } = useFleet();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Record<string, string>>({});
  const [scaleCount, setScaleCount] = useState(1);
  const [showConfirm, setShowConfirm] = useState(false);
  const [scaling, setScaling] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [enableNpmPackages, setEnableNpmPackages] = useState(false);

  useEffect(() => {
    if (!data) return;
    setForm({
      BASE_URL: data.baseUrl,
      MODEL_ID: data.modelId,
      OPENCLAW_IMAGE: data.openclawImage,
      CPU_LIMIT: data.cpuLimit,
      MEM_LIMIT: data.memLimit,
      PORT_STEP: String(data.portStep),
      TZ: data.tz,
    });
    setScaleCount(data.count);
    setEnableNpmPackages(data.enableNpmPackages ?? false);
  }, [data]);

  const currentCount = fleetData?.instances.length ?? 0;

  const handleSave = async () => {
    setError(null);
    try {
      const payload = {
        ...form,
        ...(apiKey.trim() ? { API_KEY: apiKey.trim() } : {}),
        ENABLE_NPM_PACKAGES: enableNpmPackages ? 'true' : 'false',
      };
      await save(payload);
      setApiKey('');
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('saveFailed'));
    }
  };

  const doScale = async () => {
    setShowConfirm(false);
    setScaling(true);
    try {
      await scaleFleet(scaleCount);
      await queryClient.invalidateQueries({ queryKey: ['fleet'] });
      await queryClient.invalidateQueries({ queryKey: ['fleetConfig'] });
    } finally {
      setScaling(false);
    }
  };

  if (isLoading) {
    return <section className="panel-card muted">{t('loadingConfig')}</section>;
  }

  const fieldLabels: [string, string][] = [
    ['BASE_URL', t('baseUrl')],
    ['MODEL_ID', t('modelId')],
    ['OPENCLAW_IMAGE', t('openclawImage')],
    ['CPU_LIMIT', t('cpuLimit')],
    ['MEM_LIMIT', t('memLimit')],
    ['PORT_STEP', t('portStep')],
    ['TZ', t('timezone')],
  ];

  return (
    <section className="panel-card">
      <div className="panel-header">
        <div>
          <p className="pill">{t('fleetConfigPill')}</p>
          <h2 className="panel-title">{t('controlPlane')}</h2>
          <p className="muted">{t('controlPlaneDesc')}</p>
        </div>
      </div>

      <div className="fleet-form">
        <div className="section-grid">
          <div className="metric-card">
            <p className="metric-label">{t('apiKeyStatus')}</p>
            <p className="metric-value">{data?.apiKey ? t('configured') : t('notConfigured')}</p>
          </div>
          <div className="metric-card">
            <p className="metric-label">{t('configBase')}</p>
            <p className="metric-value mono">{data?.configBase || '-'}</p>
          </div>
          <div className="metric-card">
            <p className="metric-label">{t('workspaceBase')}</p>
            <p className="metric-value mono">{data?.workspaceBase || '-'}</p>
          </div>
        </div>

        <div className="field-grid">
          {fieldLabels.map(([key, label]) => (
            <label className="field-label" key={key}>
              <span>{label}</span>
              <input
                className="text-input mono"
                value={form[key] ?? ''}
                onChange={(event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))}
              />
            </label>
          ))}
          <label className="field-label">
            <span>{t('apiKey')}</span>
            <input
              className="text-input mono"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={t('apiKeyPlaceholder')}
              autoComplete="new-password"
            />
          </label>
        </div>

        <label className="field-label" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
          <input
            type="checkbox"
            checked={enableNpmPackages}
            onChange={(e) => setEnableNpmPackages(e.target.checked)}
          />
          <span>{t('enableNpmPackages')}</span>
        </label>
        <p className="muted" style={{ marginTop: 0 }}>
          {t('enableNpmPackagesHint')}
        </p>

        <div className="action-row">
          <button className="primary-button" onClick={() => void handleSave()} disabled={saving}>
            {saving ? t('saving') : t('saveConfigBtn')}
          </button>
          {saved ? <span className="success-text">{t('saved')}</span> : null}
          {error ? <span className="error-text">{error}</span> : null}
        </div>

        <section className="panel-card">
          <h3 style={{ marginTop: 0 }}>{t('scaleFleet')}</h3>
          <p className="muted">{t('currentlyTracking', { count: currentCount })}</p>
          <label className="field-label" style={{ maxWidth: '16rem' }}>
            <span>{t('targetCount')}</span>
            <input
              className="number-input"
              type="number"
              min={1}
              value={scaleCount}
              onChange={(event) => setScaleCount(parseInt(event.target.value, 10) || 1)}
            />
          </label>
          <p className="muted" style={{ marginTop: '0.75rem' }}>{t('scaleFleetHelp')}</p>
          <div className="field-row">
            <button
              className="primary-button"
              disabled={scaling || scaleCount === currentCount}
              onClick={() => {
                if (scaleCount < currentCount) {
                  setShowConfirm(true);
                  return;
                }
                void doScale();
              }}
            >
              {scaling ? t('scalingEllipsis') : t('apply')}
            </button>
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={showConfirm}
        title={t('scaleDownFleet')}
        message={t('scaleDownConfirm', { count: currentCount - scaleCount })}
        onConfirm={() => void doScale()}
        onCancel={() => setShowConfirm(false)}
      />
    </section>
  );
}
