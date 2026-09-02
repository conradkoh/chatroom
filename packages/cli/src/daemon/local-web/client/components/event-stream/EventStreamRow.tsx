import { EventTypeBadge } from './EventTypeBadge';

import type { EventStreamEntry } from '@/api/types';
import { summarizeEventPayload } from '@/domain/event-summary';

export function EventStreamRow({
  entry,
  selected,
  onSelect,
}: {
  entry: EventStreamEntry;
  selected?: boolean | undefined;
  onSelect?:( (entry: EventStreamEntry) => void) | undefined;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect?.(entry)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect?.(entry);
        }
      }}
      className={`flex items-center gap-3 border-b border-chatroom-border px-3 py-2 text-xs ${selected ? 'bg-chatroom-bg-hover' : 'hover:bg-chatroom-bg-hover'}`}
    >
      <span className="w-20 shrink-0 font-mono text-chatroom-text-muted">
        {new Date(entry.timestamp).toLocaleTimeString()}
      </span>
      <EventTypeBadge type={entry.type} />
      <span className="min-w-0 truncate text-chatroom-text-secondary">
        {summarizeEventPayload(entry.payload)}
      </span>
    </div>
  );
}
