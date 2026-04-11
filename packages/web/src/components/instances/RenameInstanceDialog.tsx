import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { renameInstance } from '../../api/fleet';
import { useAppStore } from '../../store';
import type { FleetInstance } from '../../types';

interface Props {
  instance: FleetInstance;
  onClose: () => void;
}

export function RenameInstanceDialog({ instance, onClose }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const selectInstance = useAppStore((state) => state.selectInstance);
  const [name, setName] = useState(instance.id);
  const [error, setError] = useState('');

  const rename = useMutation({
    mutationFn: (nextName: string) => renameInstance(instance.id, nextName),
    onSuccess: (renamed) => {
      void queryClient.invalidateQueries({ queryKey: ['fleet'] });
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      const activeView = useAppStore.getState().activeView;
      if (activeView.type === 'instance' && activeView.id === instance.id) {
        selectInstance(renamed.id);
      }
      toast.success(t('renameInstanceSuccess', { old: instance.id, next: renamed.id }));
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  const trimmedName = name.trim();
  const nameValid = /^[a-z0-9][a-z0-9-]{0,62}$/.test(trimmedName);
  const reservedProfileName = instance.mode === 'profile' && trimmedName === 'main';
  const hasNoChange = trimmedName === instance.id;

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: '0 0 1rem' }}>{t('renameInstanceTitle')}</h2>
        <p className="muted" style={{ marginTop: 0 }}>{t('renameInstanceHelp')}</p>

        <label className="field-label">
          {t('instanceName')} <span className="muted">{t('instanceNameHint')}</span>
        </label>
        <input
          className="text-input"
          value={name}
          onChange={(e) => setName(e.target.value.toLowerCase())}
          placeholder={t('instanceNamePlaceholder')}
          autoFocus
        />
        {hasNoChange ? <p className="error-text" style={{ marginTop: '0.5rem' }}>{t('renameInstanceNoChange')}</p> : null}
        {!reservedProfileName && trimmedName && !nameValid ? (
          <p className="error-text" style={{ marginTop: '0.5rem' }}>{t('instanceNameInvalid')}</p>
        ) : null}
        {reservedProfileName ? <p className="error-text" style={{ marginTop: '0.5rem' }}>{t('profileNameReserved')}</p> : null}

        {error ? <p className="error-text" style={{ marginTop: '0.5rem' }}>{error}</p> : null}

        <div className="action-row" style={{ marginTop: '1.25rem' }}>
          <button
            className="primary-button"
            onClick={() => rename.mutate(trimmedName)}
            disabled={!nameValid || reservedProfileName || hasNoChange || rename.isPending}
          >
            {rename.isPending ? t('renaming') : t('renameInstanceCta')}
          </button>
          <button className="secondary-button" onClick={onClose}>
            {t('cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
