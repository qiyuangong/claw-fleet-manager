import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { createInstance } from '../../api/fleet';

interface Props {
  kind: 'docker' | 'profile';
  onClose: () => void;
}

export function AddInstanceDialog({ kind, onClose }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [port, setPort] = useState('');
  const [error, setError] = useState('');

  const create = useMutation({
    mutationFn: () => createInstance({
      name,
      port: kind === 'profile' && port ? parseInt(port, 10) : undefined,
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['fleet'] });
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  const nameValid = /^[a-z0-9][a-z0-9-]{0,62}$/.test(name) && (kind === 'docker' || name !== 'main');
  const reservedName = kind === 'profile' && name === 'main';
  const titleKey = kind === 'docker' ? 'addDockerInstanceTitle' : 'addProfileTitle';
  const helpKey = kind === 'docker' ? 'addDockerInstanceHelp' : 'addProfileHelp';
  const ctaKey = kind === 'docker' ? 'createDockerInstanceCta' : 'createProfileCta';

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: '0 0 1rem' }}>{t(titleKey)}</h2>
        <p className="muted" style={{ marginTop: 0 }}>{t(helpKey)}</p>

        <label className="field-label">
          {t('instanceName')} <span className="muted">{t('instanceNameHint')}</span>
        </label>
        <input
          className="text-input"
          value={name}
          onChange={(e) => setName(e.target.value.toLowerCase())}
          placeholder={t(kind === 'docker' ? 'dockerInstanceNamePlaceholder' : 'profileNamePlaceholder')}
          autoFocus
        />
        {!reservedName && name && !nameValid ? (
          <p className="error-text" style={{ marginTop: '0.5rem' }}>{t('instanceNameInvalid')}</p>
        ) : null}
        {reservedName ? <p className="error-text" style={{ marginTop: '0.5rem' }}>{t('profileNameReserved')}</p> : null}

        {kind === 'profile' ? (
          <>
            <label className="field-label" style={{ marginTop: '0.75rem' }}>
              {t('gatewayPort')} <span className="muted">{t('gatewayPortHint')}</span>
            </label>
            <input
              className="text-input"
              value={port}
              onChange={(e) => setPort(e.target.value.replace(/[^\d]/g, ''))}
              placeholder={t('gatewayPortPlaceholder')}
              type="number"
            />
          </>
        ) : null}

        {error ? <p className="error-text" style={{ marginTop: '0.5rem' }}>{error}</p> : null}

        <div className="action-row" style={{ marginTop: '1.25rem' }}>
          <button
            className="primary-button"
            onClick={() => create.mutate()}
            disabled={!nameValid || create.isPending}
          >
            {create.isPending ? t('creating') : t(ctaKey)}
          </button>
          <button className="secondary-button" onClick={onClose}>
            {t('cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
