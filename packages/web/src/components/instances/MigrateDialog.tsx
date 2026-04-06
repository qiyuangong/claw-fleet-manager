import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { migrateInstance } from '../../api/fleet';
import { useAppStore } from '../../store';
import type { FleetInstance } from '../../types';

interface Props {
  instance: FleetInstance;
  onClose: () => void;
}

export function MigrateDialog({ instance, onClose }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const selectInstance = useAppStore((state) => state.selectInstance);
  const [targetMode, setTargetMode] = useState<'docker' | 'profile'>(
    instance.mode === 'docker' ? 'profile' : 'docker',
  );
  const [deleteSource, setDeleteSource] = useState(true);
  const [error, setError] = useState('');

  const migrate = useMutation({
    mutationFn: () => migrateInstance(instance.id, { targetMode, deleteSource }),
    onSuccess: () => {
      selectInstance(instance.id);
      void queryClient.invalidateQueries({ queryKey: ['fleet'] });
      toast.success(t('migrateSuccessToast', { id: instance.id, mode: targetMode }));
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: '0 0 1rem' }}>{t('migrateInstanceTitle')}</h2>
        <p className="muted" style={{ marginTop: 0 }}>{t('migrateInstanceHelp')}</p>

        <p className="field-label">{t('migrateTargetMode')}</p>
        <div className="action-row" style={{ marginBottom: '1rem' }}>
          {(['docker', 'profile'] as const).map((mode) => (
            <label
              key={mode}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                cursor: mode === instance.mode ? 'not-allowed' : 'pointer',
                opacity: mode === instance.mode ? 0.4 : 1,
              }}
            >
              <input
                type="radio"
                name="targetMode"
                value={mode}
                checked={targetMode === mode}
                disabled={mode === instance.mode}
                onChange={() => setTargetMode(mode)}
              />
              {mode === 'docker' ? 'Docker' : 'Profile'}
            </label>
          ))}
        </div>

        <label className="field-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input
            type="checkbox"
            checked={deleteSource}
            onChange={(e) => setDeleteSource(e.target.checked)}
          />
          {t('migrateDeleteSource')}
        </label>

        {error ? <p className="error-text" style={{ marginTop: '0.5rem' }}>{error}</p> : null}

        <div className="action-row" style={{ marginTop: '1.25rem' }}>
          <button
            className="primary-button"
            onClick={() => migrate.mutate()}
            disabled={migrate.isPending}
          >
            {migrate.isPending ? t('migrating') : t('migrateCta')}
          </button>
          <button className="secondary-button" onClick={onClose}>
            {t('cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
