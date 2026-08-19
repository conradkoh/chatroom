import { LogsPageHeader } from '@/components/logs/LogsPageHeader';
import { EventStreamFiltersBar } from '@/components/event-stream/EventStreamFiltersBar';
import { EventStreamViewer } from '@/components/event-stream/EventStreamViewer';
import { useChatrooms } from '@/hooks/use-chatrooms';
import { useEventStream } from '@/hooks/use-event-stream';
import { useEventStreamUrl } from '@/hooks/use-event-stream-url';

export function EventStreamPage() {
  const { chatroomId, setChatroomId } = useEventStreamUrl();
  const chatroomsQuery = useChatrooms();
  const { entries, isLoading, error } = useEventStream(chatroomId);
  return <section className="flex min-h-0 flex-1 flex-col gap-3 p-6">
    <LogsPageHeader title="Event stream" actions={<EventStreamFiltersBar chatrooms={chatroomsQuery.data ?? []} chatroomsLoading={chatroomsQuery.isLoading} chatroomsError={chatroomsQuery.isError} values={{ chatroomId }} onChange={(v) => setChatroomId(v.chatroomId)} disabled={isLoading} />} />
    <div className="flex min-h-0 flex-1 gap-0"><EventStreamViewer entries={entries} isLoading={isLoading} error={error} hasChatroom={Boolean(chatroomId)} /></div>
  </section>;
}
