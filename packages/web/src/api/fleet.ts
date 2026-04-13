import { apiFetch } from './client';
import type { FleetConfig, FleetInstance, FleetSessionsResult, FleetStatus } from '../types';

export const getFleet = () => apiFetch<FleetStatus>('/api/fleet');

export const startInstance = (id: string) =>
  apiFetch<{ ok: boolean; instance: FleetInstance }>(`/api/fleet/${id}/start`, { method: 'POST' });

export const stopInstance = (id: string) =>
  apiFetch<{ ok: boolean; instance: FleetInstance }>(`/api/fleet/${id}/stop`, { method: 'POST' });

export const restartInstance = (id: string) =>
  apiFetch<{ ok: boolean; instance: FleetInstance }>(`/api/fleet/${id}/restart`, { method: 'POST' });

export const revealToken = (id: string) =>
  apiFetch<{ token: string }>(`/api/fleet/${id}/token/reveal`, { method: 'POST' });

export const getInstanceConfig = (id: string) => apiFetch<unknown>(`/api/fleet/${id}/config`);

export const saveInstanceConfig = (id: string, config: unknown) =>
  apiFetch<{ ok: boolean }>(`/api/fleet/${id}/config`, {
    method: 'PUT',
    body: JSON.stringify(config),
  });

export const getFleetConfig = () => apiFetch<FleetConfig>('/api/config/fleet');

export const saveFleetConfig = (vars: Record<string, string>) =>
  apiFetch<{ ok: boolean }>('/api/config/fleet', {
    method: 'PUT',
    body: JSON.stringify(vars),
  });

export interface PendingDevice {
  requestId: string;
  ip: string;
}

export const getPendingDevices = (id: string) =>
  apiFetch<{ pending: PendingDevice[] }>(`/api/fleet/${id}/devices/pending`);

export const approveDevice = (id: string, requestId: string) =>
  apiFetch<{ ok: boolean }>(`/api/fleet/${id}/devices/${requestId}/approve`, { method: 'POST' });

export interface PendingFeishuPairing {
  code: string;
  userId?: string;
}

export const getFeishuPairing = (id: string) =>
  apiFetch<{ pending: PendingFeishuPairing[]; raw: string }>(`/api/fleet/${id}/feishu/pairing`);

export const approveFeishuPairing = (id: string, code: string) =>
  apiFetch<{ ok: boolean }>(`/api/fleet/${id}/feishu/pairing/${code}/approve`, { method: 'POST' });

export interface CreateInstanceOpts {
  runtime: 'openclaw' | 'hermes';
  kind: 'docker' | 'profile';
  name: string;
  port?: number;
  config?: object;
  apiKey?: string;
  image?: string;
  cpuLimit?: string;
  memoryLimit?: string;
  portStep?: number;
  enableNpmPackages?: boolean;
}

export interface ProfilePlugin {
  id: string;
  name?: string;
  description?: string;
  version?: string;
  origin?: string;
  status?: string;
  enabled?: boolean;
  source?: string;
}

export interface ProfilePluginList {
  workspaceDir?: string;
  plugins: ProfilePlugin[];
}

export const createInstance = (opts: CreateInstanceOpts) =>
  apiFetch<FleetInstance>('/api/fleet/instances', {
    method: 'POST',
    body: JSON.stringify(opts),
  });

export const deleteInstance = (id: string) =>
  apiFetch<{ ok: boolean }>(`/api/fleet/instances/${id}`, { method: 'DELETE' });

export const renameInstance = (id: string, name: string) =>
  apiFetch<FleetInstance>(`/api/fleet/instances/${id}/rename`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });

export const migrateInstance = (id: string, body: { targetMode: 'docker' | 'profile'; deleteSource?: boolean }) =>
  apiFetch<FleetInstance>(`/api/fleet/instances/${id}/migrate`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const getProfilePlugins = (id: string) =>
  apiFetch<ProfilePluginList>(`/api/fleet/${id}/plugins`);

export const installProfilePlugin = (id: string, spec: string) =>
  apiFetch<{ ok: boolean; output: string }>(`/api/fleet/${id}/plugins/install`, {
    method: 'POST',
    body: JSON.stringify({ spec }),
  });

export const uninstallProfilePlugin = (id: string, pluginId: string) =>
  apiFetch<{ ok: boolean; output: string }>(`/api/fleet/${id}/plugins/${pluginId}`, {
    method: 'DELETE',
  });

export const getFleetSessions = () => apiFetch<FleetSessionsResult>('/api/fleet/sessions');
