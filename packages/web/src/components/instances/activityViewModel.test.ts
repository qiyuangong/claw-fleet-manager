import { describe, expect, it } from 'vitest';
import {
  buildBoardColumns,
  buildFlatRows,
  filterRows,
  sortRows,
  summarizeRows,
  type FlatRow,
} from './activityViewModel';

const now = new Date('2026-04-12T10:00:00Z').getTime();

const rows: FlatRow[] = [
  {
    instanceId: 'alpha',
    session: {
      key: 'run-1',
      derivedTitle: 'Running task',
      status: 'running',
      totalTokens: 1200,
      estimatedCostUsd: 1.25,
      updatedAt: now - 5_000,
    },
  },
  {
    instanceId: 'beta',
    session: {
      key: 'done-1',
      derivedTitle: 'Finished task',
      status: 'done',
      totalTokens: 800,
      updatedAt: now - 60_000,
    },
  },
  {
    instanceId: 'gamma',
    session: {
      key: 'fail-1',
      derivedTitle: 'Broken task',
      status: 'failed',
      totalTokens: 20,
      updatedAt: now - 120_000,
    },
  },
  {
    instanceId: 'delta',
    session: {
      key: 'timeout-1',
      derivedTitle: 'Timed out task',
      status: 'timeout',
      updatedAt: now - 240_000,
    },
  },
];

describe('activityViewModel', () => {
  it('builds flat rows from fleet session entries', () => {
    expect(
      buildFlatRows([
        {
          instanceId: 'one',
          sessions: [
            { key: 'a' },
            { key: 'b' },
          ],
        },
      ]),
    ).toEqual([
      { instanceId: 'one', session: { key: 'a' } },
      { instanceId: 'one', session: { key: 'b' } },
    ]);
  });

  it('groups rows into board columns with killed and timeout merged', () => {
    const columns = buildBoardColumns(rows);
    expect(columns.map((column) => [column.key, column.rows.length])).toEqual([
      ['running', 1],
      ['done', 1],
      ['failed', 1],
      ['killedTimeout', 1],
    ]);
  });

  it('filters rows by status and time', () => {
    expect(filterRows(rows, 'active', 'all', now)).toHaveLength(1);
    expect(filterRows(rows, 'error', '24h', now)).toHaveLength(2);
  });

  it('sorts rows by updated descending by default', () => {
    expect(sortRows(rows, null, 'desc')[0]?.session.key).toBe('run-1');
    expect(sortRows(rows, 'tokens', 'desc')[0]?.session.key).toBe('run-1');
  });

  it('summarizes tokens and cost without NaN', () => {
    expect(summarizeRows(rows)).toEqual({
      totalSessions: 4,
      totalTokens: 2020,
      totalCost: 1.25,
      hasCostData: true,
    });
  });
});
