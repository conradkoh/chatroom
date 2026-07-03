'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { MoreHorizontal, RefreshCw, Search, FilePlus } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { FILE_EXPLORER_REFRESH_EVENT } from './fileExplorerEvents';
import { NewFileDialog } from './NewFileDialog';
import { WorkspaceFileExplorer, type ExplorerDeleteTarget } from './WorkspaceFileExplorer';
import { useExplorerNewFileOps } from '../hooks/useExplorerNewFileOps';
import type { UseFileTabsReturn } from '../hooks/useFileTabs';
import { useWorkspaceFileDelete } from '../hooks/useWorkspaceFileDelete';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export { FILE_EXPLORER_REFRESH_EVENT } from './fileExplorerEvents';

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
    window.dispatchEvent(new CustomEvent(FILE_EXPLORER_REFRESH_EVENT));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'File delete failed';
    explorerFileOps.onFileDeleteFailed(path, message);
    onRefresh();
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

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
                className="text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors cursor-pointer rounded-sm p-0.5"
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
            title="Refresh file tree"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
export const FileExplorerPanel = memo(function FileExplorerPanel({
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
}: FileExplorerPanelProps) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [filterQuery, setFilterQuery] = useState('');
  const [newFileOpen, setNewFileOpen] = useState(false);
  const [newFileDefaultDir, setNewFileDefaultDir] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ExplorerDeleteTarget | null>(null);
  const requestTree = useSessionMutation(api.workspaceFiles.requestFileTree);
  const { requestDelete, confirmDelete } = useWorkspaceFileDelete({
    machineId: machineId ?? '',
    workingDir: workingDir ?? '',
  });
  const explorerFileOps = useExplorerNewFileOps(fileTabs);

  const openNewFileDialog = useCallback((defaultDir = '') => {
    setNewFileDefaultDir(defaultDir);
    setNewFileOpen(true);
  }, []);

  // When sync is enabled, the active tab path becomes the effective reveal/select target.
  // When disabled, only external revealPath requests (e.g. "Open in Explorer") are honored.
  const effectiveSelectedPath = useMemo<string | null>(() => {
    if (explorerSyncEnabled && activeTabPath) return activeTabPath;
    return null;
  }, [explorerSyncEnabled, activeTabPath]);
  const effectiveRevealPath = revealPath ?? effectiveSelectedPath;

  const handleRefresh = useCallback(() => {
    if (machineId && workingDir) {
      requestTree({ machineId, workingDir }).catch(() => {
        // Silently ignore
      });
    }
    setRefreshKey((k) => k + 1);
  }, [machineId, workingDir, requestTree]);

  // fallow-ignore-next-line complexity
  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const path = deleteTarget.path;
    setDeleteTarget(null);

    try {
      const { requestId } = await requestDelete(path);
      explorerFileOps.onFileDeleteSubmitted(path);
      onFileDeleted?.(path);
      setRefreshKey((k) => k + 1);
      void confirmDeleteInBackground(path, requestId, confirmDelete, explorerFileOps, () =>
        setRefreshKey((k) => k + 1)
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'File delete failed';
      toast.error(message);
    }
  }, [confirmDelete, deleteTarget, explorerFileOps, onFileDeleted, requestDelete]);

  // Request file tree on initial mount (or when workspace changes)
  useEffect(() => {
    if (machineId && workingDir) {
      requestTree({ machineId, workingDir }).catch(() => {
        // Silently ignore — tree may already exist
      });
    }
  }, [machineId, workingDir, requestTree]);

  // Listen for external refresh requests (e.g. from command palette "Open File Explorer")
  useEffect(() => {
    const handler = () => handleRefresh();
    window.addEventListener(FILE_EXPLORER_REFRESH_EVENT, handler);
    return () => window.removeEventListener(FILE_EXPLORER_REFRESH_EVENT, handler);
  }, [handleRefresh]);

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
        onRefresh={handleRefresh}
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
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent className="bg-chatroom-bg-primary border-chatroom-border-strong">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-chatroom-text-primary">
              {deleteTarget?.type === 'directory' ? 'Delete folder?' : 'Delete file?'}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-chatroom-text-secondary">
              {deleteTarget?.type === 'directory' ? (
                <>
                  This will permanently delete the folder{' '}
                  <span className="font-mono text-chatroom-text-primary">{deleteTarget.path}</span>{' '}
                  and all of its contents from the workspace.
                </>
              ) : (
                <>
                  This will permanently delete{' '}
                  <span className="font-mono text-chatroom-text-primary">{deleteTarget?.path}</span>{' '}
                  from the workspace.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="border-t border-chatroom-border pt-4">
            <AlertDialogCancel className="bg-chatroom-bg-tertiary border-chatroom-border text-chatroom-text-secondary hover:bg-chatroom-bg-hover hover:text-chatroom-text-primary">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleConfirmDelete();
              }}
              className="bg-chatroom-status-error text-white hover:bg-chatroom-status-error/90 border-0"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Filename filter */}
      <div className="px-2 py-1.5 border-b border-chatroom-border-strong shrink-0">
        <div className="flex items-center gap-1.5 px-2 py-1 bg-chatroom-bg-secondary border border-chatroom-border rounded-sm">
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
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="flex flex-1 flex-col min-h-0 overflow-y-auto overflow-x-hidden">
            <WorkspaceFileExplorer
              key={refreshKey}
              chatroomId={chatroomId}
              machineId={machineId}
              workingDir={workingDir}
              onFileSelect={onFileSelect}
              onFileDoubleClick={onFileDoubleClick}
              revealPath={effectiveRevealPath}
              selectedPath={effectiveSelectedPath}
              filterQuery={filterQuery}
              onNewFileInDir={(dir) => openNewFileDialog(dir)}
              onDeleteFile={(target) => setDeleteTarget(target)}
            />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => openNewFileDialog('')}>
            <FilePlus size={12} className="mr-2" />
            New File
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
});
