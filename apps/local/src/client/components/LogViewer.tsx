'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';

import { LogLineContent } from '../LogLineContent';
import { useStickToBottomScroll } from '../hooks/useStickToBottomScroll';
import type { LogLine } from '../../shared/protocol';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false });
}

export function LogViewer({ logLines, processId }: { logLines: LogLine[]; processId: string }) {
  const {
    scrollRef,
    isPinned,
    hasUnseenBelow,
    isAtTop,
    scrollToEnd,
    handleScroll,
    jumpToNew,
    jumpToTop,
  } = useStickToBottomScroll(logLines.length, processId);

  const virtualizer = useVirtualizer({
    count: logLines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 22,
    overscan: 30,
  });

  useEffect(() => {
    if (!isPinned || logLines.length === 0) return;
    virtualizer.scrollToIndex(logLines.length - 1, { align: 'end' });
  }, [logLines.length, isPinned, virtualizer]);

  useEffect(() => {
    if (logLines.length > 0) scrollToEnd();
  }, [processId]); // eslint-disable-line react-hooks/exhaustive-deps

  const logContainerRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      const selection = window.getSelection();
      if (!selection || !logContainerRef.current) return;
      const range = document.createRange();
      range.selectNodeContents(logContainerRef.current);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }, []);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    container.addEventListener('keydown', handleKeyDown);
    return () => container.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (logLines.length === 0) {
    return (
      <div className="flex h-full items-center justify-center overflow-y-auto text-sm text-chatroom-text-muted">
        No logs yet — waiting for process output...
      </div>
    );
  }

  const showJumpToBottom = !isPinned;
  const showJumpToTop = !isAtTop;

  const handleJumpToBottom = () => {
    if (logLines.length > 0) {
      virtualizer.scrollToIndex(logLines.length - 1, { align: 'end' });
    }
    jumpToNew();
  };

  const handleJumpToTop = () => {
    if (logLines.length > 0) {
      virtualizer.scrollToIndex(0, { align: 'start' });
    }
    jumpToTop();
  };

  return (
    <div className="relative h-full min-h-0">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto font-mono text-xs focus-visible:outline focus-visible:outline-1 focus-visible:outline-chatroom-status-info"
        tabIndex={0}
        role="log"
        aria-label="Process logs"
      >
        <div
          ref={logContainerRef}
          style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative', width: '100%' }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const line = logLines[virtualRow.index];
            return (
              <div
                key={`${line.timestamp}-${virtualRow.index}`}
                className={cn(
                  'px-4 py-[1px] leading-5',
                  line.stream === 'stderr'
                    ? 'text-chatroom-status-error'
                    : 'text-chatroom-text-primary'
                )}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <span className="mr-2 select-none text-chatroom-text-muted">
                  {formatTime(line.timestamp)}
                </span>
                <Badge
                  variant="outline"
                  className="mr-2 w-12 rounded-none px-0 text-center text-[10px] font-bold uppercase leading-none"
                >
                  {line.stream === 'stdout' ? 'OUT' : 'ERR'}
                </Badge>
                <LogLineContent text={line.text} />
              </div>
            );
          })}
        </div>
      </div>
      {showJumpToTop && (
        <button
          type="button"
          onClick={handleJumpToTop}
          className="absolute right-4 top-4 z-10 flex items-center gap-1.5 px-3 py-1.5 bg-chatroom-accent text-chatroom-text-on-accent shadow-lg hover:bg-chatroom-accent/90 transition-all"
          aria-label="Jump to top"
        >
          <ChevronUp size={16} />
          <span className="text-xs font-medium">Jump to top</span>
        </button>
      )}
      {showJumpToBottom && (
        <button
          type="button"
          onClick={handleJumpToBottom}
          className="absolute right-4 bottom-4 z-10 flex items-center gap-1.5 px-3 py-1.5 bg-chatroom-accent text-chatroom-text-on-accent shadow-lg hover:bg-chatroom-accent/90 transition-all"
          aria-label={hasUnseenBelow ? 'Jump to new logs' : 'Jump to bottom'}
        >
          <ChevronDown size={16} />
          <span className="text-xs font-medium">
            {hasUnseenBelow ? 'Jump to new' : 'Jump to bottom'}
          </span>
        </button>
      )}
    </div>
  );
}
