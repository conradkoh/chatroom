'use client';

import type { MessageViewMode } from '../../hooks/persistence/useMessageViewMode';

import { cn } from '@/lib/utils';

interface MessageViewToggleProps {
  mode: MessageViewMode;
  onChange: (mode: MessageViewMode) => void;
}

export function MessageViewToggle({ mode, onChange }: MessageViewToggleProps) {
  return (
    <div
      className="inline-flex border-2 border-chatroom-border-strong bg-chatroom-bg-tertiary"
      role="tablist"
      aria-label="Message view"
      data-testid="message-view-toggle"
    >
      {(['all', 'user-only'] as const).map((value) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={mode === value}
          onClick={() => onChange(value)}
          className={cn(
            'px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide transition-colors',
            mode === value
              ? 'bg-chatroom-accent text-chatroom-text-on-accent'
              : 'text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover'
          )}
        >
          {value === 'all' ? 'All messages' : 'My messages'}
        </button>
      ))}
    </div>
  );
}
