import { useMemo, useState } from 'react';

import type { LogLine } from '@/api/types';
import { LogDetailPanel } from '@/components/logs/LogDetailPanel';
import type { LogFilterValues } from '@/components/logs/LogFiltersBar';
import { LogFiltersBar } from '@/components/logs/LogFiltersBar';
import { LogsPageHeader } from '@/components/logs/LogsPageHeader';
import { LogViewer } from '@/components/logs/LogViewer';
import { useChatrooms } from '@/hooks/use-chatrooms';
import { useDaemonLogs } from '@/hooks/use-daemon-logs';
import { getLogChatroomId } from '@/lib/log-line';
import { useLogFiltersFromUrl } from '@/hooks/use-log-filters-url';

export function LogsPage() {
  const { filters, setFilters } = useLogFiltersFromUrl();
  const [selectedLine, setSelectedLine] = useState<LogLine | null>(null);
  const chatroomsQuery = useChatrooms();
  const chatrooms = chatroomsQuery.data ?? [];
  const chatroomNameById = useMemo(
    () => new Map(chatrooms.map((c) => [c.id, c.displayName])),
    [chatrooms]
  );
  const { lines, dimensions, isLoading, error } = useDaemonLogs(filters);
  const getChatroomName = (id: string) => chatroomNameById.get(id);
  const selectedChatroomName = selectedLine
    ? getChatroomName(getLogChatroomId(selectedLine) ?? '')
    : undefined;
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3 p-6">
      <LogsPageHeader
        actions={
          <LogFiltersBar
            chatrooms={chatrooms}
            chatroomsLoading={chatroomsQuery.isLoading}
            roles={dimensions.roles}
            harnesses={dimensions.harnesses}
            values={filters}
            onChange={setFilters}
            disabled={isLoading}
          />
        }
      />
      <div className="flex min-h-0 flex-1 gap-0">
        <div className="flex min-w-0 flex-1 flex-col">
          <LogViewer
            lines={lines}
            isLoading={isLoading}
            error={error}
            autoScroll={!selectedLine}
            selectedLine={selectedLine}
            onSelectLine={setSelectedLine}
            getChatroomName={getChatroomName}
          />
        </div>
        {selectedLine && (
          <LogDetailPanel
            line={selectedLine}
            chatroomName={selectedChatroomName}
            onClose={() => setSelectedLine(null)}
          />
        )}
      </div>
    </section>
  );
}
