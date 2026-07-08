'use client';

import { X } from 'lucide-react';
import { memo, type ReactNode } from 'react';

import { FileTypeIcon } from '../../components/FileSelector/fileIcons';

import { cn } from '@/lib/utils';

// ─── Shared container ─────────────────────────────────────────────────────────

const WORKSPACE_TAB_BAR_CLASS =
  'flex flex-wrap items-center min-h-8 max-h-16 overflow-y-auto overflow-x-hidden box-border border-b-2 border-chatroom-border-strong bg-chatroom-bg-surface shrink-0';

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
        'group flex shrink-0 items-center gap-1.5 px-3 py-1.5 cursor-pointer select-none',
        'border-r border-chatroom-border text-[13px] min-w-0 max-w-[180px]',
        'transition-colors duration-75',
        isActive
          ? 'bg-chatroom-bg-primary text-chatroom-text-primary box-border border-b-2 border-b-chatroom-accent'
          : 'text-chatroom-text-secondary hover:bg-chatroom-bg-hover box-border border-b-2 border-b-transparent'
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
