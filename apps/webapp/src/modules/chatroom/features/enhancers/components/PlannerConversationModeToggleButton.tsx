// fallow-ignore-file complexity
'use client';

import type { ConversationMode } from '@workspace/shared/domain/conversation-mode';
import { Code2, MessageCircle, Settings2, Sparkles } from 'lucide-react';

import { getComposerPreflightShortcutLabel } from '../../../hooks/useComposerPreflightShortcut';

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';

export type TeamSupportState = 'loading' | 'supported' | 'unsupported';

interface PlannerConversationModeToggleButtonProps {
  mode: ConversationMode;
  isBusy: boolean;
  teamSupportState: TeamSupportState;
  onCycle: () => void;
  onConfigure: () => void;
  onUnsupportedClick: () => void;
}

function modeIcon(mode: ConversationMode) {
  switch (mode) {
    case 'chat':
      return <MessageCircle size={14} />;
    case 'code':
      return <Code2 size={14} />;
    case 'code:enhanced':
      return <Sparkles size={14} />;
  }
}

function modeLabel(mode: ConversationMode): string {
  switch (mode) {
    case 'chat':
      return 'Chat';
    case 'code':
      return 'Code';
    case 'code:enhanced':
      return 'Enhanced';
  }
}

function modeTitle(mode: ConversationMode, shortcut: string): string {
  switch (mode) {
    case 'chat':
      return `Mode: Chat — conversational answers, no code work (${shortcut}). Click to switch to Code.`;
    case 'code':
      return `Mode: Code — implement and delegate (${shortcut}). Click to switch to Enhanced.`;
    case 'code:enhanced':
      return `Mode: Enhanced — request-first planning input (${shortcut}). Click to switch to Chat.`;
  }
}

function barClass(mode: ConversationMode): string {
  return cn(
    'shrink-0 w-[3.75rem] px-0 py-2 sm:w-full sm:px-3 flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-wide transition-colors cursor-pointer',
    mode === 'code:enhanced'
      ? 'text-blue-500 dark:text-blue-400 bg-blue-500/10'
      : mode === 'chat'
        ? 'text-emerald-500 dark:text-emerald-400 bg-emerald-500/10'
        : 'text-chatroom-text-muted hover:bg-chatroom-bg-hover'
  );
}

const UNSUPPORTED_TITLE =
  'Enhancement provides request-first planning input for Solo and Duo teams.';

export function PlannerConversationModeToggleButton({
  mode,
  isBusy,
  teamSupportState,
  onCycle,
  onConfigure,
  onUnsupportedClick,
}: PlannerConversationModeToggleButtonProps) {
  const isUnsupported = teamSupportState === 'unsupported';
  const isLoading = teamSupportState === 'loading';
  const shortcut = getComposerPreflightShortcutLabel('M');

  const handleClick = () => {
    if (isLoading) return;
    if (isUnsupported) {
      onUnsupportedClick();
      return;
    }
    onCycle();
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <button
            type="button"
            className={cn(
              barClass(mode),
              (isUnsupported || isLoading) && 'opacity-50 cursor-default'
            )}
            title={isUnsupported ? UNSUPPORTED_TITLE : modeTitle(mode, shortcut)}
            aria-label={`Mode: ${modeLabel(mode)}`}
            aria-busy={isBusy || undefined}
            aria-disabled={isUnsupported || undefined}
            data-testid="planner-conversation-mode-toggle"
            onClick={handleClick}
          >
            {modeIcon(mode)}
            <span className="hidden sm:inline">{modeLabel(mode)}</span>
          </button>
        }
      />
      {teamSupportState === 'supported' && (
        <ContextMenuContent className="min-w-[160px] rounded-none">
          <ContextMenuItem
            className="rounded-none"
            onSelect={onConfigure}
            data-testid="planner-conversation-mode-configure"
          >
            <Settings2 size={14} />
            Configure
          </ContextMenuItem>
        </ContextMenuContent>
      )}
    </ContextMenu>
  );
}
