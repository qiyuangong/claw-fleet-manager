import { useTranslation } from 'react-i18next';

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, message, confirmLabel, onConfirm, onCancel }: Props) {
  const { t } = useTranslation();
  if (!open) return null;

  return (
    <div className="confirm-overlay">
      <div className="dialog-card">
        <h3>{title}</h3>
        <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{message}</p>
        <div className="action-row">
          <button className="secondary-button" onClick={onCancel}>{t('cancel')}</button>
          <button className="danger-button" onClick={onConfirm}>{confirmLabel ?? t('confirm')}</button>
        </div>
      </div>
    </div>
  );
}
