'use client';

import { Play, RefreshCw, Square } from 'lucide-react';
import { memo } from 'react';

import { cn } from '@/lib/utils';

export interface RemoteAgentQuickActionsProps {
  hasRunningAgents: boolean;
  onStart?: () => void;
  onStop?: () => void;
  onRestart?: () => void;
  disabled?: boolean;
  isStarting?: boolean;
}

const baseBtn =
  'w-5 h-5 flex items-center justify-center flex-shrink-0 rounded transition-colors disabled:pointer-events-none';

export const RemoteAgentQuickActions = memo(function RemoteAgentQuickActions({
  hasRunningAgents,
  onStart,
  onStop,
  onRestart,
  disabled = false,
  isStarting = false,
}: RemoteAgentQuickActionsProps) {
  const startEnabled = !hasRunningAgents && !disabled && !!onStart;
  const stopEnabled = hasRunningAgents && !disabled && !!onStop;
  const restartEnabled = hasRunningAgents && !disabled && !!onRestart;

  const inactiveClass = 'text-chatroom-text-muted opacity-40';

  return (
    <div
      className="flex items-center justify-between w-[4.5rem] flex-shrink-0"
      data-testid="remote-agent-quick-actions"
    >
      <button
        type="button"
        onClick={onStart}
        disabled={!startEnabled || isStarting}
        aria-busy={isStarting}
        title="Start agents"
        aria-label="Start agents"
        className={cn(
          baseBtn,
          startEnabled
            ? 'text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 hover:bg-blue-500/10'
            : inactiveClass
        )}
      >
        <Play size={10} fill="currentColor" />
      </button>
      <button
        type="button"
        onClick={onStop}
        disabled={!stopEnabled}
        title="Stop agents"
        aria-label="Stop agents"
        className={cn(
          baseBtn,
          stopEnabled
            ? 'text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-500/10'
            : inactiveClass
        )}
      >
        <Square size={8} fill="currentColor" />
      </button>
      <button
        type="button"
        onClick={onRestart}
        disabled={!restartEnabled}
        title="Restart agents"
        aria-label="Restart agents"
        className={cn(
          baseBtn,
          restartEnabled
            ? 'text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 hover:bg-blue-500/10'
            : inactiveClass
        )}
      >
        <RefreshCw size={10} />
      </button>
    </div>
  );
});
