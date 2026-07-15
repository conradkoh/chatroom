'use client';

import { memo, useCallback } from 'react';

import { WorkspaceTabBarItem, WorkspaceTabBarShell } from './WorkspaceTabBar';
import type { FileTab } from '../hooks/useFileTabs';
import { useWorkspaceFileContextMenu } from '../file-menu';
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
  const { openAtPointer, contextMenu } = useWorkspaceFileContextMenu();

  const handleCloseOthers = useCallback(
    (path: string) => {
      onCloseOthers(path);
    },
    [onCloseOthers]
  );

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
            onContextMenu={(filePath, event) => {
              openAtPointer(event, {
                state: { relativePath: filePath, workingDir },
                handlers: {
                  onOpenFileOnRemote: onOpenFileOnRemote
                    ? () => void onOpenFileOnRemote(filePath)
                    : undefined,
                  onCloseOthers: () => handleCloseOthers(filePath),
                },
                visibility: {
                  copyFileName: true,
                  copyRelativePath: true,
                  copyFullPath: true,
                  openFileOnRemote: !!onOpenFileOnRemote,
                  closeOthers: true,
                  closeOthersDisabled: tabs.length <= 1,
                },
              });
            }}
          />
        ))}
      </WorkspaceTabBarShell>
      {contextMenu}
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
