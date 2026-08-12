import { useState } from 'react';

import { LogSourceSelect } from '@/components/logs/LogSourceSelect';
import { LogsPageHeader } from '@/components/logs/LogsPageHeader';
import { LogViewer } from '@/components/logs/LogViewer';
import { useDaemonLogs } from '@/hooks/use-daemon-logs';

export function LogsPage() {
  const [source, setSource] = useState<string>();
  const { lines, sources, isLoading, error } = useDaemonLogs(source);

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3 p-6">
      <LogsPageHeader
        actions={
          <LogSourceSelect
            sources={sources}
            value={source}
            onChange={setSource}
            disabled={isLoading}
          />
        }
      />
      <LogViewer lines={lines} isLoading={isLoading} error={error} />
    </section>
  );
}
