/**
 * ProcessList — shows running/recent processes with status and action buttons.
 */

'use client';

import { Square, RefreshCw, Loader2, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import type { CommandRun } from './ProcessManager';

interface ProcessListProps {
  title: string;
  runs: CommandRun[];
  onStop: (runId: string) => void;
  onSelect: (runId: string) => void;
  onRestart: (run: CommandRun) => void;
  selectedRunId: string | null;
}

function StatusIcon({ status }: { status: CommandRun['status'] }) {
  switch (status) {
    case 'pending':
      return <Loader2 size={12} className="animate-spin text-yellow-500" />;
    case 'running':
      return <Loader2 size={12} className="animate-spin text-blue-500" />;
    case 'completed':
      return <CheckCircle2 size={12} className="text-green-500" />;
    case 'failed':
      return <XCircle size={12} className="text-red-500" />;
    case 'stopped':
      return <AlertTriangle size={12} className="text-orange-500" />;
  }
}

export function ProcessList({
  title,
  runs,
  onStop,
  onSelect,
  onRestart,
  selectedRunId,
}: ProcessListProps) {
  return (
    <div className="border-b border-chatroom-border">
      {/* Section header */}
      <div className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-chatroom-text-muted bg-chatroom-bg-primary/50">
        {title}
      </div>

      {runs.map((run) => {
        const isSelected = run._id === selectedRunId;
        const isRunning = run.status === 'running' || run.status === 'pending';

        return (
          <div
            key={run._id}
            className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors ${
              isSelected
                ? 'bg-chatroom-bg-hover'
                : 'hover:bg-chatroom-bg-hover/50'
            }`}
            onClick={() => onSelect(run._id)}
          >
            <StatusIcon status={run.status} />

            <div className="flex-1 min-w-0">
              <div className="text-xs text-chatroom-text-primary truncate">
                {run.commandName}
              </div>
              {run.pid && (
                <div className="text-[10px] text-chatroom-text-muted">
                  PID {run.pid}
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-1 flex-shrink-0">
              {isRunning ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onStop(run._id);
                  }}
                  className="p-0.5 text-red-500 hover:bg-red-500/10 rounded transition-colors"
                  title="Stop"
                >
                  <Square size={10} />
                </button>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRestart(run);
                  }}
                  className="p-0.5 text-blue-500 hover:bg-blue-500/10 rounded transition-colors"
                  title="Restart"
                >
                  <RefreshCw size={10} />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
