'use client';

import { Files, MessagesSquare } from 'lucide-react';
import { memo } from 'react';

import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActivityView = 'explorer' | 'messages';

interface ActivityBarProps {
  /** Currently active view */
  activeView: ActivityView;
  /** Called when a view icon is clicked */
  onViewChange: (view: ActivityView) => void;
  /** Called when chatroom switch button is clicked (mobile only) */
  onOpenChatroomSwitcher?: () => void;
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

/**
 * Activity Bar component - VSCode-style icon sidebar.
 *
 * On mobile (hidden via CSS):
 * - Shows a chatroom switch trigger at the bottom
 *
 * On desktop:
 * - Shows Explorer and Messages view toggles
 */
export const ActivityBar = memo(function ActivityBar({
  activeView,
  onViewChange,
  onOpenChatroomSwitcher,
}: ActivityBarProps) {
  return (
    <div className="shrink-0 w-12 bg-chatroom-bg-surface border-r-2 border-chatroom-border-strong flex flex-col items-center pt-1">
      <ActivityBarItem
        icon={<Files size={20} />}
        label="Explorer"
        isActive={activeView === 'explorer'}
        onClick={() => onViewChange('explorer')}
      />
      <ActivityBarItem
        icon={<MessagesSquare size={20} />}
        label="Messages"
        isActive={activeView === 'messages'}
        onClick={() => onViewChange('messages')}
      />

      {/* Spacer to push chatroom switch to bottom */}
      <div className="flex-1" />

      {/* Chatroom switch button - visible only on mobile via CSS */}
      {onOpenChatroomSwitcher && (
        <button
          className={cn(
            'relative w-full h-12 flex items-center justify-center cursor-pointer transition-colors duration-100',
            'text-chatroom-text-muted hover:text-chatroom-text-primary',
            // Hide on desktop (md and up), show on mobile
            'flex md:hidden'
          )}
          onClick={onOpenChatroomSwitcher}
          title="Switch Chatroom"
        >
          <ChatroomSwitchIcon />
        </button>
      )}
    </div>
  );
});

// ─── Inline Chatroom Switch Icon ──────────────────────────────────────────────

/**
 * Inline SVG icon for chatroom switch (two overlapping squares).
 * Matches the visual language of the ActivityBar (Lucide-style).
 */
function ChatroomSwitchIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Back square */}
      <rect x="3" y="3" width="14" height="14" rx="2" opacity="0.5" />
      {/* Front square - offset to show "switch" concept */}
      <rect x="7" y="7" width="14" height="14" rx="2" />
    </svg>
  );
}
