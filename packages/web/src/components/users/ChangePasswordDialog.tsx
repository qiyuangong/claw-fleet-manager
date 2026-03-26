import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { adminResetPassword, changeOwnPassword } from '../../api/users';

interface Props {
  username: string;
  isAdmin: boolean;
  targetUsername?: string;
  onClose: () => void;
}

export function ChangePasswordDialog({ username, isAdmin, targetUsername, onClose }: Props) {
  const queryClient = useQueryClient();
  const isResetMode = !!targetUsername && targetUsername !== username;
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      isResetMode
        ? adminResetPassword(targetUsername, newPassword)
        : changeOwnPassword(currentPassword, newPassword),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: (cause) => {
      setError(cause instanceof Error ? cause.message : 'Failed to update password');
    },
  });

  const heading = isResetMode
    ? `Reset password for ${targetUsername}`
    : isAdmin
      ? 'Change Admin Password'
      : 'Change Password';

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-card" onClick={(event) => event.stopPropagation()}>
        <h2 style={{ margin: '0 0 1rem' }}>{heading}</h2>

        {!isResetMode ? (
          <>
            <label className="field-label">Current password</label>
            <input
              className="text-input"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoFocus
            />
          </>
        ) : null}

        <label className="field-label" style={{ marginTop: isResetMode ? 0 : '0.75rem' }}>
          New password
        </label>
        <input
          className="text-input"
          type="password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          autoFocus={isResetMode}
        />

        {error ? <p className="error-text" style={{ marginTop: '0.75rem' }}>{error}</p> : null}

        <div className="dialog-actions">
          <button className="secondary-button" onClick={onClose}>Cancel</button>
          <button
            className="primary-button"
            disabled={mutation.isPending || (!isResetMode && !currentPassword) || !newPassword}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
