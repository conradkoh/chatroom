'use client';

import { Search } from 'lucide-react';
import { memo, useCallback } from 'react';

import { WorkspaceTabBarItem, WorkspaceTabBarShell } from './WorkspaceTabBar';
import { useWorkspaceFileContextMenu, useWorkspaceFileMenuContent } from '../file-menu';
import type { EditorTab } from '../hooks/useFileTabs';
import { editorTabKey } from '../hooks/useFileTabs';
import { fileTabDoubleClickExpandAction } from '../utils/explorerExpandHandlers';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FileTabBarProps {
  tabs: EditorTab[];
  activeTabKey: string | null;
  machineId: string | null;
  workingDir: string | null;
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
  onCloseOthers: (key: string) => void;
  onPin: (filePath: string) => void;
  onToggleExpanded?: (filePath: string) => void;
  onOpenFileOnRemote?: (filePath: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const FileTabBar = memo(function FileTabBar({
  tabs,
  activeTabKey,
  machineId,
  workingDir,
  onActivate,
  onClose,
  onCloseOthers,
  onPin,
  onToggleExpanded,
  onOpenFileOnRemote,
}: FileTabBarProps) {
  const { trackContextMenuFile, getMenuContentStateForPath } = useWorkspaceFileMenuContent(
    machineId,
    workingDir
  );
  const { openAtPointer, contextMenu } = useWorkspaceFileContextMenu(getMenuContentStateForPath);

  const handleCloseOthers = useCallback(
    (key: string) => {
      onCloseOthers(key);
    },
    [onCloseOthers]
  );

  if (tabs.length === 0) return null;

  return (
    <>
      <WorkspaceTabBarShell testId="file-tab-bar">
        {tabs.map((tab) => {
          const key = editorTabKey(tab);
          return (
            <FileTabItem
              key={key}
              tab={tab}
              tabKey={key}
              isActive={key === activeTabKey}
              onActivate={onActivate}
              onClose={onClose}
              onPin={onPin}
              onToggleExpanded={onToggleExpanded}
              onContextMenu={
                tab.kind === 'file'
                  ? (filePath, event) => {
                      trackContextMenuFile(filePath);
                      openAtPointer(event, {
                        state: { relativePath: filePath, workingDir },
                        handlers: {
                          onOpenFileOnRemote: onOpenFileOnRemote
                            ? () => void onOpenFileOnRemote(filePath)
                            : undefined,
                          onCloseOthers: () => handleCloseOthers(key),
                        },
                        visibility: {
                          copyFileName: true,
                          copyRelativePath: true,
                          copyFullPath: true,
                          copyFileContent: true,
                          openFileOnRemote: !!onOpenFileOnRemote,
                          closeOthers: true,
                          closeOthersDisabled: tabs.length <= 1,
                        },
                      });
                    }
                  : undefined
              }
            />
          );
        })}
      </WorkspaceTabBarShell>
      {contextMenu}
    </>
  );
});

// ─── Single Tab ───────────────────────────────────────────────────────────────

const FileTabItem = memo(function FileTabItem({
  tab,
  tabKey,
  isActive,
  onActivate,
  onClose,
  onPin,
  onToggleExpanded,
  onContextMenu,
}: {
  tab: EditorTab;
  tabKey: string;
  isActive: boolean;
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
  onPin: (filePath: string) => void;
  onToggleExpanded?: (filePath: string) => void;
  onContextMenu?: (filePath: string, event: React.MouseEvent) => void;
}) {
  const handleDoubleClick = useCallback(() => {
    if (tab.kind !== 'file') return;
    const action = fileTabDoubleClickExpandAction(tab.isPinned, tab.filePath);
    if (action.action === 'toggleEditorExpanded') {
      onToggleExpanded?.(action.filePath);
    } else {
      onPin(action.filePath);
    }
  }, [onPin, onToggleExpanded, tab]);

  const label = tab.kind === 'file' ? tab.name : tab.name;
  const displayName = tab.kind === 'file' ? tab.filePath : tabKey;

  return (
    <WorkspaceTabBarItem
      isActive={isActive}
      label={label}
      iconPath={tab.kind === 'file' ? tab.name : undefined}
      icon={tab.kind === 'agentic-query' ? Search : undefined}
      title={displayName}
      italic={tab.kind === 'file' && !tab.isPinned}
      onClick={() => onActivate(tabKey)}
      onDoubleClick={handleDoubleClick}
      onContextMenu={
        onContextMenu && tab.kind === 'file'
          ? (event) => onContextMenu(tab.filePath, event)
          : undefined
      }
      onClose={(event) => {
        event.stopPropagation();
        onClose(tabKey);
      }}
    />
  );
});
