'use client';

import { Play, RefreshCw, Square } from 'lucide-react';
import { memo } from 'react';

export interface RemoteAgentQuickActionsProps {
  hasRunningAgents: boolean;
  onStart?: () => void;
  onStop?: () => void;
  onRestart?: () => void;
  disabled?: boolean;
  isStarting?: boolean;
}

export const RemoteAgentQuickActions = memo(function RemoteAgentQuickActions({
  hasRunningAgents,
  onStart,
  onStop,
  onRestart,
  disabled = false,
  isStarting = false,
}: RemoteAgentQuickActionsProps) {
  const baseBtn =
    'w-5 h-5 flex items-center justify-center flex-shrink-0 rounded transition-colors disabled:opacity-50 disabled:pointer-events-none';

  if (hasRunningAgents) {
    return (
      <div className="flex items-center gap-0.5 flex-shrink-0">
        {onStop ? (
          <button
            type="button"
            onClick={onStop}
            disabled={disabled}
            title="Stop agents"
            aria-label="Stop agents"
            className={`${baseBtn} text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-500/10`}
          >
            <Square size={8} fill="currentColor" />
          </button>
        ) : null}
        {onRestart ? (
          <button
            type="button"
            onClick={onRestart}
            disabled={disabled}
            title="Restart agents"
            aria-label="Restart agents"
            className={`${baseBtn} text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 hover:bg-blue-500/10`}
          >
            <RefreshCw size={10} />
          </button>
        ) : null}
      </div>
    );
  }

  if (!onStart) return null;

  return (
    <button
      type="button"
      onClick={onStart}
      disabled={disabled || isStarting}
      aria-busy={isStarting}
      title="Start agents"
      aria-label="Start agents"
      className={`${baseBtn} text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 hover:bg-blue-500/10`}
    >
      <Play size={10} fill="currentColor" />
    </button>
  );
});
