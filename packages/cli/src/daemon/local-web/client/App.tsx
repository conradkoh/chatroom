import { ConnectionStatus } from '@/components/layout/ConnectionStatus';
import { DaemonAppShell } from '@/components/layout/DaemonAppShell';
import { DaemonHeader } from '@/components/layout/DaemonHeader';
import { DaemonNav, NavTab } from '@/components/layout/DaemonNav';
import { useDaemonHealth } from '@/hooks/use-daemon-health';
import { LogsPage } from '@/modules/logs/LogsPage';

export function App() {
  const health = useDaemonHealth();

  return (
    <DaemonAppShell
      header={
        <DaemonHeader
          status={
            <ConnectionStatus
              isLoading={health.isLoading}
              isError={health.isError}
              port={health.data?.port}
              service={health.data?.service}
            />
          }
        />
      }
      nav={
        <DaemonNav>
          <NavTab active>Logs</NavTab>
        </DaemonNav>
      }
    >
      <LogsPage />
    </DaemonAppShell>
  );
}
