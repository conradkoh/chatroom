'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { MoreHorizontal, RefreshCw, Search, FilePlus } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import { FILE_EXPLORER_REFRESH_EVENT } from './fileExplorerEvents';
import { NewFileDialog } from './NewFileDialog';
import { WorkspaceFileExplorer } from './WorkspaceFileExplorer';

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export { FILE_EXPLORER_REFRESH_EVENT } from './fileExplorerEvents';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FileExplorerPanelProps {
  chatroomId?: string;
  machineId: string | null;
  workingDir: string | null;
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

export const FileExplorerPanel = memo(function FileExplorerPanel({
  chatroomId,
  machineId,
  workingDir,
  onFileSelect,
  onFileDoubleClick,
  revealPath,
  activeTabPath,
  explorerSyncEnabled,
  onToggleSync,
  onFileCreated,
}: FileExplorerPanelProps) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [filterQuery, setFilterQuery] = useState('');
  const [newFileOpen, setNewFileOpen] = useState(false);
  const requestTree = useSessionMutation(api.workspaceFiles.requestFileTree);

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
        onNewFile={() => setNewFileOpen(true)}
      />

      <NewFileDialog
        open={newFileOpen}
        onOpenChange={setNewFileOpen}
        machineId={machineId}
        workingDir={workingDir}
        onCreated={(filePath) => {
          onFileCreated?.(filePath);
          handleRefresh();
        }}
      />

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
        />
      </div>
    </div>
  );
});
