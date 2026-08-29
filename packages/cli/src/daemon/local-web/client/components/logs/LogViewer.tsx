import { ChevronDown } from 'lucide-react';
import { useEffect } from 'react';

import { LogEmptyState } from './LogEmptyState';
import { LogErrorState } from './LogErrorState';
import { LogLineRow } from './LogLineRow';
import { LogLoadingSkeleton } from './LogLoadingSkeleton';
import { useStickToBottomScroll } from '../../hooks/useStickToBottomScroll';

import type { LogLine } from '@/api/types';

type Props = {
  lines: LogLine[];
  isLoading: boolean;
  error: string | null;
  hasChatroom: boolean;
  selectedLine?: LogLine | null;
  onSelectLine?: (line: LogLine) => void;
  getChatroomName?: (id: string) => string | undefined;
};
export function LogViewer({
  lines,
  isLoading,
  error,
  hasChatroom,
  selectedLine,
  onSelectLine,
  getChatroomName,
}: Props) {
  const { scrollRef, isPinned, hasUnseenBelow, scrollToEnd, handleScroll } = useStickToBottomScroll(
    lines.length
  );
  useEffect(() => {
    if (isPinned && !isLoading && !error && lines.length > 0) scrollToEnd('smooth');
  }, [lines.length, isPinned, isLoading, error, scrollToEnd]);
  if (isLoading)
    return (
      <div className="min-h-[400px] flex-1 border border-chatroom-border bg-chatroom-bg-secondary">
        <LogLoadingSkeleton />
      </div>
    );
  if (error) return <LogErrorState message={error} />;
  if (lines.length === 0) return <LogEmptyState hasChatroom={hasChatroom} />;
  const selectedKey = selectedLine
    ? (selectedLine.id ?? `${selectedLine.timestamp}-${selectedLine.message.slice(0, 32)}`)
    : null;
  return (
    <div className="relative min-h-[400px] flex-1">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-full overflow-auto border border-chatroom-border bg-chatroom-bg-secondary p-3 font-mono text-xs"
      >
        {lines.map((line, index) => {
          const key = line.id ?? `${line.timestamp}-${index}`;
          const lineKey = line.id ?? `${line.timestamp}-${line.message.slice(0, 32)}`;
          const chatroomId = line.metadata?.chatroomId;
          return (
            <LogLineRow
              key={key}
              line={line}
              chatroomName={
                typeof chatroomId === 'string' ? getChatroomName?.(chatroomId) : undefined
              }
              selected={selectedKey === lineKey}
              onSelect={onSelectLine}
            />
          );
        })}
      </div>
      {!isPinned && hasUnseenBelow && (
        <button
          type="button"
          onClick={() => scrollToEnd('smooth')}
          className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-md bg-chatroom-accent px-2 py-1 text-xs text-chatroom-bg-primary shadow"
        >
          <ChevronDown className="size-3" />
          Jump to new
        </button>
      )}
    </div>
  );
}
