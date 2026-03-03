'use client';

import { Loader2, Play, Square } from 'lucide-react';
import { memo } from 'react';

interface AgentActionButtonsProps {
  canStart: boolean;
  canStop: boolean;
  isStarting: boolean;
  isStopping: boolean;
  onStart: () => void;
  onStop: () => void;
}

/** Icon-only start/stop buttons for an agent row. */
export const AgentActionButtons = memo(function AgentActionButtons({
  canStart,
  canStop,
  isStarting,
  isStopping,
  onStart,
  onStop,
}: AgentActionButtonsProps) {
  return (
    <div className="flex items-center gap-1 flex-shrink-0">
      {/* Stop button */}
      {(canStop || isStopping) && (
        <button
          type="button"
          disabled={!canStop || isStopping}
          onClick={(e) => {
            e.stopPropagation();
            onStop();
          }}
          title={isStopping ? 'Stopping...' : 'Stop agent'}
          className="w-6 h-6 flex items-center justify-center flex-shrink-0 text-red-400 dark:text-red-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {isStopping ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Square size={12} fill="currentColor" />
          )}
        </button>
      )}

      {/* Start button */}
      {(canStart || isStarting) && (
        <button
          type="button"
          disabled={!canStart || isStarting}
          onClick={(e) => {
            e.stopPropagation();
            onStart();
          }}
          title={isStarting ? 'Starting...' : 'Start agent'}
          className="w-6 h-6 flex items-center justify-center flex-shrink-0 text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 hover:bg-blue-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {isStarting ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Play size={12} fill="currentColor" />
          )}
        </button>
      )}
    </div>
  );
});
