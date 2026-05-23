'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Square, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CommandRun } from '@/modules/chatroom/features/run-command/types/run';
import { StatusBadge } from '@/modules/chatroom/features/run-command/components/StatusBadge';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CommandOutputPanelProps {
  commandName: string;
  status: CommandRun['status'] | null;
  terminationReason?: string | null;
  output: string[];
  onStop: () => void;
  onRunAgain: () => void;
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CommandOutputPanel({
  commandName,
  status,
  terminationReason,
  output,
  onStop,
  onRunAgain,
  onClose,
}: CommandOutputPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  // A run is "active" (can be stopped) when pending or running
  const isActive = status === 'running' || status === 'pending';

  // Auto-scroll to bottom when new output arrives (if user is at bottom)
  useEffect(() => {
    if (scrollRef.current && isAtBottom) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [output, isAtBottom]);

  const handleScroll = () => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      const atBottom = scrollHeight - scrollTop - clientHeight < 10;
      setIsAtBottom(atBottom);
    }
  };

  return (
    <div className="flex flex-col h-full bg-chatroom-bg-surface border-l border-chatroom-border-strong">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b-2 border-chatroom-border-strong bg-chatroom-bg-primary">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-chatroom-text-primary truncate">
            {commandName}
          </span>
          {status && (
            <>
              <span className="w-1 h-1 bg-chatroom-text-muted flex-shrink-0" aria-hidden="true" />
              <StatusBadge
                status={status}
                terminationReason={terminationReason ?? undefined}
                variant="inline"
              />
            </>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {isActive ? (
            <button
              type="button"
              onClick={onStop}
              className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-red-600 hover:text-red-500 hover:bg-red-950/20 rounded-none transition-colors"
            >
              <Square size={14} className="fill-current" />
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={onRunAgain}
              aria-label="Run again"
              title="Run again"
              className="p-1.5 text-chatroom-text-muted hover:text-chatroom-text-primary rounded-none transition-colors"
            >
              <RotateCcw size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover rounded-none transition-colors"
            aria-label="Close output panel"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Output */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto overscroll-contain p-4 font-mono text-xs leading-relaxed bg-chatroom-bg-surface"
      >
        {output.length === 0 ? (
          <span className="text-chatroom-text-muted italic">Waiting for output...</span>
        ) : (
          output.map((line, index) => (
            <div
              key={index}
              className={cn(
                'whitespace-pre-wrap break-all',
                line.toLowerCase().includes('error')
                  ? 'text-red-400'
                  : line.toLowerCase().includes('warning')
                    ? 'text-yellow-400'
                    : 'text-chatroom-text-secondary'
              )}
            >
              {line}
            </div>
          ))
        )}
      </div>

      {/* Footer with scroll indicator */}
      <div className="px-4 py-2 border-t-2 border-chatroom-border-strong bg-chatroom-bg-primary text-[10px] text-chatroom-text-muted flex justify-between items-center">
        <span className="tabular-nums">{output.length} lines</span>
        {!isAtBottom && output.length > 0 && (
          <span className="text-chatroom-text-muted italic">Scroll to follow</span>
        )}
      </div>
    </div>
  );
}
