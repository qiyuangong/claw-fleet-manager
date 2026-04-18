import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { getFleetSessions, getFleetSessionsHistory } from '../api/fleet';
import type {
  FleetSessionsHistoryQuery,
  FleetSessionsHistoryResult,
  FleetSessionsHistoryStatus,
  InstanceSessionsEntry,
} from '../types';
import { useAppStore } from '../store';

const PAGE_LIMIT_CAP = 1000;
const MAX_PAGES = 10;

function visibleRefetchInterval(intervalMs: number): number | false {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    return false;
  }
  return intervalMs;
}

function mergeInstances(
  into: Map<string, InstanceSessionsEntry>,
  from: InstanceSessionsEntry[],
) {
  for (const entry of from) {
    const existing = into.get(entry.instanceId);
    if (!existing) {
      into.set(entry.instanceId, { ...entry, sessions: [...entry.sessions] });
      continue;
    }
    existing.sessions.push(...entry.sessions);
    if (entry.error && !existing.error) existing.error = entry.error;
  }
}

async function fetchAllHistoryPages(
  query: FleetSessionsHistoryQuery,
): Promise<FleetSessionsHistoryResult> {
  const pageLimit = Math.min(query.limit ?? PAGE_LIMIT_CAP, PAGE_LIMIT_CAP);
  const merged = new Map<string, InstanceSessionsEntry>();
  let cursor = query.cursor;
  let updatedAt = Date.now();
  let totalEstimate: number | undefined;
  let pages = 0;

  while (pages < MAX_PAGES) {
    const page = await getFleetSessionsHistory({
      ...query,
      limit: pageLimit,
      ...(cursor ? { cursor } : {}),
    });
    mergeInstances(merged, page.instances);
    updatedAt = page.updatedAt;
    if (page.totalEstimate != null) totalEstimate = page.totalEstimate;
    pages += 1;
    if (!page.nextCursor) return {
      instances: Array.from(merged.values()),
      updatedAt,
      ...(totalEstimate != null ? { totalEstimate } : {}),
    };
    cursor = page.nextCursor;
  }

  return {
    instances: Array.from(merged.values()),
    updatedAt,
    ...(totalEstimate != null ? { totalEstimate } : {}),
    nextCursor: cursor,
  };
}

function liveStatusFromHistoryStatus(
  status: FleetSessionsHistoryStatus | undefined,
): 'running' | 'done' | 'failed' | 'killed' | 'timeout' | undefined {
  if (!status) return undefined;
  if (status === 'active') return 'running';
  if (status === 'error') return undefined;
  return status;
}

function applyClientFilters(
  instances: InstanceSessionsEntry[],
  query: FleetSessionsHistoryQuery,
): InstanceSessionsEntry[] {
  const needle = query.q?.trim().toLowerCase();
  const errorStatuses = new Set(['failed', 'killed', 'timeout']);

  return instances
    .filter((entry) => !query.instanceId || entry.instanceId === query.instanceId)
    .map((entry) => ({
      ...entry,
      sessions: entry.sessions.filter((session) => {
        if (query.status === 'error' && !(session.status && errorStatuses.has(session.status))) {
          return false;
        }
        if (query.from != null && session.updatedAt != null && session.updatedAt < query.from) {
          return false;
        }
        if (query.to != null && session.updatedAt != null && session.updatedAt > query.to) {
          return false;
        }
        if (!needle) return true;
        const haystacks = [
          entry.instanceId,
          session.key,
          session.label,
          session.displayName,
          session.derivedTitle,
          session.model,
          session.kind,
          session.lastMessagePreview,
        ];
        return haystacks.some((value) => value?.toLowerCase().includes(needle));
      }),
    }));
}

type UseFleetSessionsHistoryOptions = {
  query: FleetSessionsHistoryQuery;
  enabled?: boolean;
  refetchIntervalMs?: number;
};

export function useFleetSessionsHistory(options: UseFleetSessionsHistoryOptions) {
  const currentUser = useAppStore((state) => state.currentUser);
  const isAdmin = currentUser?.role === 'admin';
  const refetchIntervalMs = options.refetchIntervalMs ?? 15_000;
  const enabled = options.enabled ?? true;
  const [historyUnavailable, setHistoryUnavailable] = useState(false);

  const historyQuery = useQuery({
    queryKey: ['fleetSessionsHistory', options.query],
    queryFn: async () => {
      try {
        return await fetchAllHistoryPages(options.query);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          setHistoryUnavailable(true);
        }
        throw error;
      }
    },
    enabled: isAdmin && enabled && !historyUnavailable,
    retry: false,
    refetchInterval: () => visibleRefetchInterval(refetchIntervalMs),
  });

  const liveQuery = useQuery({
    queryKey: ['fleetSessionsHistoryFallback', liveStatusFromHistoryStatus(options.query.status)],
    queryFn: async (): Promise<FleetSessionsHistoryResult> => {
      const live = await getFleetSessions({
        status: liveStatusFromHistoryStatus(options.query.status),
        previewLimit: 0,
      });
      const instances = applyClientFilters(live.instances, options.query);
      return {
        instances,
        updatedAt: live.updatedAt,
      };
    },
    enabled: isAdmin && enabled && historyUnavailable,
    retry: false,
    refetchInterval: () => visibleRefetchInterval(refetchIntervalMs),
  });

  const active = historyUnavailable ? liveQuery : historyQuery;
  const is404 = historyQuery.error instanceof ApiError && historyQuery.error.status === 404;
  const isFallback = historyUnavailable || is404;

  return {
    ...active,
    historyDisabled: isFallback && liveQuery.isError,
    isFallback,
  };
}
