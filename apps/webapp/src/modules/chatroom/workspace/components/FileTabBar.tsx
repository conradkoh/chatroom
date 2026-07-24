'use client';

import { Search } from 'lucide-react';
import { memo, useCallback } from 'react';

import { WorkspaceTabBarItem, WorkspaceTabBarShell } from './WorkspaceTabBar';
import { setWorkspaceTabDragData } from '../constants/workspaceTabDrag';
import { useWorkspaceFileContextMenu, useWorkspaceFileMenuContent } from '../file-menu';
import type { EditorTab } from '../hooks/useFileTabs';
import { editorTabKey } from '../hooks/useFileTabs';
import {
  fileTabDoubleClickExpandAction,
  previewTabDoubleClickAction,
} from '../utils/explorerExpandHandlers';

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
  onTogglePreviewExpanded?: (filePath: string) => void;
  onOpenFileOnRemote?: (filePath: string) => void;
  enableDragSplit?: boolean;
}

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
  onTogglePreviewExpanded,
  onOpenFileOnRemote,
  enableDragSplit = false,
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

  const handleDragStart = useCallback(
    (tabKey: string) => (event: React.DragEvent) => {
      setWorkspaceTabDragData(event.dataTransfer, tabKey);
    },
    []
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
              onTogglePreviewExpanded={onTogglePreviewExpanded}
              draggable={enableDragSplit}
              onDragStart={handleDragStart(key)}
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

interface FileTabItemProps {
  tab: EditorTab;
  tabKey: string;
  isActive: boolean;
  onActivate: (key: string) => void;
  onClose: (key: string) => void;
  onPin: (filePath: string) => void;
  onToggleExpanded?: (filePath: string) => void;
  onTogglePreviewExpanded?: (filePath: string) => void;
  onContextMenu?: (filePath: string, event: React.MouseEvent) => void;
  draggable?: boolean;
  onDragStart?: (event: React.DragEvent) => void;
}

// fallow-ignore-next-line complexity
const FileTabItem = memo(function FileTabItem({
  tab,
  tabKey,
  isActive,
  onActivate,
  onClose,
  onPin,
  onToggleExpanded,
  onTogglePreviewExpanded,
  onContextMenu,
  draggable = false,
  onDragStart,
}: FileTabItemProps) {
  const handleDoubleClick = useCallback(() => {
    if (tab.kind === 'file') {
      const action = fileTabDoubleClickExpandAction(tab.isPinned, tab.filePath);
      if (action.action === 'toggleEditorExpanded') {
        onToggleExpanded?.(action.filePath);
      } else {
        onPin(action.filePath);
      }
      return;
    }
    if (tab.kind === 'preview') {
      const action = previewTabDoubleClickAction('preview', tab.filePath);
      if (action?.action === 'togglePreviewExpanded') {
        onTogglePreviewExpanded?.(action.filePath);
      }
    }
  }, [onPin, onToggleExpanded, onTogglePreviewExpanded, tab]);

  const label = tab.name;
  const displayName =
    tab.kind === 'file'
      ? tab.filePath
      : tab.kind === 'preview' || tab.kind === 'table'
        ? tab.filePath
        : tabKey;

  return (
    <WorkspaceTabBarItem
      isActive={isActive}
      label={label}
      iconPath={
        tab.kind === 'file' || tab.kind === 'preview' || tab.kind === 'table'
          ? tab.filePath
          : undefined
      }
      icon={tab.kind === 'agentic-query' ? Search : undefined}
      title={displayName}
      italic={tab.kind === 'file' && !tab.isPinned}
      draggable={draggable}
      onDragStart={onDragStart}
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
