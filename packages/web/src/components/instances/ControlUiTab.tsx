import { useState } from 'react';

interface Props {
  instanceId: string;
}

export function ControlUiTab({ instanceId }: Props) {
  const [loaded, setLoaded] = useState(false);
  const proxyUrl = `/proxy/${instanceId}/`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 260px)', minHeight: '500px', position: 'relative' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          borderBottom: '1px solid var(--border, #e2e8f0)',
          fontSize: '13px',
          flexShrink: 0,
        }}
      >
        <span style={{ color: 'var(--muted-foreground, #64748b)' }}>
          OpenClaw Control UI - {instanceId}
        </span>
        <a
          href={proxyUrl}
          target="_blank"
          rel="noreferrer"
          style={{ color: 'var(--primary, #3b82f6)', textDecoration: 'none' }}
        >
          Open in new tab ↗
        </a>
      </div>

      {!loaded ? (
        <div
          style={{
            position: 'absolute',
            inset: '37px 0 0 0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--background, #fff)',
            color: 'var(--muted-foreground, #64748b)',
            fontSize: '14px',
            zIndex: 1,
          }}
        >
          Loading control UI...
        </div>
      ) : null}

      <iframe
        src={proxyUrl}
        title={`OpenClaw Control UI - ${instanceId}`}
        onLoad={() => setLoaded(true)}
        style={{
          flex: 1,
          border: 'none',
          width: '100%',
          background: 'var(--background, #fff)',
        }}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
      />
    </div>
  );
}
