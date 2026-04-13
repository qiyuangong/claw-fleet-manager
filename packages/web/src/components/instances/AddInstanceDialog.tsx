import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { createInstance } from '../../api/fleet';
import { useFleetConfig } from '../../hooks/useFleetConfig';

interface Props {
  kind: 'docker' | 'profile';
  onClose: () => void;
}

interface DockerOverridesForm {
  image: string;
  cpuLimit: string;
  memoryLimit: string;
  portStep: string;
  enableNpmPackages: boolean;
}

const emptyDockerOverrides: DockerOverridesForm = {
  image: '',
  cpuLimit: '',
  memoryLimit: '',
  portStep: '',
  enableNpmPackages: true,
};

export function AddInstanceDialog({ kind, onClose }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: fleetConfig } = useFleetConfig();
  const [name, setName] = useState('');
  const [port, setPort] = useState('');
  const [error, setError] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [dockerOverrides, setDockerOverrides] = useState<DockerOverridesForm>(emptyDockerOverrides);

  const hydrateDockerOverrides = () => {
    if (kind !== 'docker' || !fleetConfig) return;
    setDockerOverrides((prev) => {
      if (prev.image || prev.cpuLimit || prev.memoryLimit || prev.portStep) {
        return prev;
      }
      return {
        image: fleetConfig.openclawImage ?? '',
        cpuLimit: fleetConfig.cpuLimit ?? '',
        memoryLimit: fleetConfig.memLimit ?? '',
        portStep: fleetConfig.portStep ? String(fleetConfig.portStep) : '',
        enableNpmPackages: fleetConfig.enableNpmPackages ?? false,
      };
    });
  };

  const create = useMutation({
    mutationFn: () => createInstance({
      runtime: 'openclaw',
      kind,
      name,
      port: kind === 'profile' && port ? parseInt(port, 10) : undefined,
      ...(kind === 'docker' && showAdvanced ? {
        image: dockerOverrides.image.trim() || undefined,
        cpuLimit: dockerOverrides.cpuLimit.trim() || undefined,
        memoryLimit: dockerOverrides.memoryLimit.trim() || undefined,
        portStep: dockerOverrides.portStep ? parseInt(dockerOverrides.portStep, 10) : undefined,
        enableNpmPackages: dockerOverrides.enableNpmPackages,
      } : {}),
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
  const portStepValid = !showAdvanced || !dockerOverrides.portStep || Number.parseInt(dockerOverrides.portStep, 10) > 0;
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

        {kind === 'docker' ? (
          <div style={{ marginTop: '1rem' }}>
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                if (!showAdvanced) {
                  hydrateDockerOverrides();
                }
                setShowAdvanced((prev) => !prev);
              }}
            >
              {showAdvanced ? t('hideDockerConfig') : t('showDockerConfig')}
            </button>

            {showAdvanced ? (
              <div className="field-grid" style={{ marginTop: '1rem' }}>
                <p className="muted" style={{ margin: 0 }}>{t('dockerAdvancedHelp')}</p>
                <label className="field-label">
                  <span>{t('openclawImage')}</span>
                  <input
                    className="text-input mono"
                    value={dockerOverrides.image}
                    onChange={(event) => setDockerOverrides((prev) => ({ ...prev, image: event.target.value }))}
                  />
                </label>
                <label className="field-label">
                  <span>{t('cpuLimit')}</span>
                  <input
                    className="text-input mono"
                    value={dockerOverrides.cpuLimit}
                    onChange={(event) => setDockerOverrides((prev) => ({ ...prev, cpuLimit: event.target.value }))}
                  />
                </label>
                <label className="field-label">
                  <span>{t('memLimit')}</span>
                  <input
                    className="text-input mono"
                    value={dockerOverrides.memoryLimit}
                    onChange={(event) => setDockerOverrides((prev) => ({ ...prev, memoryLimit: event.target.value }))}
                  />
                </label>
                <label className="field-label">
                  <span>{t('portStep')}</span>
                  <input
                    className="text-input mono"
                    value={dockerOverrides.portStep}
                    onChange={(event) => setDockerOverrides((prev) => ({
                      ...prev,
                      portStep: event.target.value.replace(/[^\d]/g, ''),
                    }))}
                    type="number"
                  />
                </label>
                {!portStepValid ? (
                  <p className="error-text" style={{ marginTop: 0 }}>{t('portStepInvalid')}</p>
                ) : null}
                <label className="field-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="checkbox"
                    checked={dockerOverrides.enableNpmPackages}
                    onChange={(event) => setDockerOverrides((prev) => ({
                      ...prev,
                      enableNpmPackages: event.target.checked,
                    }))}
                  />
                  <span>{t('enableNpmPackages')}</span>
                </label>
                <p className="muted" style={{ marginTop: 0 }}>
                  {t('enableNpmPackagesHint')}
                </p>
                {!dockerOverrides.enableNpmPackages ? (
                  <p className="error-text" style={{ marginTop: 0 }}>
                    {t('enableNpmPackagesWarning')}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {error ? <p className="error-text" style={{ marginTop: '0.5rem' }}>{error}</p> : null}

        <div className="action-row" style={{ marginTop: '1.25rem' }}>
          <button
            className="primary-button"
            onClick={() => create.mutate()}
            disabled={!nameValid || !portStepValid || create.isPending}
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
