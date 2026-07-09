/**
 * ProcessList — shows running/recent processes with status and action buttons.
 * Part of the run-command vertical slice.
 */

'use client';

import { StatusIcon } from './StatusIcon';
import { StopRestartButtons } from './StopRestartButtons';
import type { CommandRun } from '../types/run';
import { isActiveRun } from '../utils/run-status';

interface ProcessListProps {
  title: string;
  runs: CommandRun[];
  onStop: (runId: string) => void;
  onSelect: (runId: string) => void;
  onRestart: (run: CommandRun) => void;
  selectedRunId: string | null;
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
        const active = isActiveRun(run.status);

        return (
          <div
            key={run._id}
            className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors ${
              isSelected ? 'bg-chatroom-bg-hover' : 'hover:bg-chatroom-bg-hover/50'
            }`}
            onClick={() => onSelect(run._id)}
          >
            <StatusIcon status={run.status} />

            <div className="flex-1 min-w-0">
              <div className="text-xs text-chatroom-text-primary truncate">{run.commandName}</div>
              {run.pid && <div className="text-[10px] text-chatroom-text-muted">PID {run.pid}</div>}
            </div>

            {/* Action buttons */}
            <div
              className="flex items-center gap-1 flex-shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <StopRestartButtons
                variant="icon"
                active={active}
                onStop={() => onStop(run._id)}
                onRestart={() => onRestart(run)}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
