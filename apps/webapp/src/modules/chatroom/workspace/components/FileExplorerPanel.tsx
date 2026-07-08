'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import {
  MoreHorizontal,
  RefreshCw,
  Search,
  FilePlus,
  FolderPlus,
  Pencil,
  Trash2,
  Copy,
  ExternalLink,
} from 'lucide-react';
import type { MouseEvent } from 'react';
import { forwardRef, memo, useCallback, useImperativeHandle, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { NewFileDialog } from './NewFileDialog';
import { NewFolderDialog } from './NewFolderDialog';
import { RenameDialog } from './RenameDialog';
import { WorkspaceFileExplorer, type ExplorerDeleteTarget } from './WorkspaceFileExplorer';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { useExplorerNewFileOps } from '../hooks/useExplorerNewFileOps';
import type { UseFileTabsReturn } from '../hooks/useFileTabs';
import { useOpenFileOnRemote } from '../hooks/useOpenFileOnRemote';
import { useWorkspaceFileDelete } from '../hooks/useWorkspaceFileDelete';

export interface FileExplorerPanelHandle {
  refresh: () => void;
}

async function confirmDeleteInBackground(
  path: string,
  requestId: Id<'chatroom_workspaceFileWriteRequests'>,
  confirmDelete: (requestId: Id<'chatroom_workspaceFileWriteRequests'>) => Promise<void>,
  explorerFileOps: ReturnType<typeof useExplorerNewFileOps>,
  onRefresh: () => void
): Promise<void> {
  try {
    await confirmDelete(requestId);
    explorerFileOps.onFileDeleteConfirmed(path);
    onRefresh();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'File delete failed';
    explorerFileOps.onFileDeleteFailed(path, message);
    onRefresh();
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

type ExplorerContextTarget =
  | { kind: 'root' }
  | { kind: 'node'; path: string; type: 'file' | 'directory' };

function joinWorkingDirPath(workingDir: string, relativePath: string): string {
  const base = workingDir.replace(/[/\\]+$/, '');
  if (!relativePath) return base;
  const separator = base.includes('\\') ? '\\' : '/';
  return `${base}${separator}${relativePath.replace(/^[/\\]+/, '')}`;
}

async function copyTextToClipboard(text: string, successMessage: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(successMessage);
  } catch {
    toast.error('Failed to copy to clipboard');
  }
}

interface FileExplorerPanelProps {
  chatroomId?: string;
  machineId: string | null;
  workingDir: string | null;
  fileTabs: UseFileTabsReturn;
  onFileSelect?: (filePath: string) => void;
  onFileDoubleClick?: (filePath: string) => void;
  /** When set, auto-expand tree to reveal this file path (always honored) */
  revealPath?: string | null;
  /** The currently active file tab path; used for sync when preference is enabled */
  activeTabPath: string | null;
  /** Whether Explorer↔active-editor sync is enabled */
  explorerSyncEnabled: boolean;
  /** Toggle for Explorer↔active-editor sync */
  onToggleSync: (enabled: boolean) => void;
  /** Called after a new file is created from the explorer */
  onFileCreated?: (filePath: string) => void;
  /** Called when background create succeeds */
  onFileCreateConfirmed?: (filePath: string) => void;
  /** Called when background create fails after optimistic open */
  onFileCreateFailed?: (filePath: string, error: string) => void;
  /** Called after a file is deleted from the explorer */
  onFileDeleted?: (filePath: string) => void;
}

function ExplorerPanelHeader({
  explorerSyncEnabled,
  onToggleSync,
  onRefresh,
  onNewFile,
}: {
  explorerSyncEnabled?: boolean;
  onToggleSync?: (enabled: boolean) => void;
  onRefresh?: () => void;
  onNewFile?: () => void;
}) {
  const showActions = onToggleSync != null && onRefresh != null;

  return (
    <div className="px-3 py-2 border-b-2 border-chatroom-border-strong flex items-center justify-between shrink-0">
      <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
        Explorer
      </span>
      {showActions ? (
        <div className="flex items-center gap-1">
          {onNewFile && (
            <button
              className="text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors cursor-pointer"
              onClick={onNewFile}
              title="New file"
              aria-label="New file"
            >
              <FilePlus size={13} />
            </button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors cursor-pointer rounded-none p-0.5"
                aria-label="Explorer options"
              >
                <MoreHorizontal size={13} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[180px]">
              <DropdownMenuCheckboxItem
                checked={explorerSyncEnabled}
                onCheckedChange={onToggleSync}
              >
                Sync with active editor
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            className="text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors cursor-pointer"
            onClick={onRefresh}
            title="Refresh files"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export const FileExplorerPanel = memo(
  forwardRef<FileExplorerPanelHandle, FileExplorerPanelProps>(
    // fallow-ignore-next-line complexity
    function FileExplorerPanel(
      {
        chatroomId,
        machineId,
        workingDir,
        fileTabs,
        onFileSelect,
        onFileDoubleClick,
        revealPath,
        activeTabPath,
        explorerSyncEnabled,
        onToggleSync,
        onFileCreated,
        onFileCreateFailed,
        onFileCreateConfirmed,
        onFileDeleted,
      },
      ref
    ) {
      const [refreshSignal, setRefreshSignal] = useState(0);
      const [filterQuery, setFilterQuery] = useState('');
      const [newFileOpen, setNewFileOpen] = useState(false);
      const [newFileDefaultDir, setNewFileDefaultDir] = useState('');
      const [newFolderOpen, setNewFolderOpen] = useState(false);
      const [newFolderDefaultDir, setNewFolderDefaultDir] = useState('');
      const [renameOpen, setRenameOpen] = useState(false);
      const [renameTarget, setRenameTarget] = useState<{
        path: string;
        type: 'file' | 'directory';
      } | null>(null);
      const [deleteTarget, setDeleteTarget] = useState<ExplorerDeleteTarget | null>(null);
      const [contextMenuOpen, setContextMenuOpen] = useState(false);
      const [contextMenuTarget, setContextMenuTarget] = useState<ExplorerContextTarget | null>(
        null
      );
      const [contextMenuPoint, setContextMenuPoint] = useState({ x: 0, y: 0 });
      const { requestDelete, confirmDelete } = useWorkspaceFileDelete({
        machineId: machineId ?? '',
        workingDir: workingDir ?? '',
      });
      const explorerFileOps = useExplorerNewFileOps(fileTabs);
      const { openFileOnRemote } = useOpenFileOnRemote(machineId ?? '', workingDir ?? '');

      const openNewFileDialog = useCallback((defaultDir = '') => {
        setNewFileDefaultDir(defaultDir);
        setNewFileOpen(true);
      }, []);

      const openNewFolderDialog = useCallback((defaultDir = '') => {
        setNewFolderDefaultDir(defaultDir);
        setNewFolderOpen(true);
      }, []);

      const openRenameDialog = useCallback((path: string, type: 'file' | 'directory') => {
        setRenameTarget({ path, type });
        setRenameOpen(true);
      }, []);

      const openContextMenu = useCallback((target: ExplorerContextTarget, event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        setContextMenuTarget(target);
        setContextMenuPoint({ x: event.clientX, y: event.clientY });
        setContextMenuOpen(true);
      }, []);

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

      // When sync is enabled, the active tab path becomes the effective reveal/select target.
      // When disabled, only external revealPath requests (e.g. "Open in Explorer") are honored.
      const effectiveSelectedPath = useMemo<string | null>(() => {
        if (explorerSyncEnabled && activeTabPath) return activeTabPath;
        return null;
      }, [explorerSyncEnabled, activeTabPath]);
      const effectiveRevealPath = revealPath ?? effectiveSelectedPath;

      const refreshExplorer = useCallback(() => {
        setRefreshSignal((signal) => signal + 1);
      }, []);

      useImperativeHandle(ref, () => ({ refresh: refreshExplorer }), [refreshExplorer]);

      // fallow-ignore-next-line complexity
      const handleConfirmDelete = useCallback(async () => {
        if (!deleteTarget) return;
        const path = deleteTarget.path;
        setDeleteTarget(null);

        try {
          const { requestId } = await requestDelete(path);
          explorerFileOps.onFileDeleteSubmitted(path);
          onFileDeleted?.(path);
          refreshExplorer();
          void confirmDeleteInBackground(
            path,
            requestId,
            confirmDelete,
            explorerFileOps,
            refreshExplorer
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : 'File delete failed';
          toast.error(message);
        }
      }, [
        confirmDelete,
        deleteTarget,
        explorerFileOps,
        onFileDeleted,
        requestDelete,
        refreshExplorer,
      ]);

      if (!machineId || !workingDir) {
        return (
          <div className="h-full flex flex-col min-w-0">
            <ExplorerPanelHeader />
            <div className="flex flex-1 items-center justify-center text-chatroom-text-muted text-xs px-4 text-center">
              No workspace connected
            </div>
          </div>
        );
      }

      return (
        <div className="h-full flex flex-col min-w-0">
          <ExplorerPanelHeader
            explorerSyncEnabled={explorerSyncEnabled}
            onToggleSync={onToggleSync}
            onRefresh={refreshExplorer}
            onNewFile={() => openNewFileDialog('')}
          />

          <NewFileDialog
            open={newFileOpen}
            onOpenChange={setNewFileOpen}
            machineId={machineId}
            workingDir={workingDir}
            defaultDir={newFileDefaultDir}
            onCreated={(filePath) => {
              explorerFileOps.onFileCreated(filePath);
              onFileCreated?.(filePath);
            }}
            onCreateFailed={(filePath, error) => {
              explorerFileOps.onFileCreateFailed(filePath, error);
              onFileCreateFailed?.(filePath, error);
            }}
            onCreateConfirmed={(filePath) => {
              explorerFileOps.onFileCreateConfirmed(filePath);
              onFileCreateConfirmed?.(filePath);
            }}
            onExplorerRefresh={refreshExplorer}
          />

          <NewFolderDialog
            open={newFolderOpen}
            onOpenChange={setNewFolderOpen}
            machineId={machineId}
            workingDir={workingDir}
            defaultDir={newFolderDefaultDir}
            onCreated={() => refreshExplorer()}
            onCreateFailed={(_dirPath, error) => toast.error(error)}
            onCreateConfirmed={() => refreshExplorer()}
            onExplorerRefresh={refreshExplorer}
          />

          <RenameDialog
            open={renameOpen}
            onOpenChange={setRenameOpen}
            machineId={machineId}
            workingDir={workingDir}
            targetPath={renameTarget?.path ?? ''}
            targetType={renameTarget?.type ?? 'file'}
            onRenamed={(oldPath, newPath) => {
              explorerFileOps.onFileRenamed(oldPath, newPath);
              refreshExplorer();
            }}
            onRenameFailed={(oldPath, error) => {
              explorerFileOps.onFileRenameFailed(oldPath, error);
              refreshExplorer();
            }}
            onRenameConfirmed={(oldPath, newPath) => {
              explorerFileOps.onFileRenameConfirmed(oldPath, newPath);
              refreshExplorer();
            }}
            onExplorerRefresh={refreshExplorer}
          />

          <AlertDialog
            open={deleteTarget !== null}
            onOpenChange={(open) => {
              if (!open) setDeleteTarget(null);
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {deleteTarget?.type === 'directory' ? 'Delete folder?' : 'Delete file?'}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {deleteTarget?.type === 'directory' ? (
                    <>
                      This will permanently delete the folder{' '}
                      <span className="font-mono text-chatroom-text-primary">
                        {deleteTarget.path}
                      </span>{' '}
                      and all of its contents from the workspace.
                    </>
                  ) : (
                    <>
                      This will permanently delete{' '}
                      <span className="font-mono text-chatroom-text-primary">
                        {deleteTarget?.path}
                      </span>{' '}
                      from the workspace.
                    </>
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(event) => {
                    event.preventDefault();
                    void handleConfirmDelete();
                  }}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Filename filter */}
          <div className="px-2 py-1.5 border-b border-chatroom-border-strong shrink-0">
            <div className="flex items-center gap-1.5 px-2 py-1 bg-chatroom-bg-secondary border border-chatroom-border rounded-none">
              <Search size={12} className="text-chatroom-text-muted shrink-0" />
              <input
                type="search"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder="Filter files…"
                aria-label="Filter files in explorer"
                className="w-full bg-transparent text-[12px] text-chatroom-text-primary placeholder:text-chatroom-text-muted outline-none"
              />
            </div>
          </div>

          {/* Tree content */}
          <div
            className="flex flex-1 flex-col min-h-0 overflow-y-auto overflow-x-hidden"
            onContextMenu={(event) => {
              if ((event.target as HTMLElement).closest('[data-tree-node]')) return;
              openContextMenu({ kind: 'root' }, event);
            }}
          >
            <WorkspaceFileExplorer
              refreshSignal={refreshSignal}
              chatroomId={chatroomId}
              machineId={machineId}
              workingDir={workingDir}
              onFileSelect={onFileSelect}
              onFileDoubleClick={onFileDoubleClick}
              revealPath={effectiveRevealPath}
              selectedPath={effectiveSelectedPath}
              filterQuery={filterQuery}
              onNodeContextMenu={(node, event) =>
                openContextMenu({ kind: 'node', path: node.path, type: node.type }, event)
              }
              onEmptyAreaContextMenu={(event) => openContextMenu({ kind: 'root' }, event)}
            />
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
              {contextMenuTarget?.kind === 'node' && contextMenuTarget.type === 'directory' && (
                <>
                  <DropdownMenuItem onSelect={() => openNewFileDialog(contextMenuTarget.path)}>
                    <FilePlus size={12} className="mr-2" />
                    New File
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => openNewFolderDialog(contextMenuTarget.path)}>
                    <FolderPlus size={12} className="mr-2" />
                    New Folder
                  </DropdownMenuItem>
                </>
              )}
              {contextMenuTarget?.kind === 'root' && (
                <>
                  <DropdownMenuItem onSelect={() => openNewFileDialog('')}>
                    <FilePlus size={12} className="mr-2" />
                    New File
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => openNewFolderDialog('')}>
                    <FolderPlus size={12} className="mr-2" />
                    New Folder
                  </DropdownMenuItem>
                </>
              )}
              {contextMenuTarget?.kind === 'node' && contextMenuTarget.path !== '' && (
                <>
                  <DropdownMenuItem onSelect={() => void copyRelativePath(contextMenuTarget.path)}>
                    <Copy size={12} className="mr-2" />
                    Copy Relative Path
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void copyFullPath(contextMenuTarget.path)}>
                    <Copy size={12} className="mr-2" />
                    Copy Full Path
                  </DropdownMenuItem>
                  {contextMenuTarget.type === 'file' && (
                    <DropdownMenuItem
                      onSelect={() => void openFileOnRemote(contextMenuTarget.path)}
                    >
                      <ExternalLink size={12} className="mr-2" />
                      Open File on Remote
                    </DropdownMenuItem>
                  )}
                </>
              )}
              {contextMenuTarget?.kind === 'node' && contextMenuTarget.path !== '' && (
                <DropdownMenuItem
                  onSelect={() => openRenameDialog(contextMenuTarget.path, contextMenuTarget.type)}
                >
                  <Pencil size={12} className="mr-2" />
                  Rename
                </DropdownMenuItem>
              )}
              {contextMenuTarget?.kind === 'node' && contextMenuTarget.path !== '' && (
                <DropdownMenuItem
                  onSelect={() =>
                    setDeleteTarget({ path: contextMenuTarget.path, type: contextMenuTarget.type })
                  }
                  className="text-chatroom-status-error data-[highlighted]:text-chatroom-status-error focus:text-chatroom-status-error"
                >
                  <Trash2 size={12} className="mr-2" />
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      );
    }
  )
);
