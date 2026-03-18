import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { scaleFleet } from '../../api/fleet';
import { useFleet } from '../../hooks/useFleet';
import { useFleetConfig } from '../../hooks/useFleetConfig';
import { ConfirmDialog } from '../common/ConfirmDialog';

export function FleetConfigPanel() {
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
    return <section className="panel-card muted">Loading fleet config...</section>;
  }

  return (
    <section className="panel-card">
      <div className="panel-header">
        <div>
          <p className="pill">Fleet Config</p>
          <h2 className="panel-title">Control Plane</h2>
          <p className="muted">Edit core fleet settings and scale instance count.</p>
        </div>
      </div>

      <div className="fleet-form">
        <div className="field-grid">
          {[
            ['BASE_URL', 'Base URL'],
            ['MODEL_ID', 'Model ID'],
            ['CPU_LIMIT', 'CPU Limit'],
            ['MEM_LIMIT', 'Memory Limit'],
            ['PORT_STEP', 'Port Step'],
            ['TZ', 'Timezone'],
          ].map(([key, label]) => (
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
            {saving ? 'Saving...' : 'Save Config'}
          </button>
          {saved ? <span className="success-text">Saved</span> : null}
        </div>

        <section className="panel-card">
          <h3 style={{ marginTop: 0 }}>Scale Fleet</h3>
          <p className="muted">Currently tracking {currentCount} instance(s).</p>
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
              {scaling ? 'Scaling...' : 'Apply'}
            </button>
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={showConfirm}
        title="Scale Down Fleet"
        message={`This will stop and remove ${currentCount - scaleCount} instance(s). Volumes are preserved.`}
        onConfirm={() => void doScale()}
        onCancel={() => setShowConfirm(false)}
      />
    </section>
  );
}
