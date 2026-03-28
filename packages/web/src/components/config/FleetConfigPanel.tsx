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

  useEffect(() => {
    if (!data) return;
    setForm({
      BASE_URL: data.baseUrl,
      MODEL_ID: data.modelId,
      CPU_LIMIT: data.cpuLimit,
      MEM_LIMIT: data.memLimit,
      PORT_STEP: String(data.portStep),
      TZ: data.tz,
    });
    setScaleCount(data.count);
  }, [data]);

  const currentCount = fleetData?.instances.length ?? 0;

  const handleSave = async () => {
    await save(form);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
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
        </div>

        <div className="action-row">
          <button className="primary-button" onClick={() => void handleSave()} disabled={saving}>
            {saving ? t('saving') : t('saveConfigBtn')}
          </button>
          {saved ? <span className="success-text">{t('saved')}</span> : null}
        </div>

        <section className="panel-card">
          <h3 style={{ marginTop: 0 }}>{t('scaleFleet')}</h3>
          <p className="muted">{t('currentlyTracking', { count: currentCount })}</p>
          <div className="field-row">
            <input
              className="number-input"
              type="number"
              min={1}
              value={scaleCount}
              onChange={(event) => setScaleCount(parseInt(event.target.value, 10) || 1)}
              style={{ maxWidth: '7rem' }}
            />
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
