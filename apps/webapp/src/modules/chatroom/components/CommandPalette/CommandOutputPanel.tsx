'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Square, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CommandOutputPanelProps {
  commandName: string;
  isRunning: boolean;
  output: string[];
  onStop: () => void;
  onRunAgain: () => void;
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CommandOutputPanel({
  commandName,
  isRunning,
  output,
  onStop,
  onRunAgain,
  onClose,
}: CommandOutputPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

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
      <div className="flex items-center justify-between px-4 py-3 border-b border-chatroom-border-strong bg-chatroom-bg-primary">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={cn(
              'w-2 h-2 rounded-full flex-shrink-0',
              isRunning
                ? 'bg-yellow-500 animate-pulse'
                : output.some((line) => line.toLowerCase().includes('error'))
                ? 'bg-red-500'
                : 'bg-green-500'
            )}
          />
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-bold uppercase tracking-wide text-chatroom-text-primary truncate">
              {commandName}
            </span>
            <span className="text-[10px] text-chatroom-text-muted">
              {isRunning ? 'Running...' : 'Completed'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {isRunning ? (
            <button
              type="button"
              onClick={onStop}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-red-600 hover:text-red-500 hover:bg-red-950/20 rounded-none transition-colors"
            >
              <Square size={12} className="fill-current" />
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={onRunAgain}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-chatroom-text-secondary hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover rounded-none transition-colors"
            >
              <RotateCcw size={12} />
              Run Again
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover rounded-none transition-colors"
            aria-label="Close output panel"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Output */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed bg-chatroom-bg-surface"
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
      <div className="px-4 py-2 border-t border-chatroom-border-strong bg-chatroom-bg-primary text-[10px] text-chatroom-text-muted flex justify-between items-center">
        <span>{output.length} lines</span>
        {!isAtBottom && output.length > 0 && (
          <span className="text-chatroom-text-muted italic">Scroll to follow</span>
        )}
      </div>
    </div>
  );
}
