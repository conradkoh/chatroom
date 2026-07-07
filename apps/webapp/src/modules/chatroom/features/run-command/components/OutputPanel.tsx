/**
 * OutputPanel — terminal output viewer for the Processes panel right pane.
 * Part of the run-command vertical slice.
 */

'use client';

import { Square, RefreshCw, Terminal } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { StatusBadge } from './StatusBadge';
import { TerminalView } from './TerminalView';
import type { CommandRun, OutputChunk } from '../types/run';
import { isActiveRun } from '../utils/run-status';

const LOG_HEAD_LINE_COUNT = 100;

interface OutputPanelProps {
  run: CommandRun | null;
  chunks: OutputChunk[];
  onStop: () => void;
  onRestart: () => void;
  onClose?: () => void;
  onLoadMore?: () => void | Promise<void>;
  canLoadMore?: boolean;
  fullOutputPending?: boolean;
}

function formatLogHead(fullOutput: string): string {
  const lines = fullOutput.split('\n');
  if (lines.length <= LOG_HEAD_LINE_COUNT) return fullOutput;
  return `${lines.slice(0, LOG_HEAD_LINE_COUNT).join('\n')}\n… (${lines.length - LOG_HEAD_LINE_COUNT} more lines)`;
}

// fallow-ignore-next-line complexity
export function OutputPanel({
  run,
  chunks,
  onStop,
  onRestart,
  onClose,
  onLoadMore,
  canLoadMore = false,
  fullOutputPending = false,
}: OutputPanelProps) {
  const scrollRef = useRef<HTMLPreElement>(null);
  const [showLogHead, setShowLogHead] = useState(false);
  const [stickToBottom, setStickToBottom] = useState(true);
  const fullOutput = chunks.map((c) => c.content).join('');
  const output = showLogHead ? formatLogHead(fullOutput) : fullOutput;
  const lineCount = fullOutput.split('\n').length;
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

  if (!run) {
    return (
      <div className="flex-1 flex items-center justify-center text-chatroom-text-muted">
        <div className="text-center">
          <Terminal size={32} className="mx-auto mb-2 opacity-30" />
          <p className="text-xs uppercase tracking-wider font-bold">Select a command to run</p>
          <p className="text-[10px] mt-1">or click a running process to view output</p>
        </div>
      </div>
    );
  }

  const active = isActiveRun(run.status);
  const viewButtonClass = (selected: boolean) =>
    selected
      ? 'text-blue-500 dark:text-blue-400 bg-blue-500/10'
      : 'text-chatroom-text-muted hover:bg-chatroom-bg-hover';

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-chatroom-border">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-xs font-bold uppercase tracking-wider text-chatroom-text-primary truncate">
            {run.commandName}
          </span>
          <StatusBadge status={run.status} terminationReason={run.terminationReason} />
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
          {active ? (
            <button
              onClick={onStop}
              className="flex items-center gap-1 px-2 py-1 text-xs font-bold uppercase tracking-wider text-red-500 dark:text-red-400 hover:bg-red-500/10 transition-colors ml-1"
            >
              <Square size={12} />
              Stop
            </button>
          ) : (
            <button
              onClick={onRestart}
              className="flex items-center gap-1 px-2 py-1 text-xs font-bold uppercase tracking-wider text-blue-500 dark:text-blue-400 hover:bg-blue-500/10 transition-colors ml-1"
            >
              <RefreshCw size={12} />
              Restart
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="flex items-center gap-1 px-2 py-1 text-xs font-bold uppercase tracking-wider text-chatroom-text-muted hover:bg-chatroom-bg-hover transition-colors ml-1"
              title="Close output"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <TerminalView ref={scrollRef} output={output} status={run.status} scriptHint={run.script} />

      <div className="px-4 py-2 border-t border-chatroom-border bg-chatroom-bg-primary text-[10px] text-chatroom-text-muted flex justify-between items-center gap-2">
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
