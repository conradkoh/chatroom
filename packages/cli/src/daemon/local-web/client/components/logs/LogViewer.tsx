import { useEffect, useRef } from 'react';

import { LogEmptyState } from './LogEmptyState';
import { LogErrorState } from './LogErrorState';
import { LogLineRow } from './LogLineRow';
import { LogLoadingSkeleton } from './LogLoadingSkeleton';

import type { LogLine } from '@/api/types';

type Props = { lines: LogLine[]; isLoading: boolean; error: string | null; autoScroll?: boolean };
export function LogViewer({ lines, isLoading, error, autoScroll = true }: Props) {
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
  if (lines.length === 0) return <LogEmptyState />;
  return (
    <div className="min-h-[400px] flex-1 overflow-auto border border-chatroom-border bg-chatroom-bg-secondary p-3 font-mono text-xs">
      {lines.map((line, index) => (
        <LogLineRow key={line.id ?? `${line.timestamp}-${index}`} line={line} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
