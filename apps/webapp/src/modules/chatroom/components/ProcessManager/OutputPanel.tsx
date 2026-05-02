/**
 * OutputPanel — terminal output viewer for the Process Manager right panel.
 */

'use client';

import { Square, RefreshCw, Loader2, CheckCircle2, XCircle, AlertTriangle, Terminal } from 'lucide-react';
import { useEffect, useRef } from 'react';

import type { CommandRun, OutputChunk } from './ProcessManager';

interface OutputPanelProps {
  run: CommandRun | null;
  chunks: OutputChunk[];
  onStop: () => void;
  onRestart: () => void;
  onClose?: () => void;
}

function StatusBadge({ status }: { status: CommandRun['status'] }) {
  const configs = {
    pending: { icon: Loader2, text: 'Pending', color: 'text-yellow-500 dark:text-yellow-400', spin: true },
    running: { icon: Loader2, text: 'Running', color: 'text-blue-500 dark:text-blue-400', spin: true },
    completed: { icon: CheckCircle2, text: 'Completed', color: 'text-green-500 dark:text-green-400', spin: false },
    failed: { icon: XCircle, text: 'Failed', color: 'text-red-500 dark:text-red-400', spin: false },
    stopped: { icon: AlertTriangle, text: 'Stopped', color: 'text-orange-500 dark:text-orange-400', spin: false },
  };
  const config = configs[status];
  const Icon = config.icon;

  return (
    <span className={`flex items-center gap-1 ${config.color} text-xs font-bold uppercase tracking-wider`}>
      <Icon size={12} className={config.spin ? 'animate-spin' : ''} />
      {config.text}
    </span>
  );
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

  const isRunning = run.status === 'running' || run.status === 'pending';

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Output header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-chatroom-border">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-xs font-bold uppercase tracking-wider text-chatroom-text-primary truncate">
            {run.commandName}
          </span>
          <StatusBadge status={run.status} />
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {isRunning ? (
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
      <pre
        ref={scrollRef}
        className="flex-1 overflow-auto p-4 text-xs font-mono leading-relaxed text-green-400 dark:text-green-300 bg-black/90 whitespace-pre-wrap break-words"
      >
        <span className="text-chatroom-text-muted">$ {run.script}</span>
        {'\n'}
        {output || (run.status === 'pending' ? 'Waiting for process to start...\n' : '')}
        {isRunning && <span className="text-chatroom-text-muted animate-pulse">▌</span>}
      </pre>
    </div>
  );
}
