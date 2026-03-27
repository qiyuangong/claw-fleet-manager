import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createUser, deleteUser, setAssignedProfiles } from '../../api/users';
import { useFleet } from '../../hooks/useFleet';
import { useUsers } from '../../hooks/useUsers';
import { useAppStore } from '../../store';
import type { PublicUser } from '../../types';
import { ChangePasswordDialog } from './ChangePasswordDialog';

export function UserManagementPanel() {
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
        <p className="error-text">User management requires admin access.</p>
      </section>
    );
  }

  if (isLoading) {
    return <div className="panel-card muted">Loading users...</div>;
  }

  return (
    <section className="panel-card">
      <div className="panel-header">
        <div>
          <p className="pill">Admin</p>
          <h2 className="panel-title">User Management</h2>
          <p className="muted">Create users, reset passwords, and assign profile access (each profile can belong to only one user).</p>
        </div>
      </div>

      <div className="table-shell">
        <table className="data-table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Role</th>
              <th>Assigned Profiles</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users?.map((user: PublicUser) => (
              <tr key={user.username}>
                <td className="mono">{user.username}</td>
                <td>{user.role}</td>
                <td>{user.role === 'admin' ? 'All profiles' : user.assignedProfiles.join(', ') || 'None'}</td>
                <td>
                  <div className="action-row">
                    <button className="secondary-button" onClick={() => setResetTarget(user.username)}>
                      Reset Password
                    </button>
                    {user.role !== 'admin' ? (
                      <button
                        className="secondary-button"
                        onClick={() => {
                          setEditProfilesTarget(user.username);
                          setSelectedProfiles(user.assignedProfiles);
                        }}
                      >
                        Profiles
                      </button>
                    ) : null}
                    {user.username !== currentUser.username ? (
                      <button
                        className="danger-button"
                        onClick={() => deleteMutation.mutate(user.username)}
                        disabled={deleteMutation.isPending}
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel-card" style={{ marginTop: '1.25rem' }}>
        <h3 style={{ marginTop: 0 }}>Add User</h3>
        <div className="form-row">
          <input
            className="text-input"
            placeholder="Username"
            value={newUsername}
            onChange={(event) => setNewUsername(event.target.value.toLowerCase())}
          />
          <input
            className="text-input"
            type="password"
            placeholder="Password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
          <select
            className="text-input"
            value={newRole}
            onChange={(event) => setNewRole(event.target.value as 'admin' | 'user')}
          >
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
          <button
            className="primary-button"
            disabled={createMutation.isPending || !newUsername.trim() || !newPassword}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? 'Adding...' : 'Add'}
          </button>
        </div>
        {createError ? <p className="error-text" style={{ marginBottom: 0 }}>{createError}</p> : null}
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
            <h2 style={{ margin: '0 0 1rem' }}>Assign Profiles: {editProfilesTarget}</h2>
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
                    <span className="muted">(currently assigned to {profileOwner.get(profileId)})</span>
                  ) : null}
                </label>
              ))}
              {allProfiles.length === 0 ? <p className="muted">No profiles available yet.</p> : null}
            </div>
            <div className="dialog-actions">
              <button className="secondary-button" onClick={() => setEditProfilesTarget(null)}>Cancel</button>
              <button
                className="primary-button"
                disabled={profilesMutation.isPending}
                onClick={() => profilesMutation.mutate({ username: editProfilesTarget, profiles: selectedProfiles })}
              >
                {profilesMutation.isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
