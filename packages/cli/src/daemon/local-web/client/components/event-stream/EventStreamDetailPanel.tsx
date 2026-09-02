import { X } from 'lucide-react';

import { EventTypeBadge } from './EventTypeBadge';

import type { EventStreamEntry } from '@/api/types';
import { Button } from '@/components/ui/button';
import { formatLocalLogDateTime } from '@/lib/format-local-timestamp';

export function EventStreamDetailPanel({
  entry,
  onClose,
}: {
  entry: EventStreamEntry;
  onClose: () => void;
}) {
  const payload = entry.payload;
  return (
    <aside
      className="flex w-96 max-w-[40%] shrink-0 flex-col border-l border-chatroom-border bg-chatroom-bg-primary"
      role="dialog"
      aria-modal="true"
      aria-label="Event detail"
    >
      <div className="flex items-center justify-between border-b border-chatroom-border px-4 py-3">
        <h3 className="text-sm font-medium">Event detail</h3>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close detail panel">
          <X className="size-4" />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <EventTypeBadge type={entry.type} />
          <span className="text-chatroom-text-muted">
            {formatLocalLogDateTime(entry.timestamp)}
          </span>
        </div>
        <div className="space-y-1 text-chatroom-text-muted">
          <div>
            Type: <span className="text-chatroom-text-primary">{entry.type}</span>
          </div>
          <div>
            ID: <span className="text-chatroom-text-primary">{entry.id}</span>
          </div>
          {typeof payload.chatroomId === 'string' && (
            <div>
              Chatroom: <span className="text-chatroom-text-primary">{payload.chatroomId}</span>
            </div>
          )}
        </div>
        <div>
          <p className="mb-1 text-chatroom-text-muted">Payload</p>
          <pre className="whitespace-pre-wrap border border-chatroom-border bg-chatroom-bg-secondary p-2 font-mono text-[11px]">
            {JSON.stringify(payload, null, 2)}
          </pre>
        </div>
      </div>
    </aside>
  );
}
