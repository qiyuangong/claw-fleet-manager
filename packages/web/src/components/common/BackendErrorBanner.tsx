import { useTranslation } from 'react-i18next';
import type { BackendError } from '../../types';

interface Props {
  error: BackendError;
}

export function BackendErrorBanner({ error }: Props) {
  const { t } = useTranslation();
  const message = error.code === 'DOCKER_UNREACHABLE'
    ? t('backendErrorDockerUnreachable')
    : error.message;
  const since = new Date(error.since).toLocaleTimeString();

  return (
    <div
      role="alert"
      className="panel-card error-text"
      style={{ marginBottom: '1rem', padding: '0.75rem 1rem' }}
    >
      <strong>{t('backendErrorGenericTitle')}</strong>
      <p style={{ margin: '0.25rem 0 0' }}>{message}</p>
      <p className="muted" style={{ margin: '0.25rem 0 0', fontSize: '0.85em' }}>
        {t('backendErrorSinceLabel', { time: since })}
      </p>
    </div>
  );
}
