'use client';

import { Settings2, Sparkles } from 'lucide-react';

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';

export type TeamSupportState = 'loading' | 'supported' | 'unsupported';

interface PlannerEnhancerToggleButtonProps {
  isActive: boolean;
  isEnhancing: boolean;
  isDisabling: boolean;
  teamSupportState: TeamSupportState;
  onToggle: () => void;
  onConfigure: () => void;
  onUnsupportedClick: () => void;
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

const UNSUPPORTED_TITLE =
  'Enhancement supplements the planner workflow and requires a planner role (e.g. Duo team).';

export function PlannerEnhancerToggleButton({
  isActive,
  isEnhancing,
  isDisabling,
  teamSupportState,
  onToggle,
  onConfigure,
  onUnsupportedClick,
}: PlannerEnhancerToggleButtonProps) {
  const isUnsupported = teamSupportState === 'unsupported';
  const isLoading = teamSupportState === 'loading';

  const label = isUnsupported ? 'Enhancer' : 'Enhance';

  const handleClick = () => {
    if (isLoading) return;
    if (isUnsupported) {
      onUnsupportedClick();
      return;
    }
    onToggle();
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <button
            type="button"
            className={cn(
              barClass(isActive, isEnhancing),
              (isUnsupported || isLoading) && 'opacity-50 cursor-default'
            )}
            title={
              isUnsupported
                ? UNSUPPORTED_TITLE
                : isActive
                  ? 'Enhancement enabled — click to disable for the next message. Use ✕ on the enhancer task to cancel the active review.'
                  : 'Enhancement disabled — click to turn on'
            }
            aria-label={label}
            aria-pressed={isLoading ? undefined : isActive}
            aria-busy={isLoading || undefined}
            aria-disabled={isUnsupported || undefined}
            disabled={isDisabling && !isUnsupported}
            data-testid="planner-enhancer-toggle"
            onClick={handleClick}
          >
            <Sparkles size={14} />
            <span className="hidden sm:inline">{label}</span>
          </button>
        }
      />
      {teamSupportState === 'supported' && (
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
      )}
    </ContextMenu>
  );
}
