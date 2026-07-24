'use client';

import { Settings2, Sparkles } from 'lucide-react';

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';

interface PlannerEnhancerToggleButtonProps {
  isActive: boolean;
  isEnhancing: boolean;
  isDisabling: boolean;
  onToggle: () => void;
  onConfigure: () => void;
}

function barClass(isActive: boolean, isEnhancing: boolean): string {
  return cn(
    'w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wide transition-colors cursor-pointer',
    isActive
      ? 'text-blue-500 dark:text-blue-400 bg-blue-500/10'
      : 'text-chatroom-text-muted hover:bg-chatroom-bg-hover',
    isEnhancing && 'animate-pulse'
  );
}

export function PlannerEnhancerToggleButton({
  isActive,
  isEnhancing,
  isDisabling,
  onToggle,
  onConfigure,
}: PlannerEnhancerToggleButtonProps) {
  const label = isActive ? 'Enhancement Enabled' : 'Enhancement Disabled';

  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          className={barClass(isActive, isEnhancing)}
          title={
            isActive
              ? 'Enhancement enabled — click to turn off'
              : 'Enhancement disabled — click to turn on'
          }
          aria-label={label}
          aria-pressed={isActive}
          disabled={isDisabling}
          data-testid="planner-enhancer-toggle"
          onClick={onToggle}
        >
          <Sparkles size={14} />
          {label}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[160px] rounded-none">
        <ContextMenuItem
          className="rounded-none"
          onSelect={onConfigure}
          data-testid="planner-enhancer-configure"
        >
          <Settings2 size={14} />
          Configure
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
