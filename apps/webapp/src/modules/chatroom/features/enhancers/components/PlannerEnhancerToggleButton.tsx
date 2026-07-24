'use client';

import { Sparkles } from 'lucide-react';
import type { SyntheticEvent } from 'react';

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
  stopRowActivation: (e: SyntheticEvent) => void;
}

function toggleButtonClass(isActive: boolean, isEnhancing: boolean): string {
  return cn(
    'flex items-center justify-center w-7 h-7 shrink-0 rounded-none transition-colors',
    isActive
      ? 'text-chatroom-accent hover:bg-chatroom-bg-hover'
      : 'text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover',
    isEnhancing && 'animate-pulse'
  );
}

export function PlannerEnhancerToggleButton({
  isActive,
  isEnhancing,
  isDisabling,
  onToggle,
  onConfigure,
  stopRowActivation,
}: PlannerEnhancerToggleButtonProps) {
  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          className={toggleButtonClass(isActive, isEnhancing)}
          title={isActive ? 'Enhancer on — click to turn off' : 'Enhancer off — click to turn on'}
          aria-label={isActive ? 'Enhancer enabled' : 'Enhancer disabled'}
          aria-pressed={isActive}
          disabled={isDisabling}
          data-testid="planner-enhancer-toggle"
          onClick={(e) => {
            stopRowActivation(e);
            onToggle();
          }}
          onKeyDown={stopRowActivation}
        >
          <Sparkles size={14} />
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[160px] rounded-none" onClick={stopRowActivation}>
        <ContextMenuItem
          className="rounded-none"
          onSelect={onConfigure}
          data-testid="planner-enhancer-configure"
        >
          Configure
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
