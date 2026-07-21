'use client';

import type { MessageViewMode } from '../../hooks/persistence/messageViewMode';
import {
  formatMessageViewRoleLabel,
  getMessageFilterRoles,
  messageViewModeTitle,
  roleToMessageViewMode,
} from '../../hooks/persistence/messageViewMode';

import { cn } from '@/lib/utils';

interface MessageViewToggleProps {
  mode: MessageViewMode;
  onChange: (mode: MessageViewMode) => void;
  teamRoles: string[];
  className?: string;
}

export function MessageViewToggle({
  mode,
  onChange,
  teamRoles,
  className,
}: MessageViewToggleProps) {
  const filterRoles = getMessageFilterRoles(teamRoles);
  const options: { value: MessageViewMode; label: string }[] = [
    { value: 'all', label: 'All' },
    ...filterRoles.map((role) => ({
      value: roleToMessageViewMode(role),
      label: formatMessageViewRoleLabel(role),
    })),
  ];

  return (
    <div
      className={cn(
        'inline-flex h-6 max-w-full shrink-0 items-center gap-0.5 overflow-x-auto overflow-y-hidden rounded-sm border border-chatroom-border bg-chatroom-bg-tertiary p-0.5',
        className
      )}
      role="tablist"
      aria-label="Message view"
      data-testid="message-view-toggle"
    >
      {options.map(({ value, label }) => {
        const selected = mode === value;
        return (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={selected}
            title={messageViewModeTitle(value)}
            onClick={() => onChange(value)}
            className={cn(
              'flex h-5 min-w-[2.75rem] shrink-0 items-center justify-center px-2 text-[10px] font-bold uppercase tracking-wide leading-none rounded-[2px] transition-colors',
              selected
                ? 'bg-chatroom-bg-primary text-chatroom-text-primary shadow-sm ring-1 ring-inset ring-chatroom-border-strong/60'
                : 'text-chatroom-text-muted hover:text-chatroom-text-secondary hover:bg-chatroom-bg-hover/60'
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
