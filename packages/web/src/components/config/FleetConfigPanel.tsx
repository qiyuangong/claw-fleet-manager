import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFleetConfig } from '../../hooks/useFleetConfig';

export function FleetConfigPanel() {
  const { t } = useTranslation();
  const { data, isLoading, save, saving } = useFleetConfig();
  const [form, setForm] = useState<Partial<Record<string, string>>>({});
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formDefaults = useMemo<Record<string, string>>(() => ({
    BASE_DIR: data?.baseDir ?? '',
    TZ: data?.tz ?? '',
  }), [data]);

  const handleSave = async () => {
    setError(null);
    try {
      const payload: Record<string, string> = {
        BASE_DIR: form['BASE_DIR'] ?? formDefaults['BASE_DIR'] ?? '',
        TZ: form['TZ'] ?? formDefaults['TZ'] ?? '',
      };
      await save(payload);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('saveFailed'));
    }
  };

  if (isLoading) {
    return <section className="panel-card muted">{t('loadingConfig')}</section>;
  }

  const fieldLabels: [string, string][] = [
    ['BASE_DIR', t('baseDir')],
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
                value={form[key] ?? formDefaults[key] ?? ''}
                onChange={(event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))}
              />
            </label>
          ))}
        </div>

        <p className="muted" style={{ marginTop: 0 }}>
          {t('fleetConfigScopeHint')}
        </p>

        <div className="action-row">
          <button className="primary-button" onClick={() => void handleSave()} disabled={saving}>
            {saving ? t('saving') : t('saveConfigBtn')}
          </button>
          {saved ? <span className="success-text">{t('saved')}</span> : null}
          {error ? <span className="error-text">{error}</span> : null}
        </div>
      </div>
    </section>
  );
}
