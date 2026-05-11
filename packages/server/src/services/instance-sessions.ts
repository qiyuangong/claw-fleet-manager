import type { DeploymentBackend } from './backend.js';
import {
  fetchInstanceSessions,
  type FetchInstanceSessionsOptions,
  type InstanceSessionPreviewItem,
  type InstanceSessionRow,
} from './openclaw-client.js';
import type { FleetInstance } from '../types.js';

type SessionBackend = Pick<DeploymentBackend, 'execInstanceCommand' | 'revealToken'>;
type GatewaySessionFetcher = typeof fetchInstanceSessions;

const DEFAULT_ACTIVE_MINUTES = 60;
const SESSION_STATUSES = new Set(['running', 'done', 'failed', 'killed', 'timeout']);

function parseCliJson(stdout: string): Record<string, unknown> {
  const ansiStripped = stdout.replace(/\u001b\[[0-9;]*m/g, '');
  const jsonStart = ansiStripped.indexOf('{');
  if (jsonStart < 0) {
    throw new Error('CLI did not return JSON output');
  }
  const parsed = JSON.parse(ansiStripped.slice(jsonStart)) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('CLI did not return a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function statusField(value: unknown): InstanceSessionRow['status'] | undefined {
  return typeof value === 'string' && SESSION_STATUSES.has(value)
    ? value as InstanceSessionRow['status']
    : undefined;
}

function normalizePreviewLimit(value: number | undefined): number {
  return Math.max(0, Math.min(Math.trunc(value ?? 0), 8));
}

function previewItemsField(value: unknown, previewLimit: number): InstanceSessionPreviewItem[] | undefined {
  if (!Array.isArray(value) || previewLimit <= 0) return undefined;
  const items = value.flatMap((item) => {
    const record = asRecord(item);
    const role = stringField(record?.role);
    const text = stringField(record?.text);
    return role && text ? [{ role, text }] : [];
  }).slice(-previewLimit);
  return items.length > 0 ? items : undefined;
}

function parseCliSessionRow(value: unknown, previewLimit: number): InstanceSessionRow | null {
  const row = asRecord(value);
  const key = stringField(row?.key);
  if (!row || !key) return null;

  const session: InstanceSessionRow = { key };
  const stringFields = [
    'label',
    'displayName',
    'derivedTitle',
    'lastMessagePreview',
    'model',
    'modelProvider',
    'kind',
  ] as const;
  for (const field of stringFields) {
    const value = stringField(row[field]);
    if (value) session[field] = value;
  }

  const status = statusField(row.status);
  if (status) session.status = status;

  const previewItems = previewItemsField(row.previewItems, previewLimit);
  if (previewItems) session.previewItems = previewItems;

  const numberFields = [
    'startedAt',
    'endedAt',
    'runtimeMs',
    'inputTokens',
    'outputTokens',
    'totalTokens',
    'estimatedCostUsd',
    'updatedAt',
  ] as const;
  for (const field of numberFields) {
    const value = numberField(row[field]);
    if (value !== undefined) session[field] = value;
  }

  return session;
}

function parseCliSessions(stdout: string, options?: FetchInstanceSessionsOptions): InstanceSessionRow[] {
  const payload = parseCliJson(stdout);
  const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
  const previewLimit = normalizePreviewLimit(options?.previewLimit);
  const rows = sessions.flatMap((item) => {
    const row = parseCliSessionRow(item, previewLimit);
    return row ? [row] : [];
  });
  return options?.status
    ? rows.filter((session) => session.status === options.status)
    : rows;
}

async function fetchDockerInstanceSessions(
  instance: Pick<FleetInstance, 'id'>,
  backend: Pick<DeploymentBackend, 'execInstanceCommand'>,
  options?: FetchInstanceSessionsOptions,
): Promise<InstanceSessionRow[]> {
  const activeMinutes = Math.max(1, Math.trunc(options?.activeMinutes ?? DEFAULT_ACTIVE_MINUTES));
  const stdout = await backend.execInstanceCommand(instance.id, [
    'sessions',
    '--json',
    '--active',
    String(activeMinutes),
    '--limit',
    'all',
  ]);
  return parseCliSessions(stdout, options);
}

export async function fetchInstanceSessionsForBackend(
  instance: Pick<FleetInstance, 'id' | 'mode' | 'port'>,
  backend: SessionBackend,
  options?: FetchInstanceSessionsOptions,
  fetchViaGateway: GatewaySessionFetcher = fetchInstanceSessions,
  timeoutMs = 5_000,
): Promise<InstanceSessionRow[]> {
  if (instance.mode === 'docker') {
    return fetchDockerInstanceSessions(instance, backend, options);
  }

  const token = await backend.revealToken(instance.id);
  return fetchViaGateway(instance.port, token, timeoutMs, options);
}
