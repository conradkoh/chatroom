'use client';

import { Copy, ExternalLink, ListX } from 'lucide-react';
import { memo, useCallback, useState } from 'react';

import { WorkspaceDropdownMenuItem } from './WorkspaceDropdownMenuItem';
import { WorkspaceTabBarItem, WorkspaceTabBarShell } from './WorkspaceTabBar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import type { FileTab } from '../hooks/useFileTabs';
import { copyFullPathToClipboard, copyRelativePathToClipboard } from '../utils/clipboard';
import { fileTabDoubleClickExpandAction } from '../utils/explorerExpandHandlers';

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
  onOpenFileOnRemote?: (filePath: string) => void;
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
  onOpenFileOnRemote,
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
          {onOpenFileOnRemote && contextMenuTarget && (
            <WorkspaceDropdownMenuItem
              icon={ExternalLink}
              onSelect={() => void onOpenFileOnRemote(contextMenuTarget)}
            >
              Open File on Remote
            </WorkspaceDropdownMenuItem>
          )}
          <WorkspaceDropdownMenuItem
            icon={Copy}
            onSelect={() =>
              contextMenuTarget && void copyRelativePathToClipboard(contextMenuTarget)
            }
          >
            Copy Relative Path
          </WorkspaceDropdownMenuItem>
          <WorkspaceDropdownMenuItem
            icon={Copy}
            onSelect={() =>
              contextMenuTarget && void copyFullPathToClipboard(workingDir, contextMenuTarget)
            }
            disabled={!workingDir}
          >
            Copy Full Path
          </WorkspaceDropdownMenuItem>
          <WorkspaceDropdownMenuItem
            icon={ListX}
            onSelect={handleCloseOthers}
            disabled={tabs.length <= 1}
          >
            Close Others
          </WorkspaceDropdownMenuItem>
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
    const action = fileTabDoubleClickExpandAction(tab.isPinned, tab.filePath);
    if (action.action === 'toggleEditorExpanded') {
      onToggleExpanded?.(action.filePath);
    } else {
      onPin(action.filePath);
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
