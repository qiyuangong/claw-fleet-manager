import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { createUser, deleteUser, setAssignedProfiles } from '../../api/users';
import { useFleet } from '../../hooks/useFleet';
import { useUsers } from '../../hooks/useUsers';
import { useAppStore } from '../../store';
import type { PublicUser } from '../../types';
import { ChangePasswordDialog } from './ChangePasswordDialog';

export function UserManagementPanel() {
  const { t } = useTranslation();
  const currentUser = useAppStore((state) => state.currentUser);
  const { data: users, isLoading } = useUsers();
  const { data: fleet } = useFleet();
  const queryClient = useQueryClient();

  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'user'>('user');
  const [createError, setCreateError] = useState('');
  const [resetTarget, setResetTarget] = useState<string | null>(null);
  const [editProfilesTarget, setEditProfilesTarget] = useState<string | null>(null);
  const [selectedProfiles, setSelectedProfiles] = useState<string[]>([]);

  const allProfiles = fleet?.instances.map((instance) => instance.id) ?? [];
  const profileOwner = new Map<string, string>();
  for (const user of users ?? []) {
    for (const profile of user.assignedProfiles) {
      profileOwner.set(profile, user.username);
    }
  }

  const createMutation = useMutation({
    mutationFn: () => createUser(newUsername.trim(), newPassword, newRole),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      setNewUsername('');
      setNewPassword('');
      setNewRole('user');
      setCreateError('');
    },
    onError: (cause) => {
      setCreateError(cause instanceof Error ? cause.message : 'Failed to create user');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (username: string) => deleteUser(username),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const profilesMutation = useMutation({
    mutationFn: ({ username, profiles }: { username: string; profiles: string[] }) =>
      setAssignedProfiles(username, profiles),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      setEditProfilesTarget(null);
      setSelectedProfiles([]);
    },
  });

  if (currentUser?.role !== 'admin') {
    return (
      <section className="panel-card">
        <p className="error-text">{t('adminAccessRequired')}</p>
      </section>
    );
  }

  if (isLoading) {
    return <div className="panel-card muted">{t('loadingUsers')}</div>;
  }

  return (
    <section className="panel-card">
      <div className="panel-header">
        <div>
          <p className="pill">{t('admin')}</p>
          <h2 className="panel-title">{t('userManagement')}</h2>
          <p className="muted">{t('userManagementDesc')}</p>
        </div>
      </div>

      <div className="panel-card" style={{ marginBottom: '1.25rem' }}>
        <h3 style={{ marginTop: 0 }}>{t('addUser')}</h3>
        <p className="muted" style={{ marginTop: 0 }}>{t('addUserHelp')}</p>
        <div className="form-row">
          <label className="field-label">
            <span>{t('createUserUsername')}</span>
            <input
              className="text-input"
              placeholder={t('username')}
              value={newUsername}
              onChange={(event) => setNewUsername(event.target.value.toLowerCase())}
            />
          </label>
          <label className="field-label">
            <span>{t('createUserPassword')}</span>
            <input
              className="text-input"
              type="password"
              placeholder={t('passwordPlaceholder')}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </label>
          <label className="field-label">
            <span>{t('createUserRole')}</span>
            <select
              className="text-input"
              value={newRole}
              onChange={(event) => setNewRole(event.target.value as 'admin' | 'user')}
            >
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
          </label>
          <button
            className="primary-button"
            disabled={createMutation.isPending || !newUsername.trim() || !newPassword}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? t('adding') : t('add')}
          </button>
        </div>
        {createError ? <p className="error-text" style={{ marginBottom: 0 }}>{createError}</p> : null}
      </div>

      <div className="table-shell">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('username')}</th>
              <th>{t('role')}</th>
              <th>{t('assignedProfiles')}</th>
              <th>{t('actions')}</th>
            </tr>
          </thead>
          <tbody>
            {users?.map((user: PublicUser) => (
              <tr key={user.username}>
                <td className="mono">{user.username}</td>
                <td>{user.role}</td>
                <td>{user.role === 'admin' ? t('allProfiles') : user.assignedProfiles.join(', ') || t('none')}</td>
                <td>
                  <div className="action-row">
                    <button className="secondary-button" onClick={() => setResetTarget(user.username)}>
                      {t('resetPassword')}
                    </button>
                    {user.role !== 'admin' ? (
                      <button
                        className="secondary-button"
                        onClick={() => {
                          setEditProfilesTarget(user.username);
                          setSelectedProfiles(user.assignedProfiles);
                        }}
                      >
                        {t('profiles')}
                      </button>
                    ) : null}
                    {user.username !== currentUser.username ? (
                      <button
                        className="danger-button"
                        onClick={() => deleteMutation.mutate(user.username)}
                        disabled={deleteMutation.isPending}
                      >
                        {t('delete')}
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {resetTarget ? (
        <ChangePasswordDialog
          username={currentUser.username}
          isAdmin={true}
          targetUsername={resetTarget}
          onClose={() => setResetTarget(null)}
        />
      ) : null}

      {editProfilesTarget ? (
        <div className="dialog-overlay" onClick={() => setEditProfilesTarget(null)}>
          <div className="dialog-card" onClick={(event) => event.stopPropagation()}>
            <h2 style={{ margin: '0 0 1rem' }}>{t('assignProfilesTitle', { username: editProfilesTarget })}</h2>
            <div className="profile-checklist">
              {allProfiles.map((profileId) => (
                <label key={profileId} className="check-row">
                  <input
                    type="checkbox"
                    checked={selectedProfiles.includes(profileId)}
                    onChange={(event) => setSelectedProfiles(
                      event.target.checked
                        ? [...selectedProfiles, profileId]
                        : selectedProfiles.filter((value) => value !== profileId),
                    )}
                  />
                  <span className="mono">{profileId}</span>
                  {profileOwner.get(profileId) && profileOwner.get(profileId) !== editProfilesTarget ? (
                    <span className="muted">{t('currentlyAssignedTo', { owner: profileOwner.get(profileId) })}</span>
                  ) : null}
                </label>
              ))}
              {allProfiles.length === 0 ? <p className="muted">{t('noProfilesAvailable')}</p> : null}
            </div>
            <div className="dialog-actions">
              <button className="secondary-button" onClick={() => setEditProfilesTarget(null)}>{t('cancel')}</button>
              <button
                className="primary-button"
                disabled={profilesMutation.isPending}
                onClick={() => profilesMutation.mutate({ username: editProfilesTarget, profiles: selectedProfiles })}
              >
                {profilesMutation.isPending ? t('savingEllipsis') : t('save')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
