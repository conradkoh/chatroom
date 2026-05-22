/**
 * OutputPanel — terminal output viewer for the Process Manager right panel.
 */

'use client';

import { useEffect, useRef } from 'react';
import { Square, RefreshCw, Terminal } from 'lucide-react';
import type { CommandRun, OutputChunk } from '../../features/run-command/types/run';
import { StatusBadge } from '../../features/run-command/components/StatusBadge';
import { isActiveRun } from '../../features/run-command/utils/run-status';
import { TerminalView } from '../../features/run-command/components/TerminalView';

interface OutputPanelProps {
  run: CommandRun | null;
  chunks: OutputChunk[];
  onStop: () => void;
  onRestart: () => void;
  onClose?: () => void;
}

export function OutputPanel({ run, chunks, onStop, onRestart, onClose }: OutputPanelProps) {
  const scrollRef = useRef<HTMLPreElement>(null);
  const output = chunks.map((c) => c.content).join('');

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [output]);

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

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Output header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-chatroom-border">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-xs font-bold uppercase tracking-wider text-chatroom-text-primary truncate">
            {run.commandName}
          </span>
          <StatusBadge status={run.status} terminationReason={run.terminationReason} />
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {active ? (
            <button
              onClick={onStop}
              className="flex items-center gap-1 px-2 py-1 text-xs font-bold uppercase tracking-wider text-red-500 dark:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <Square size={12} />
              Stop
            </button>
          ) : (
            <button
              onClick={onRestart}
              className="flex items-center gap-1 px-2 py-1 text-xs font-bold uppercase tracking-wider text-blue-500 dark:text-blue-400 hover:bg-blue-500/10 transition-colors"
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

      {/* Terminal output */}
      <TerminalView
        ref={scrollRef}
        output={output}
        status={run.status}
        scriptHint={run.script}
      />
    </div>
  );
}
