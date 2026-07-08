'use client';

import { X } from 'lucide-react';
import { memo, type ReactNode } from 'react';

import { FileTypeIcon } from '../../components/FileSelector/fileIcons';

import { cn } from '@/lib/utils';

// ─── Shared header row ────────────────────────────────────────────────────────

/**
 * Fixed height for every workspace header row (tab bars, panel headers, toolbars).
 * Single source of truth — children center inside this box and cannot expand it.
 */
// fallow-ignore-next-line unused-export
export const WORKSPACE_HEADER_ROW_HEIGHT_CLASS = 'h-9';

/** Border/background/flex styling shared by tab bars and split-panel headers. */
// fallow-ignore-next-line unused-export
export const WORKSPACE_HEADER_ROW_BASE_CLASS =
  'shrink-0 flex box-border border-b-2 border-chatroom-border-strong bg-chatroom-bg-surface overflow-hidden';

/** Fixed-height header row for panel toolbars (content toolbar). */
// fallow-ignore-next-line unused-export
export const WORKSPACE_HEADER_ROW_CLASS = cn(
  WORKSPACE_HEADER_ROW_BASE_CLASS,
  WORKSPACE_HEADER_ROW_HEIGHT_CLASS,
  'items-center'
);

// ─── Shared container ─────────────────────────────────────────────────────────

const WORKSPACE_TAB_BAR_CLASS = cn(
  WORKSPACE_HEADER_ROW_BASE_CLASS,
  WORKSPACE_HEADER_ROW_HEIGHT_CLASS,
  'items-stretch flex-wrap overflow-x-hidden overflow-y-auto'
);

interface WorkspaceTabBarShellProps {
  testId?: string;
  children: ReactNode;
}

export const WorkspaceTabBarShell = memo(function WorkspaceTabBarShell({
  testId,
  children,
}: WorkspaceTabBarShellProps) {
  return (
    <div data-testid={testId} className={WORKSPACE_TAB_BAR_CLASS}>
      {children}
    </div>
  );
});

interface WorkspaceHeaderRowProps {
  testId?: string;
  className?: string;
  children: ReactNode;
}

/** Non-tab header row (e.g. content toolbar) — same fixed height as tab bar shells. */
export const WorkspaceHeaderRow = memo(function WorkspaceHeaderRow({
  testId,
  className,
  children,
}: WorkspaceHeaderRowProps) {
  return (
    <div data-testid={testId} className={cn(WORKSPACE_HEADER_ROW_CLASS, className)}>
      {children}
    </div>
  );
});

// ─── Shared tab item ──────────────────────────────────────────────────────────

export interface WorkspaceTabBarItemProps {
  isActive: boolean;
  label: string;
  iconPath: string;
  title: string;
  italic?: boolean;
  onClick: () => void;
  onDoubleClick?: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
  onClose: (event: React.MouseEvent) => void;
}

export const WorkspaceTabBarItem = memo(function WorkspaceTabBarItem({
  isActive,
  label,
  iconPath,
  title,
  italic = false,
  onClick,
  onDoubleClick,
  onContextMenu,
  onClose,
}: WorkspaceTabBarItemProps) {
  return (
    <div
      className={cn(
        'group flex h-full shrink-0 items-center gap-1.5 px-3 cursor-pointer select-none box-border',
        'border-r border-chatroom-border text-[13px] min-w-0 max-w-[180px]',
        'transition-colors duration-75',
        isActive
          ? 'bg-chatroom-bg-primary text-chatroom-text-primary border-b-2 border-b-chatroom-accent'
          : 'text-chatroom-text-secondary hover:bg-chatroom-bg-hover border-b-2 border-b-transparent'
      )}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      title={title}
    >
      <FileTypeIcon path={iconPath} className="w-4 h-4 shrink-0 text-chatroom-text-muted" />
      <span className={cn('truncate', italic && 'italic')}>{label}</span>
      <button
        type="button"
        className="ml-1 shrink-0 rounded-sm opacity-0 group-hover:opacity-100 hover:bg-chatroom-bg-hover transition-opacity cursor-pointer"
        onClick={onClose}
        title="Close"
      >
        <X size={14} className="text-chatroom-text-muted hover:text-chatroom-text-primary" />
      </button>
    </div>
  );
});
