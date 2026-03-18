import type { FleetInstance } from '../../types';
import { StatusBadge } from '../common/StatusBadge';

interface Props {
  instance: FleetInstance;
  selected: boolean;
  onClick: () => void;
}

export function SidebarItem({ instance, selected, onClick }: Props) {
  return (
    <button className={`sidebar-item ${selected ? 'active' : ''}`} onClick={onClick}>
      <StatusBadge status={instance.status} />
      <div>
        <div className="mono">{instance.id}</div>
        <div className="muted" style={{ fontSize: '0.8rem' }}>{instance.health}</div>
      </div>
      <span className="sidebar-item-meta mono">:{instance.port}</span>
    </button>
  );
}
