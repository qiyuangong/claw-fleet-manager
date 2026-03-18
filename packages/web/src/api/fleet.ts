import { apiFetch } from './client';
import type { FleetConfig, FleetInstance, FleetStatus } from '../types';

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

export const scaleFleet = (count: number) =>
  apiFetch<{ ok: boolean; fleet: FleetStatus }>('/api/fleet/scale', {
    method: 'POST',
    body: JSON.stringify({ count }),
  });
