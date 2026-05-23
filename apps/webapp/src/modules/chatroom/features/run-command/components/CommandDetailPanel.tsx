/**
 * CommandDetailPanel — shows detail, script, actions, and run history for a single command.
 * Part of the run-command vertical slice.
 */

'use client';

import { ChevronLeft } from 'lucide-react';
import type { RunnableCommand, CommandRun } from '../types/run';
import { isActiveRun } from '../utils/run-status';

interface CommandDetailPanelProps {
  command: RunnableCommand;
  isFavorite: boolean;
  runs: CommandRun[];
  onRun: () => void;
  onStop: (runId: string) => void;
  onSelectRun: (runId: string) => void;
  onToggleFavorite: () => void;
  onBack?: () => void;
}

export function CommandDetailPanel({
  command,
  isFavorite,
  runs,
  onRun,
  onStop,
  onSelectRun,
  onToggleFavorite,
  onBack,
}: CommandDetailPanelProps) {
  const runningInstances = runs.filter(
    (r) => r.commandName === command.name && isActiveRun(r.status)
  );
  const recentInstances = runs
    .filter((r) => r.commandName === command.name && !isActiveRun(r.status))
    .slice(0, 5);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onRun();
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden" onKeyDown={handleKeyDown} tabIndex={0}>
      {/* Header */}
      <div className="px-1.5 py-2 sm:px-4 sm:py-3 border-b border-chatroom-border">
        <div className="flex items-center gap-2">
          {onBack && (
            <button
              onClick={onBack}
              className="text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors flex-shrink-0"
            >
              <ChevronLeft size={18} />
            </button>
          )}
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-chatroom-text-primary">
              {command.name}
            </h3>
            <p className="text-xs text-chatroom-text-muted mt-0.5">Source: {command.source}</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 sm:space-y-4">
        {/* Script */}
        <div className="bg-black/60 rounded p-3">
          <code className="text-xs font-mono text-green-400 break-all">$ {command.script}</code>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={onRun}
            className="flex items-center gap-2 px-1.5 py-1.5 sm:px-4 sm:py-2 text-xs font-bold uppercase tracking-wider bg-blue-600 hover:bg-blue-700 text-white transition-colors"
          >
            ▶ {runningInstances.length > 0 ? 'Start New Instance' : 'Run'}
          </button>
          <button
            onClick={onToggleFavorite}
            className={`flex items-center gap-1 px-2.5 py-1.5 sm:px-3 sm:py-2 text-xs font-bold uppercase tracking-wider transition-colors ${
              isFavorite
                ? 'text-yellow-500 hover:bg-yellow-500/10'
                : 'text-chatroom-text-muted hover:bg-chatroom-bg-hover'
            }`}
          >
            {isFavorite ? '★ Favorited' : '☆ Favorite'}
          </button>
        </div>

        {/* Running Instances */}
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-chatroom-text-muted mb-2">
            Running Instances ({runningInstances.length})
          </h4>
          {runningInstances.length === 0 ? (
            <p className="text-xs text-chatroom-text-muted/50 italic">No running instances</p>
          ) : (
            <div className="space-y-1">
              {runningInstances.map((run) => (
                <div
                  key={run._id}
                  className="flex items-center gap-2 px-2 sm:px-3 py-1.5 bg-chatroom-bg-hover/30 hover:bg-chatroom-bg-hover transition-colors group"
                >
                  <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0 animate-pulse" />
                  <button
                    onClick={() => onSelectRun(run._id)}
                    className="flex-1 text-left text-xs text-chatroom-text-primary truncate"
                  >
                    PID {run.pid ?? '...'} — {run.status}
                  </button>
                  <button
                    onClick={() => onStop(run._id)}
                    className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-red-600 hover:bg-red-700 text-white transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                  >
                    Stop
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Runs */}
        {recentInstances.length > 0 && (
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-chatroom-text-muted mb-2">
              Recent Runs
            </h4>
            <div className="space-y-1">
              {recentInstances.map((run) => (
                <div
                  key={run._id}
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-chatroom-bg-hover/30 transition-colors"
                >
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      run.status === 'completed'
                        ? 'bg-chatroom-text-muted/50'
                        : run.status === 'failed'
                          ? 'bg-red-500'
                          : 'bg-yellow-500'
                    }`}
                  />
                  <button
                    onClick={() => onSelectRun(run._id)}
                    className="flex-1 text-left text-xs text-chatroom-text-muted truncate"
                  >
                    {run.status}
                    {run.exitCode !== undefined ? ` (exit ${run.exitCode})` : ''}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
