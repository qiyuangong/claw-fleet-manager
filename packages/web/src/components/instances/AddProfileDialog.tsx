// packages/web/src/components/instances/AddProfileDialog.tsx
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createProfile } from '../../api/fleet';

interface Props {
  onClose: () => void;
}

export function AddProfileDialog({ onClose }: Props) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [port, setPort] = useState('');
  const [error, setError] = useState('');

  const create = useMutation({
    mutationFn: () => createProfile({
      name,
      port: port ? parseInt(port, 10) : undefined,
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['fleet'] });
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  const nameValid = /^[a-z0-9][a-z0-9-]{0,62}$/.test(name);

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: '0 0 1rem' }}>Add Profile</h2>

        <label className="field-label">
          Profile name <span className="muted">(lowercase, hyphens allowed)</span>
        </label>
        <input
          className="text-input"
          value={name}
          onChange={(e) => setName(e.target.value.toLowerCase())}
          placeholder="main"
          autoFocus
        />

        <label className="field-label" style={{ marginTop: '0.75rem' }}>
          Gateway port <span className="muted">(leave blank to auto-assign)</span>
        </label>
        <input
          className="text-input"
          value={port}
          onChange={(e) => setPort(e.target.value)}
          placeholder="18789"
          type="number"
        />

        {error ? <p className="error-text" style={{ marginTop: '0.5rem' }}>{error}</p> : null}

        <div className="action-row" style={{ marginTop: '1.25rem' }}>
          <button
            className="primary-button"
            onClick={() => create.mutate()}
            disabled={!nameValid || create.isPending}
          >
            {create.isPending ? 'Creating...' : 'Create'}
          </button>
          <button className="secondary-button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
