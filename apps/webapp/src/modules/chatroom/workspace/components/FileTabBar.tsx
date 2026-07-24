'use client';

import { Search } from 'lucide-react';
import { memo, useCallback, useRef, useState } from 'react';

import { WorkspaceTabBarItem, WorkspaceTabBarShell } from './WorkspaceTabBar';
import { useWorkspaceFileContextMenu, useWorkspaceFileMenuContent } from '../file-menu';
import type { EditorTab } from '../hooks/useFileTabs';
import { editorTabKey } from '../hooks/useFileTabs';
import { fileTabDoubleClickExpandAction } from '../utils/explorerExpandHandlers';

import { cn } from '@/lib/utils';

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
  enableDragSplit?: boolean;
  onDropToSecondary?: (tabKey: string) => void;
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
  onOpenFileOnRemote,
  enableDragSplit = false,
  onDropToSecondary,
}: FileTabBarProps) {
  const { trackContextMenuFile, getMenuContentStateForPath } = useWorkspaceFileMenuContent(
    machineId,
    workingDir
  );
  const { openAtPointer, contextMenu } = useWorkspaceFileContextMenu(getMenuContentStateForPath);
  const [dragOver, setDragOver] = useState(false);
  const dragTabKeyRef = useRef<string | null>(null);

  const handleCloseOthers = useCallback(
    (key: string) => {
      onCloseOthers(key);
    },
    [onCloseOthers]
  );

  const handleDragStart = useCallback(
    (tabKey: string) => (event: React.DragEvent) => {
      dragTabKeyRef.current = tabKey;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', tabKey);
    },
    []
  );

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragOver(false);
      const tabKey = event.dataTransfer.getData('text/plain');
      if (tabKey && onDropToSecondary) {
        const tab = tabs.find((t) => editorTabKey(t) === tabKey);
        if (tab?.kind === 'file') {
          onDropToSecondary(tabKey);
        }
      }
      dragTabKeyRef.current = null;
    },
    [tabs, onDropToSecondary]
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
              draggable={enableDragSplit && tab.kind === 'file'}
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
        {enableDragSplit && (
          <div
            className={cn(
              'flex items-center px-3 text-[10px] text-chatroom-text-muted uppercase tracking-wider border-l border-chatroom-border transition-colors',
              dragOver && 'bg-chatroom-accent/10 text-chatroom-accent'
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {dragOver ? 'Drop to split' : 'Split'}
          </div>
        )}
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
  onContextMenu?: (filePath: string, event: React.MouseEvent) => void;
  draggable?: boolean;
  onDragStart?: (event: React.DragEvent) => void;
}

const FileTabItem = memo(function FileTabItem({
  tab,
  tabKey,
  isActive,
  onActivate,
  onClose,
  onPin,
  onToggleExpanded,
  onContextMenu,
  draggable = false,
  onDragStart,
}: FileTabItemProps) {
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
