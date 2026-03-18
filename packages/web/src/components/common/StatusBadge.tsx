export function StatusBadge({ status }: { status: string }) {
  return <span className={`status-dot status-${status}`} />;
}
