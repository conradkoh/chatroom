'use client';

import { X } from 'lucide-react';
import { memo, useCallback } from 'react';

import { FileTypeIcon } from '../../components/FileSelector/fileIcons';
import type { FileTab } from '../hooks/useFileTabs';

import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FileTabBarProps {
  tabs: FileTab[];
  activeTabPath: string | null;
  onActivate: (filePath: string) => void;
  onClose: (filePath: string) => void;
  onPin: (filePath: string) => void;
  onToggleExpanded?: (filePath: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const FileTabBar = memo(function FileTabBar({
  tabs,
  activeTabPath,
  onActivate,
  onClose,
  onPin,
  onToggleExpanded,
}: FileTabBarProps) {
  if (tabs.length === 0) return null;

  return (
    <div className="flex items-center border-b-2 border-chatroom-border-strong bg-chatroom-bg-surface overflow-x-auto shrink-0">
      {tabs.map((tab) => (
        <TabItem
          key={tab.filePath}
          tab={tab}
          isActive={tab.filePath === activeTabPath}
          onActivate={onActivate}
          onClose={onClose}
          onPin={onPin}
          onToggleExpanded={onToggleExpanded}
        />
      ))}
    </div>
  );
});

// ─── Single Tab ───────────────────────────────────────────────────────────────

const TabItem = memo(function TabItem({
  tab,
  isActive,
  onActivate,
  onClose,
  onPin,
  onToggleExpanded,
}: {
  tab: FileTab;
  isActive: boolean;
  onActivate: (filePath: string) => void;
  onClose: (filePath: string) => void;
  onPin: (filePath: string) => void;
  onToggleExpanded?: (filePath: string) => void;
}) {
  const handleClick = useCallback(() => {
    onActivate(tab.filePath);
  }, [onActivate, tab.filePath]);

  const handleDoubleClick = useCallback(() => {
    if (tab.isPinned) {
      // Already pinned — toggle expansion
      onToggleExpanded?.(tab.filePath);
    } else {
      // Not pinned yet — pin it
      onPin(tab.filePath);
    }
  }, [onPin, onToggleExpanded, tab.filePath, tab.isPinned]);

  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClose(tab.filePath);
    },
    [onClose, tab.filePath]
  );

  return (
    <div
      className={cn(
        'group flex items-center gap-1.5 px-3 py-1.5 cursor-pointer select-none',
        'border-r border-chatroom-border text-[13px] min-w-0 max-w-[180px]',
        'transition-colors duration-75',
        isActive
          ? 'bg-chatroom-bg-primary text-chatroom-text-primary border-b-2 border-b-chatroom-accent -mb-[2px]'
          : 'text-chatroom-text-secondary hover:bg-chatroom-bg-hover'
      )}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      title={tab.filePath}
    >
      <FileTypeIcon path={tab.name} className="w-4 h-4 shrink-0 text-chatroom-text-muted" />
      <span className={cn('truncate', !tab.isPinned && 'italic')}>
        {tab.name}
      </span>
      <button
        className="ml-1 shrink-0 rounded-sm opacity-0 group-hover:opacity-100 hover:bg-chatroom-bg-hover transition-opacity cursor-pointer"
        onClick={handleClose}
        title="Close"
      >
        <X size={14} className="text-chatroom-text-muted hover:text-chatroom-text-primary" />
      </button>
    </div>
  );
});
