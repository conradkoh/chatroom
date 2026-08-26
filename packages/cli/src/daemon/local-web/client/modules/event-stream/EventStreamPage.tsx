import { useEffect, useState } from 'react';

import type { EventStreamEntry } from '@/api/types';
import { EventStreamDetailPanel } from '@/components/event-stream/EventStreamDetailPanel';
import { EventStreamFiltersBar } from '@/components/event-stream/EventStreamFiltersBar';
import { EventStreamViewer } from '@/components/event-stream/EventStreamViewer';
import { LogsPageHeader } from '@/components/logs/LogsPageHeader';
import { useChatrooms } from '@/hooks/use-chatrooms';
import { useEventStream } from '@/hooks/use-event-stream';
import { useEventStreamFiltersFromUrl } from '@/hooks/use-event-stream-filters-url';

export function EventStreamPage() {
  const { filters, setFilters } = useEventStreamFiltersFromUrl();
  const chatroomsQuery = useChatrooms();
  const { entries, isLoading, error } = useEventStream(filters);
  const [selectedEntry, setSelectedEntry] = useState<EventStreamEntry | null>(null);
  useEffect(() => {
    setSelectedEntry(null);
  }, [filters.chatroomId, filters.timeRange, filters.fromMs, filters.toMs]);
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3 p-6">
      <LogsPageHeader
        title="Event stream"
        actions={
          <EventStreamFiltersBar
            chatrooms={chatroomsQuery.data ?? []}
            chatroomsLoading={chatroomsQuery.isLoading}
            chatroomsError={chatroomsQuery.isError}
            values={filters}
            onChange={setFilters}
            disabled={isLoading}
          />
        }
      />
      <div className="flex min-h-0 flex-1 gap-0">
        <div className="flex min-w-0 flex-1 flex-col">
          <EventStreamViewer
            key={[filters.chatroomId, filters.timeRange, filters.fromMs, filters.toMs].join(':')}
            entries={entries}
            isLoading={isLoading}
            error={error}
            hasChatroom={Boolean(filters.chatroomId)}
            selectedEntry={selectedEntry}
            onSelectEntry={setSelectedEntry}
          />
        </div>
        {selectedEntry && (
          <EventStreamDetailPanel entry={selectedEntry} onClose={() => setSelectedEntry(null)} />
        )}
      </div>
    </section>
  );
}
