'use client';
import { RotateCcw } from 'lucide-react';

import { cn } from '@/lib/utils';

export function PlannerNewSessionToggleButton({
  isActive,
  onToggle,
}: {
  isActive: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="planner-new-session-toggle"
      aria-pressed={isActive}
      onClick={onToggle}
      title={
        isActive
          ? 'New session enabled — click to disable (Alt+N)'
          : 'New session disabled — click to enable (Alt+N)'
      }
      className={cn(
        'shrink-0 w-[3.75rem] px-0 py-2 sm:w-full sm:px-3 flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-wide transition-colors cursor-pointer',
        isActive
          ? 'text-yellow-500 dark:text-yellow-400 bg-yellow-500/10'
          : 'text-chatroom-text-muted hover:bg-chatroom-bg-hover'
      )}
    >
      <RotateCcw size={14} />
      <span className="hidden sm:inline">New Session</span>
    </button>
  );
}
