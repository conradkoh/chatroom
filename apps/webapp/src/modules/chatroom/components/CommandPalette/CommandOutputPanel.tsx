'use client';

import { X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { AnsiText } from '@/modules/chatroom/features/run-command/components/AnsiText';
import { StatusBadge } from '@/modules/chatroom/features/run-command/components/StatusBadge';
import { StopRestartButtons } from '@/modules/chatroom/features/run-command/components/StopRestartButtons';
import type { CommandRun } from '@/modules/chatroom/features/run-command/types/run';
import {
  LOG_HEAD_LINE_COUNT,
  formatLogHeadFromLines,
} from '@/modules/chatroom/features/run-command/utils/log-head';
import { isActiveRun } from '@/modules/chatroom/features/run-command/utils/run-status';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CommandOutputPanelProps {
  commandName: string;
  status: CommandRun['status'] | null;
  terminationReason?: string | null;
  output: string[];
  onStop: () => void;
  onRunAgain: () => void;
  onClose: () => void;
  onLoadMore?: () => void;
  canLoadMore?: boolean;
  fullOutputPending?: boolean;
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
  onLoadMore,
  canLoadMore = false,
  fullOutputPending = false,
}: CommandOutputPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showLogHead, setShowLogHead] = useState(false);
  const [stickToBottom, setStickToBottom] = useState(true);

  const isActive = isActiveRun(status);
  const lineCount = output.length;
  const displayLines = showLogHead ? formatLogHeadFromLines(output).split('\n') : output;
  const showJumpToStart = !showLogHead && (lineCount > LOG_HEAD_LINE_COUNT || canLoadMore);

  useEffect(() => {
    if (showLogHead || !stickToBottom) return;
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [output, showLogHead, stickToBottom]);

  const handleShowLive = useCallback(() => {
    setShowLogHead(false);
    setStickToBottom(true);
  }, []);

  const handleShowLogHead = useCallback(async () => {
    setShowLogHead(true);
    if (canLoadMore && onLoadMore) await onLoadMore();
    scrollRef.current?.scrollTo({ top: 0 });
  }, [canLoadMore, onLoadMore]);

  const handleJumpToStart = useCallback(async () => {
    setShowLogHead(false);
    setStickToBottom(false);
    if (canLoadMore && onLoadMore) await onLoadMore();
    scrollRef.current?.scrollTo({ top: 0 });
  }, [canLoadMore, onLoadMore]);

  const viewButtonClass = (selected: boolean) =>
    selected
      ? 'text-blue-500 dark:text-blue-400 bg-blue-500/10'
      : 'text-chatroom-text-muted hover:bg-chatroom-bg-hover';

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
          <button
            type="button"
            onClick={handleShowLive}
            className={`px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${viewButtonClass(!showLogHead)}`}
          >
            Live
          </button>
          <button
            type="button"
            onClick={() => void handleShowLogHead()}
            disabled={fullOutputPending}
            className={`px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors disabled:opacity-50 ${viewButtonClass(showLogHead)}`}
          >
            Log head
          </button>
          <StopRestartButtons
            active={isActive}
            onStop={onStop}
            onRestart={onRunAgain}
            className="ml-1"
          />
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
        className="flex-1 overflow-auto overscroll-contain p-4 font-mono text-xs leading-relaxed bg-chatroom-bg-surface"
      >
        {displayLines.length === 0 ? (
          <span className="text-chatroom-text-muted italic">Waiting for output...</span>
        ) : (
          displayLines.map((line, index) => (
            <div key={index} className="whitespace-pre-wrap break-all text-chatroom-text-secondary">
              <AnsiText text={line} />
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t-2 border-chatroom-border-strong bg-chatroom-bg-primary text-[10px] text-chatroom-text-muted flex justify-between items-center gap-2">
        <span className="tabular-nums">
          {showLogHead
            ? `Showing first ${Math.min(lineCount, LOG_HEAD_LINE_COUNT)} of ${lineCount} lines`
            : `${lineCount} lines`}
        </span>
        {showJumpToStart && (
          <button
            type="button"
            onClick={() => void handleJumpToStart()}
            disabled={fullOutputPending}
            className="text-chatroom-status-info hover:text-chatroom-accent font-medium uppercase tracking-wide disabled:opacity-50"
          >
            {fullOutputPending ? 'Loading history…' : 'Jump to Start'}
          </button>
        )}
        {showLogHead && canLoadMore && onLoadMore && (
          <button
            type="button"
            onClick={() => void onLoadMore()}
            disabled={fullOutputPending}
            className="text-chatroom-status-info hover:text-chatroom-accent font-medium uppercase tracking-wide disabled:opacity-50"
          >
            {fullOutputPending ? 'Loading history…' : 'Reload history'}
          </button>
        )}
      </div>
    </div>
  );
}
