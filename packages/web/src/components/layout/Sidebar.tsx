import { useEffect } from 'react';
import { useFleet } from '../../hooks/useFleet';
import { useAppStore } from '../../store';
import { SidebarItem } from './SidebarItem';

export function Sidebar() {
  const { data, isLoading, error } = useFleet();
  const selectedInstanceId = useAppStore((state) => state.selectedInstanceId);
  const selectInstance = useAppStore((state) => state.selectInstance);

  useEffect(() => {
    if (!data?.instances.length || selectedInstanceId) return;
    selectInstance(data.instances[0].id);
  }, [data, selectInstance, selectedInstanceId]);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <p className="pill">Fleet Manager</p>
        <h1 className="sidebar-title">Claw Fleet</h1>
        <p className="sidebar-subtitle">
          {data ? `${data.totalRunning}/${data.instances.length} running` : isLoading ? 'Loading fleet...' : 'Awaiting server'}
        </p>
        {error ? <p className="error-text">{error.message}</p> : null}
      </div>

      <nav className="sidebar-nav">
        <p className="sidebar-section">Instances</p>
        {data?.instances.map((instance) => (
          <SidebarItem
            key={instance.id}
            instance={instance}
            selected={instance.id === selectedInstanceId}
            onClick={() => selectInstance(instance.id)}
          />
        ))}
      </nav>

      <div className="sidebar-footer">
        <button className="secondary-button" onClick={() => selectInstance(null)}>
          Fleet Config
        </button>
      </div>
    </aside>
  );
}
