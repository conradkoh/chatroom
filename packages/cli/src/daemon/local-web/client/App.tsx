import { useState } from 'react';

import { ConnectionStatus } from '@/components/layout/ConnectionStatus';
import { DaemonAppShell } from '@/components/layout/DaemonAppShell';
import { DaemonHeader } from '@/components/layout/DaemonHeader';
import { DaemonNav, NavTab } from '@/components/layout/DaemonNav';
import { useDaemonHealth } from '@/hooks/use-daemon-health';
import { LogsPage } from '@/modules/logs/LogsPage';
import { EventStreamPage } from '@/modules/event-stream/EventStreamPage';

export function App() {
  const [activeModule, setActiveModule] = useState<'logs' | 'event-stream'>('logs');
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
          <NavTab active={activeModule === 'logs'} onClick={() => setActiveModule('logs')}>
            Logs
          </NavTab>
          <NavTab
            active={activeModule === 'event-stream'}
            onClick={() => setActiveModule('event-stream')}
          >
            Event Stream
          </NavTab>
        </DaemonNav>
      }
    >
      {activeModule === 'logs' ? <LogsPage /> : <EventStreamPage />}
    </DaemonAppShell>
  );
}
