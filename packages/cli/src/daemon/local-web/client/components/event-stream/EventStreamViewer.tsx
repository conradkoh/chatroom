import { ChevronDown } from 'lucide-react';
import { useEffect } from 'react';

import { EventStreamEmptyState } from './EventStreamEmptyState';
import { EventStreamRow } from './EventStreamRow';
import { useStickToBottomScroll } from '../../hooks/useStickToBottomScroll';

import type { EventStreamEntry } from '@/api/types';
import { LogLoadingSkeleton } from '@/components/logs/LogLoadingSkeleton';

export function EventStreamViewer({
  entries,
  isLoading,
  error,
  hasChatroom,
  selectedEntry,
  onSelectEntry,
}: {
  entries: EventStreamEntry[];
  isLoading: boolean;
  error: string | null;
  hasChatroom: boolean;
  selectedEntry?: EventStreamEntry | null;
  onSelectEntry?: (entry: EventStreamEntry) => void;
}) {
  const { scrollRef, isPinned, hasUnseenBelow, scrollToEnd, handleScroll } = useStickToBottomScroll(
    entries.length
  );
  useEffect(() => {
    if (isPinned && !isLoading && !error && entries.length > 0) scrollToEnd('smooth');
  }, [entries.length, isPinned, isLoading, error, scrollToEnd]);
  if (isLoading)
    return (
      <div className="min-h-[400px] flex-1 border border-chatroom-border bg-chatroom-bg-secondary">
        <LogLoadingSkeleton />
      </div>
    );
  if (error)
    return (
      <div className="flex min-h-[400px] flex-1 items-center border border-chatroom-border bg-chatroom-bg-secondary p-4 text-chatroom-status-error">
        {error}
      </div>
    );
  if (!hasChatroom || entries.length === 0)
    return <EventStreamEmptyState hasChatroom={hasChatroom} />;
  return (
    <div className="relative min-h-[400px] flex-1">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-full overflow-auto border border-chatroom-border bg-chatroom-bg-secondary"
      >
        {entries.map((entry) => (
          <EventStreamRow
            key={entry.id}
            entry={entry}
            selected={selectedEntry?.id === entry.id}
            onSelect={onSelectEntry}
          />
        ))}
      </div>
      {!isPinned && hasUnseenBelow && (
        <button
          type="button"
          onClick={() => scrollToEnd('smooth')}
          className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-md bg-chatroom-accent px-2 py-1 text-xs text-chatroom-text-on-accent shadow"
        >
          <ChevronDown className="size-3" />
          Jump to new
        </button>
      )}
    </div>
  );
}
