import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  columnLabelKey,
  formatCost,
  formatRelative,
  formatTokens,
  sessionTitle,
  sessionTimestamp,
  type BoardColumn,
} from './activityViewModel';

type ActivityBoardProps = {
  columns: BoardColumn[];
  errors: { instanceId: string; error: string }[];
  onSelectInstance: (id: string) => void;
};

const COLUMN_ORDER: BoardColumn['key'][] = ['running', 'done', 'failed', 'killedTimeout', 'other'];

export function ActivityBoard({ columns, errors, onSelectInstance }: ActivityBoardProps) {
  const { t } = useTranslation();
  const orderedColumns = useMemo(() => {
    const byKey = new Map(columns.map((column) => [column.key, column]));
    return COLUMN_ORDER.filter((key) => key !== 'other' || byKey.has('other')).map((key) => (
      byKey.get(key) ?? { key, rows: [] }
    ));
  }, [columns]);

  return (
    <div className="activity-board">
      {errors.length > 0 ? (
        <div className="activity-board-errors">
          {errors.map((entry) => (
            <div
              key={entry.instanceId}
              className="activity-board-error"
            >
              {`${entry.instanceId}: ${entry.error}`}
            </div>
          ))}
        </div>
      ) : null}

      <div className="activity-board-columns">
        {orderedColumns.map((column) => (
          <section key={column.key} className="activity-board-column">
            <header className="activity-board-column-header">
              <h3 className="activity-board-column-title">{t(columnLabelKey(column.key) as Parameters<typeof t>[0])}</h3>
              <span className="activity-board-column-count">{column.rows.length}</span>
            </header>

            {column.rows.length === 0 ? (
              <p className="activity-board-empty">{t('activityBoardEmpty')}</p>
            ) : (
              column.rows.map((row) => {
                const title = sessionTitle(row.session);
                const accessibleName = `${row.instanceId} ${title} ${row.session.key}`;

                return (
                  <button
                    key={`${row.instanceId}:${row.session.key}`}
                    type="button"
                    className="activity-board-card"
                    aria-label={accessibleName}
                    onClick={() => onSelectInstance(row.instanceId)}
                  >
                    <div className="activity-board-card-header">
                      <strong className="activity-board-card-instance">{row.instanceId}</strong>
                      <span className="activity-board-card-updated">{formatRelative(sessionTimestamp(row.session))}</span>
                    </div>
                    <div className="activity-board-card-title">{title}</div>
                    <div className="activity-board-card-preview">
                      {row.session.lastMessagePreview ?? '—'}
                    </div>
                    <div className="activity-board-card-meta">
                      <span>{formatTokens(row.session.totalTokens)}</span>
                      <span>{formatCost(row.session.estimatedCostUsd)}</span>
                      <span>{row.session.kind ?? '—'}</span>
                    </div>
                  </button>
                );
              })
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
