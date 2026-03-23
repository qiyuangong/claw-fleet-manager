import { useState } from 'react';
import Editor from '@monaco-editor/react';
import { useInstanceConfig } from '../../hooks/useInstanceConfig';

export function ConfigTab({ instanceId }: { instanceId: string }) {
  const { data, isLoading, save, saving } = useInstanceConfig(instanceId);
  const initialValue = JSON.stringify(data ?? {}, null, 2);

  if (isLoading) {
    return <div className="panel-card muted">Loading config...</div>;
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
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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

  return (
    <div className="panel-card">
      <div className="toolbar-row" style={{ marginBottom: '1rem' }}>
        <button className="primary-button" onClick={() => void handleSave()} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </button>
        {error ? <span className="error-text">{error}</span> : null}
        {saved ? <span className="success-text">Saved</span> : null}
      </div>

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
