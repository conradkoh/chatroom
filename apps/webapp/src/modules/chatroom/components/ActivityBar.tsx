'use client';

import { Files, MessageCircle, MessagesSquare } from 'lucide-react';
import { memo } from 'react';
import { SiGithub } from 'react-icons/si';
import { VscSourceControl } from 'react-icons/vsc';

import { useCommandDialog } from '../context/CommandDialogContext';

import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActivityView =
  | 'explorer'
  | 'messages'
  | 'direct-harness'
  | 'source-control'
  | 'pull-requests';

interface ActivityBarProps {
  /** Currently active view */
  activeView: ActivityView;
  /** Called when a view icon is clicked */
  onViewChange: (view: ActivityView) => void;
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
 * Views (top to bottom):
 * 1. Explorer   — file browser
 * 2. Messages   — chatroom messages
 * 3. Direct Harness — direct AI harness
 * 4. Source Control — git diff + history (new)
 * 5. Pull Requests  — GitHub PR list (new)
 *
 * On mobile (hidden via CSS):
 * - Shows a chatroom switch trigger at the bottom
 */
export const ActivityBar = memo(function ActivityBar({
  activeView,
  onViewChange,
}: ActivityBarProps) {
  const { openDialog } = useCommandDialog();

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
      <ActivityBarItem
        icon={<MessageCircle size={20} />}
        label="Direct Harness"
        isActive={activeView === 'direct-harness'}
        onClick={() => onViewChange('direct-harness')}
      />
      <ActivityBarItem
        icon={<VscSourceControl size={20} />}
        label="Source Control"
        isActive={activeView === 'source-control'}
        onClick={() => onViewChange('source-control')}
      />
      <ActivityBarItem
        icon={<SiGithub size={20} />}
        label="Pull Requests"
        isActive={activeView === 'pull-requests'}
        onClick={() => onViewChange('pull-requests')}
      />

      {/* Spacer to push chatroom switch to bottom */}
      <div className="flex-1" />

      {/* Chatroom switch button */}
      <button
        className={cn(
          'relative w-full h-12 flex items-center justify-center cursor-pointer transition-colors duration-100',
          'text-chatroom-text-muted hover:text-chatroom-text-primary'
        )}
        onClick={() => openDialog('switcher')}
        title="Switch Chatroom"
      >
        <ChatroomSwitchIcon />
      </button>
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
