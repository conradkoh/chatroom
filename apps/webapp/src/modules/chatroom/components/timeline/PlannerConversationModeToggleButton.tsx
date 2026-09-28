'use client';

import type { ConversationMode } from '@workspace/shared/domain/conversation-mode';
import { nextConversationMode } from '@workspace/shared/domain/conversation-mode';
import { Code2, MessageCircle, Sparkles } from 'lucide-react';

import { getComposerPreflightShortcutLabel } from '../../hooks/useComposerPreflightShortcut';

import { cn } from '@/lib/utils';

interface PlannerConversationModeToggleButtonProps {
  mode: ConversationMode;
  onCycle: () => void;
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
      return 'Enhance';
  }
}

function modeTitle(mode: ConversationMode, shortcut: string): string {
  const current = modeLabel(mode);
  const next = modeLabel(nextConversationMode(mode));
  return `Mode: ${current} — click or press ${shortcut} to switch to ${next}.`;
}

export function PlannerConversationModeToggleButton({
  mode,
  onCycle,
}: PlannerConversationModeToggleButtonProps) {
  const shortcut = getComposerPreflightShortcutLabel('M');
  return (
    <button
      type="button"
      className={cn(
        'shrink-0 w-[3.75rem] px-0 py-2 sm:w-full sm:px-3 flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-wide transition-colors cursor-pointer',
        mode === 'code:enhanced'
          ? 'text-blue-500 dark:text-blue-400 bg-blue-500/10'
          : 'text-chatroom-text-muted hover:bg-chatroom-bg-hover'
      )}
      title={modeTitle(mode, shortcut)}
      aria-label={`Mode: ${modeLabel(mode)}`}
      data-testid="planner-conversation-mode-toggle"
      onClick={onCycle}
    >
      {modeIcon(mode)}
      <span className="hidden sm:inline">{modeLabel(mode)}</span>
    </button>
  );
}
