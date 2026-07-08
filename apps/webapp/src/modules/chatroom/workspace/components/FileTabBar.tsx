'use client';

import { Copy } from 'lucide-react';
import { memo, useCallback, useState } from 'react';

import { WorkspaceTabBarItem, WorkspaceTabBarShell } from './WorkspaceTabBar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import type { FileTab } from '../hooks/useFileTabs';
import { copyFullPathToClipboard, copyRelativePathToClipboard } from '../utils/clipboard';

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

  if (tabs.length === 0) return null;

  return (
    <>
      <WorkspaceTabBarShell testId="file-tab-bar">
        {tabs.map((tab) => (
          <FileTabItem
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
      </WorkspaceTabBarShell>

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
            onSelect={() =>
              contextMenuTarget && void copyRelativePathToClipboard(contextMenuTarget)
            }
          >
            <Copy className="mr-2 h-4 w-4" />
            Copy Relative Path
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              contextMenuTarget && void copyFullPathToClipboard(workingDir, contextMenuTarget)
            }
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

const FileTabItem = memo(function FileTabItem({
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
  const handleDoubleClick = useCallback(() => {
    if (tab.isPinned) {
      onToggleExpanded?.(tab.filePath);
    } else {
      onPin(tab.filePath);
    }
  }, [onPin, onToggleExpanded, tab.filePath, tab.isPinned]);

  return (
    <WorkspaceTabBarItem
      isActive={isActive}
      label={tab.name}
      iconPath={tab.name}
      title={tab.filePath}
      italic={!tab.isPinned}
      onClick={() => onActivate(tab.filePath)}
      onDoubleClick={handleDoubleClick}
      onContextMenu={(event) => onContextMenu(tab.filePath, event)}
      onClose={(event) => {
        event.stopPropagation();
        onClose(tab.filePath);
      }}
    />
  );
});
