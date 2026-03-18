import { useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import { useInstanceConfig } from '../../hooks/useInstanceConfig';

export function ConfigTab({ instanceId }: { instanceId: string }) {
  const { data, isLoading, save, saving } = useInstanceConfig(instanceId);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) {
      setValue(JSON.stringify(data, null, 2));
    }
  }, [data]);

  const handleSave = async () => {
    setError(null);
    setSaved(false);
    try {
      const parsed = JSON.parse(value);
      await save(parsed);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1600);
    } catch (saveError: any) {
      setError(saveError.message);
    }
  };

  if (isLoading) {
    return <div className="panel-card muted">Loading config...</div>;
  }

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
