import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Editor from '@monaco-editor/react';
import { useInstanceConfig } from '../../hooks/useInstanceConfig';

export function ConfigTab({ instanceId }: { instanceId: string }) {
  const { t } = useTranslation();
  const { data, isLoading, save, saving } = useInstanceConfig(instanceId);
  const initialValue = JSON.stringify(data ?? {}, null, 2);

  if (isLoading) {
    return <div className="panel-card muted">{t('loadingConfig')}</div>;
  }

  return (
    <ConfigEditor
      key={`${instanceId}:${initialValue}`}
      initialValue={initialValue}
      onSave={save}
      saving={saving}
    />
  );
}

function ConfigEditor({
  initialValue,
  onSave,
  saving,
}: {
  initialValue: string;
  onSave: (config: unknown) => Promise<unknown>;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = value !== initialValue;

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty]);

  const handleSave = async () => {
    setError(null);
    setSaved(false);
    try {
      const parsed = JSON.parse(value);
      await onSave(parsed);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1600);
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save config');
    }
  };

  const handleFormat = () => {
    setError(null);
    try {
      setValue(JSON.stringify(JSON.parse(value), null, 2));
    } catch (formatError: unknown) {
      setError(formatError instanceof Error ? formatError.message : 'Invalid JSON');
    }
  };

  const handleReset = () => {
    setError(null);
    setSaved(false);
    setValue(initialValue);
  };

  return (
    <div className="panel-card">
      <div className="toolbar-row" style={{ marginBottom: '1rem' }}>
        <button className="primary-button" onClick={() => void handleSave()} disabled={saving}>
          {saving ? t('saving') : t('save')}
        </button>
        <button className="secondary-button" onClick={handleFormat} disabled={saving}>
          {t('formatJson')}
        </button>
        <button className="secondary-button" onClick={handleReset} disabled={!dirty || saving}>
          {t('resetChanges')}
        </button>
        {dirty ? <span className="pill">{t('unsavedChanges')}</span> : null}
        {error ? <span className="error-text">{error}</span> : null}
        {saved ? <span className="success-text">{t('saved')}</span> : null}
      </div>
      <p className="muted" style={{ marginTop: 0, marginBottom: '1rem' }}>{t('configEditorHelp')}</p>

      <div className="editor-shell">
        <Editor
          height="520px"
          defaultLanguage="json"
          value={value}
          onChange={(next) => setValue(next ?? '')}
          theme="vs-dark"
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            scrollBeyondLastLine: false,
            formatOnPaste: true,
          }}
        />
      </div>
    </div>
  );
}
