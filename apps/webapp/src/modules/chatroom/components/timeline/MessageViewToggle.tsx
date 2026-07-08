'use client';

import type { MessageViewMode } from '../../hooks/persistence/useMessageViewMode';

import { cn } from '@/lib/utils';

interface MessageViewToggleProps {
  mode: MessageViewMode;
  onChange: (mode: MessageViewMode) => void;
  className?: string;
}

const OPTIONS: { value: MessageViewMode; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'user-only', label: 'User' },
];

export function MessageViewToggle({ mode, onChange, className }: MessageViewToggleProps) {
  return (
    <div
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-0.5 rounded-sm border border-chatroom-border bg-chatroom-bg-tertiary p-0.5',
        className
      )}
      role="tablist"
      aria-label="Message view"
      data-testid="message-view-toggle"
    >
      {OPTIONS.map(({ value, label }) => {
        const selected = mode === value;
        return (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={selected}
            title={value === 'all' ? 'All messages' : 'User messages'}
            onClick={() => onChange(value)}
            className={cn(
              'flex h-5 min-w-[2.75rem] items-center justify-center px-2 text-[10px] font-bold uppercase tracking-wide leading-none rounded-[2px] transition-colors',
              selected
                ? 'bg-chatroom-bg-primary text-chatroom-text-primary shadow-sm ring-1 ring-chatroom-border-strong/60'
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
