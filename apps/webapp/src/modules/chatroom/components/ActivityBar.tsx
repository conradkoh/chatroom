'use client';

import { Files, MessagesSquare } from 'lucide-react';
import { memo } from 'react';

import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ActivityBarProps {
  /** Whether the file explorer panel is visible */
  explorerVisible: boolean;
  /** Toggle file explorer panel */
  onToggleExplorer: () => void;
  /** Whether the message feed panel is visible */
  messagesVisible: boolean;
  /** Toggle message feed panel */
  onToggleMessages: () => void;
}

interface ActivityBarItemProps {
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
  onClick: () => void;
}

// ─── ActivityBarItem ──────────────────────────────────────────────────────────

const ActivityBarItem = memo(function ActivityBarItem({
  icon,
  label,
  isActive,
  onClick,
}: ActivityBarItemProps) {
  return (
    <button
      className={cn(
        'relative w-full h-12 flex items-center justify-center cursor-pointer transition-colors duration-100',
        isActive
          ? 'text-chatroom-text-primary'
          : 'text-chatroom-text-muted hover:text-chatroom-text-primary'
      )}
      onClick={onClick}
      title={label}
    >
      {/* Active indicator — left border accent */}
      {isActive && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-chatroom-accent" />
      )}
      {icon}
    </button>
  );
});

// ─── ActivityBar ──────────────────────────────────────────────────────────────

export const ActivityBar = memo(function ActivityBar({
  explorerVisible,
  onToggleExplorer,
  messagesVisible,
  onToggleMessages,
}: ActivityBarProps) {
  return (
    <div className="shrink-0 w-12 bg-chatroom-bg-surface border-r-2 border-chatroom-border-strong flex flex-col items-center pt-1">
      <ActivityBarItem
        icon={<Files size={20} />}
        label={explorerVisible ? 'Hide explorer' : 'Show explorer'}
        isActive={explorerVisible}
        onClick={onToggleExplorer}
      />
      <ActivityBarItem
        icon={<MessagesSquare size={20} />}
        label={messagesVisible ? 'Hide messages' : 'Show messages'}
        isActive={messagesVisible}
        onClick={onToggleMessages}
      />
    </div>
  );
});
