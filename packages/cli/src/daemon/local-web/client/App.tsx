import { ConnectionStatus } from '@/components/layout/ConnectionStatus';
import { DaemonAppShell } from '@/components/layout/DaemonAppShell';
import { DaemonHeader } from '@/components/layout/DaemonHeader';
import { DaemonNav, NavTab } from '@/components/layout/DaemonNav';
import { useAppUrl } from '@/hooks/use-app-url';
import { useDaemonHealth } from '@/hooks/use-daemon-health';
import { EventStreamPage } from '@/modules/event-stream/EventStreamPage';
import { LogsPage } from '@/modules/logs/LogsPage';

export function App() {
  const { activeTab, setActiveTab } = useAppUrl();
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
          <NavTab active={activeTab === 'logs'} onClick={() => setActiveTab('logs')}>
            Logs
          </NavTab>
          <NavTab
            active={activeTab === 'event-stream'}
            onClick={() => setActiveTab('event-stream')}
          >
            Event Stream
          </NavTab>
        </DaemonNav>
      }
    >
      {activeTab === 'logs' ? <LogsPage /> : <EventStreamPage />}
    </DaemonAppShell>
  );
}
