'use client';

import { X } from 'lucide-react';
import { memo, useCallback } from 'react';

import { FileTypeIcon } from '../../components/FileSelector/fileIcons';
import type { RightPaneTab } from '../hooks/useFileTabs';

import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RightPaneTabBarProps {
  tabs: RightPaneTab[];
  activeTabKey: string | null;
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const RightPaneTabBar = memo(function RightPaneTabBar({
  tabs,
  activeTabKey,
  onActivate,
  onClose,
}: RightPaneTabBarProps) {
  if (tabs.length === 0) return null;

  return (
    <div className="flex items-center border-b-2 border-chatroom-border-strong bg-chatroom-bg-surface overflow-x-auto shrink-0">
      {tabs.map((tab) => (
        <RightTabItem
          key={tab.key}
          tab={tab}
          isActive={tab.key === activeTabKey}
          onActivate={onActivate}
          onClose={onClose}
        />
      ))}
    </div>
  );
});

// ─── Single Tab ───────────────────────────────────────────────────────────────

const RightTabItem = memo(function RightTabItem({
  tab,
  isActive,
  onActivate,
  onClose,
}: {
  tab: RightPaneTab;
  isActive: boolean;
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
}) {
  const handleClick = useCallback(() => {
    onActivate(tab.key);
  }, [onActivate, tab.key]);

  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClose(tab.key);
    },
    [onClose, tab.key]
  );

  return (
    <div
      className={cn(
        'group flex items-center gap-1.5 px-3 py-1.5 cursor-pointer select-none',
        'border-r border-chatroom-border text-[13px] min-w-0 max-w-[220px]',
        'transition-colors duration-75',
        isActive
          ? 'bg-chatroom-bg-primary text-chatroom-text-primary border-b-2 border-b-chatroom-accent -mb-[2px]'
          : 'text-chatroom-text-secondary hover:bg-chatroom-bg-hover'
      )}
      onClick={handleClick}
      title={tab.filePath}
    >
      <FileTypeIcon path={tab.filePath} className="w-4 h-4 shrink-0 text-chatroom-text-muted" />
      <span className="truncate">{tab.name}</span>
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
