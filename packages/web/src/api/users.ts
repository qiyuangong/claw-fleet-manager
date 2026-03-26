import { apiFetch } from './client';
import type { PublicUser } from '../types';

export const getCurrentUser = () => apiFetch<PublicUser>('/api/users/me');

export const getUsers = () => apiFetch<PublicUser[]>('/api/users');

export const createUser = (username: string, password: string, role: 'admin' | 'user') =>
  apiFetch<PublicUser>('/api/users', {
    method: 'POST',
    body: JSON.stringify({ username, password, role }),
  });

export const deleteUser = (username: string) =>
  apiFetch<{ ok: boolean }>(`/api/users/${username}`, { method: 'DELETE' });

export const adminResetPassword = (username: string, password: string) =>
  apiFetch<{ ok: boolean }>(`/api/users/${username}/password`, {
    method: 'PUT',
    body: JSON.stringify({ password }),
  });

export const setAssignedProfiles = (username: string, profiles: string[]) =>
  apiFetch<{ ok: boolean }>(`/api/users/${username}/profiles`, {
    method: 'PUT',
    body: JSON.stringify({ profiles }),
  });

export const changeOwnPassword = (currentPassword: string, newPassword: string) =>
  apiFetch<{ ok: boolean }>('/api/users/me/password', {
    method: 'PUT',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
