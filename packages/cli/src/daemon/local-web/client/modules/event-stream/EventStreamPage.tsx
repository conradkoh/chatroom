import { useState } from 'react';

import { ChatroomSelect } from '@/components/logs/ChatroomSelect';
import { useChatrooms } from '@/hooks/use-chatrooms';
import { useEventStream } from '@/hooks/use-event-stream';

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

export function EventStreamPage() {
  const [chatroomId, setChatroomId] = useState<string>();
  const chatroomsQuery = useChatrooms();
  const { entries, isLoading, error } = useEventStream(chatroomId);

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium tracking-tight">Event Stream</h2>
          <p className="text-xs text-chatroom-text-muted">
            Migrated chatroom events captured by the daemon.
          </p>
        </div>
        <ChatroomSelect
          chatrooms={chatroomsQuery.data ?? []}
          isLoading={chatroomsQuery.isLoading}
          isError={chatroomsQuery.isError}
          value={chatroomId}
          onChange={setChatroomId}
          allowAll={false}
          disabled={isLoading}
        />
        {chatroomId && !isLoading && !error && (
          <span className="text-xs text-chatroom-text-muted">{entries.length} events</span>
        )}
      </div>

      <div className="min-h-[400px] flex-1 overflow-auto border border-chatroom-border bg-chatroom-bg-secondary font-mono text-xs">
        {isLoading && <p className="p-4 text-chatroom-text-muted">Loading event stream…</p>}
        {error && <p className="p-4 text-chatroom-status-error">{error}</p>}
        {!chatroomId && <p className="p-4 text-chatroom-text-muted">Select a chatroom to view events.</p>}
        {chatroomId && !isLoading && !error && entries.length === 0 && (
          <p className="p-4 text-chatroom-text-muted">No migrated events yet.</p>
        )}
        {!isLoading && !error && entries.length > 0 && (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-chatroom-bg-primary text-left text-chatroom-text-muted">
              <tr>
                <th className="border-b border-chatroom-border px-3 py-2 font-medium">Time</th>
                <th className="border-b border-chatroom-border px-3 py-2 font-medium">Type</th>
                <th className="border-b border-chatroom-border px-3 py-2 font-medium">Payload</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b border-chatroom-border align-top">
                  <td className="whitespace-nowrap px-3 py-2 text-chatroom-text-muted">
                    {formatTimestamp(entry.timestamp)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-chatroom-text-primary">
                    {entry.type}
                  </td>
                  <td className="whitespace-pre-wrap break-all px-3 py-2 text-chatroom-text-secondary">
                    {JSON.stringify(entry.payload, null, 2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
