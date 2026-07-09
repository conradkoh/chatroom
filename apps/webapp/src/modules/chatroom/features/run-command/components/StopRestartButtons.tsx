'use client';

import { Square, RefreshCw } from 'lucide-react';

interface StopRestartButtonsProps {
  active: boolean;
  onStop: () => void;
  onRestart: () => void;
  /** 'labeled' = text+icon (OutputPanel/CommandOutputPanel); 'icon' = icon-only (ProcessList) */
  variant?: 'labeled' | 'icon';
  className?: string;
}

export function StopRestartButtons({
  active,
  onStop,
  onRestart,
  variant = 'labeled',
  className = '',
}: StopRestartButtonsProps) {
  if (variant === 'icon') {
    return (
      <div className={`flex items-center gap-1 flex-shrink-0 ${className}`}>
        <button
          type="button"
          onClick={onStop}
          disabled={!active}
          className="p-1.5 text-red-500 hover:bg-red-500/10 rounded transition-colors min-w-[32px] min-h-[32px] flex items-center justify-center disabled:opacity-40 disabled:pointer-events-none"
          title="Stop"
          aria-label="Stop"
        >
          <Square size={14} />
        </button>
        <button
          type="button"
          onClick={onRestart}
          className="p-1.5 text-blue-500 hover:bg-blue-500/10 rounded transition-colors min-w-[32px] min-h-[32px] flex items-center justify-center"
          title="Restart"
          aria-label="Restart"
        >
          <RefreshCw size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-1 flex-shrink-0 ${className}`}>
      <button
        type="button"
        onClick={onStop}
        disabled={!active}
        className="flex items-center gap-1 px-2 py-1 text-xs font-bold uppercase tracking-wider text-red-500 dark:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40 disabled:pointer-events-none"
      >
        <Square size={12} />
        Stop
      </button>
      <button
        type="button"
        onClick={onRestart}
        className="flex items-center gap-1 px-2 py-1 text-xs font-bold uppercase tracking-wider text-blue-500 dark:text-blue-400 hover:bg-blue-500/10 transition-colors"
      >
        <RefreshCw size={12} />
        Restart
      </button>
    </div>
  );
}
