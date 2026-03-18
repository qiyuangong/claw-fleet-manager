import { FleetConfigPanel } from '../config/FleetConfigPanel';
import { InstancePanel } from '../instances/InstancePanel';
import { Sidebar } from './Sidebar';
import { useAppStore } from '../../store';

export function Shell() {
  const selectedInstanceId = useAppStore((state) => state.selectedInstanceId);

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-panel">
        {selectedInstanceId ? (
          <InstancePanel instanceId={selectedInstanceId} />
        ) : (
          <FleetConfigPanel />
        )}
      </main>
    </div>
  );
}
