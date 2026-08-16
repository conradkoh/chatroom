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
      title={isActive ? 'Start in a new session' : 'Resume session'}
      className={cn(
        'w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wide transition-colors cursor-pointer',
        isActive
          ? 'text-blue-500 dark:text-blue-400 bg-blue-500/10'
          : 'text-chatroom-text-muted hover:bg-chatroom-bg-hover'
      )}
    >
      <RotateCcw size={14} />
      <span className="hidden sm:inline">{isActive ? 'New Session' : 'Resume Session'}</span>
    </button>
  );
}
