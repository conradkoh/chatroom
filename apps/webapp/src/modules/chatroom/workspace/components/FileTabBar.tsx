'use client';

import { Copy, X } from 'lucide-react';
import { memo, useCallback, useState } from 'react';

import { FileTypeIcon } from '../../components/FileSelector/fileIcons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import type { FileTab } from '../hooks/useFileTabs';
import { copyTextToClipboard, joinWorkingDirPath } from '../utils/clipboard';

import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FileTabBarProps {
  tabs: FileTab[];
  activeTabPath: string | null;
  workingDir: string | null;
  onActivate: (filePath: string) => void;
  onClose: (filePath: string) => void;
  onCloseOthers: (filePath: string) => void;
  onPin: (filePath: string) => void;
  onToggleExpanded?: (filePath: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const FileTabBar = memo(function FileTabBar({
  tabs,
  activeTabPath,
  workingDir,
  onActivate,
  onClose,
  onCloseOthers,
  onPin,
  onToggleExpanded,
}: FileTabBarProps) {
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [contextMenuTarget, setContextMenuTarget] = useState<string | null>(null);
  const [contextMenuPoint, setContextMenuPoint] = useState({ x: 0, y: 0 });

  const openContextMenu = useCallback((filePath: string, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenuTarget(filePath);
    setContextMenuPoint({ x: event.clientX, y: event.clientY });
    setContextMenuOpen(true);
  }, []);

  const handleCloseOthers = useCallback(() => {
    if (contextMenuTarget) {
      onCloseOthers(contextMenuTarget);
    }
    setContextMenuOpen(false);
  }, [contextMenuTarget, onCloseOthers]);

  const copyRelativePath = useCallback(async (path: string) => {
    await copyTextToClipboard(path, 'Copied relative path');
  }, []);

  const copyFullPath = useCallback(
    async (path: string) => {
      if (!workingDir) return;
      await copyTextToClipboard(joinWorkingDirPath(workingDir, path), 'Copied full path');
    },
    [workingDir]
  );

  if (tabs.length === 0) return null;

  return (
    <>
      <div
        data-testid="file-tab-bar"
        className="flex flex-wrap items-center min-h-8 max-h-16 overflow-y-auto overflow-x-hidden box-border border-b-2 border-chatroom-border-strong bg-chatroom-bg-surface shrink-0"
      >
        {tabs.map((tab) => (
          <TabItem
            key={tab.filePath}
            tab={tab}
            isActive={tab.filePath === activeTabPath}
            onActivate={onActivate}
            onClose={onClose}
            onPin={onPin}
            onToggleExpanded={onToggleExpanded}
            onContextMenu={openContextMenu}
          />
        ))}
      </div>

      <DropdownMenu open={contextMenuOpen} onOpenChange={setContextMenuOpen} modal={false}>
        <DropdownMenuTrigger asChild>
          <span
            aria-hidden
            style={{
              position: 'fixed',
              left: contextMenuPoint.x,
              top: contextMenuPoint.y,
              width: 1,
              height: 1,
              pointerEvents: 'none',
            }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem
            onSelect={() => contextMenuTarget && void copyRelativePath(contextMenuTarget)}
          >
            <Copy className="mr-2 h-4 w-4" />
            Copy Relative Path
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => contextMenuTarget && void copyFullPath(contextMenuTarget)}
            disabled={!workingDir}
          >
            <Copy className="mr-2 h-4 w-4" />
            Copy Full Path
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handleCloseOthers} disabled={tabs.length <= 1}>
            Close Others
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
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
  onContextMenu,
}: {
  tab: FileTab;
  isActive: boolean;
  onActivate: (filePath: string) => void;
  onClose: (filePath: string) => void;
  onPin: (filePath: string) => void;
  onToggleExpanded?: (filePath: string) => void;
  onContextMenu: (filePath: string, event: React.MouseEvent) => void;
}) {
  const handleClick = useCallback(() => {
    onActivate(tab.filePath);
  }, [onActivate, tab.filePath]);

  const handleDoubleClick = useCallback(() => {
    if (tab.isPinned) {
      onToggleExpanded?.(tab.filePath);
    } else {
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

  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      onContextMenu(tab.filePath, event);
    },
    [onContextMenu, tab.filePath]
  );

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
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      title={tab.filePath}
    >
      <FileTypeIcon path={tab.name} className="w-4 h-4 shrink-0 text-chatroom-text-muted" />
      <span className={cn('truncate', !tab.isPinned && 'italic')}>{tab.name}</span>
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
