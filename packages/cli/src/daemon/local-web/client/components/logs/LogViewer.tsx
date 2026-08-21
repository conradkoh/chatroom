import { useEffect, useRef } from 'react';

import { LogEmptyState } from './LogEmptyState';
import { LogErrorState } from './LogErrorState';
import { LogLineRow } from './LogLineRow';
import { LogLoadingSkeleton } from './LogLoadingSkeleton';

import type { LogLine } from '@/api/types';

type Props = {
  lines: LogLine[];
  isLoading: boolean;
  error: string | null;
  hasChatroom: boolean;
  autoScroll?: boolean;
  selectedLine?: LogLine | null;
  onSelectLine?: (line: LogLine) => void;
  getChatroomName?: (id: string) => string | undefined;
};
export function LogViewer({
  lines,
  isLoading,
  error,
  hasChatroom,
  autoScroll = true,
  selectedLine,
  onSelectLine,
  getChatroomName,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (autoScroll && !isLoading && !error && lines.length > 0)
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines.length, isLoading, error, autoScroll]);
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
    <div className="min-h-[400px] flex-1 overflow-auto border border-chatroom-border bg-chatroom-bg-secondary p-3 font-mono text-xs">
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
      <div ref={bottomRef} />
    </div>
  );
}
