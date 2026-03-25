// packages/web/src/components/layout/Sidebar.tsx
import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useFleet } from '../../hooks/useFleet';
import { useAppStore } from '../../store';
import { SidebarItem } from './SidebarItem';
import { AddProfileDialog } from '../instances/AddProfileDialog';
import { deleteProfile } from '../../api/fleet';

export function Sidebar() {
  const { data, isLoading, error } = useFleet();
  const selectedInstanceId = useAppStore((state) => state.selectedInstanceId);
  const selectInstance = useAppStore((state) => state.selectInstance);
  const queryClient = useQueryClient();
  const [showAddProfile, setShowAddProfile] = useState(false);

  useEffect(() => {
    if (!data?.instances.length || selectedInstanceId) return;
    selectInstance(data.instances[0].id);
  }, [data, selectInstance, selectedInstanceId]);

  const removeProfile = useMutation({
    mutationFn: (name: string) => deleteProfile(name),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['fleet'] }); },
  });

  const isProfileMode = data?.mode === 'profiles';

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
        {isProfileMode ? (
          <button className="primary-button" onClick={() => setShowAddProfile(true)}>
            + Add Profile
          </button>
        ) : null}
        <button className="secondary-button" onClick={() => selectInstance(null)}>
          Fleet Config
        </button>
      </div>

      {showAddProfile ? <AddProfileDialog onClose={() => setShowAddProfile(false)} /> : null}
    </aside>
  );
}
