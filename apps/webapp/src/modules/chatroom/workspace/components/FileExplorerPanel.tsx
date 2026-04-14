'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { RefreshCw } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';

import { WorkspaceFileExplorer } from './WorkspaceFileExplorer';

/** Event name dispatched to request a file explorer refresh (e.g. from command palette) */
export const FILE_EXPLORER_REFRESH_EVENT = 'chatroom:file-explorer-refresh';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FileExplorerPanelProps {
  chatroomId?: string;
  machineId: string | null;
  workingDir: string | null;
  onFileSelect?: (filePath: string) => void;
  onFileDoubleClick?: (filePath: string) => void;
  /** When set, auto-expand tree to reveal this file path */
  revealPath?: string | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const FileExplorerPanel = memo(function FileExplorerPanel({
  chatroomId,
  machineId,
  workingDir,
  onFileSelect,
  onFileDoubleClick,
  revealPath,
}: FileExplorerPanelProps) {
  const [refreshKey, setRefreshKey] = useState(0);
  const requestTree = useSessionMutation(api.workspaceFiles.requestFileTree);

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
      <div className="h-full flex flex-col">
        <div className="px-3 py-2 border-b-2 border-chatroom-border-strong">
          <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
            Explorer
          </span>
        </div>
        <div className="flex-1 flex items-center justify-center text-chatroom-text-muted text-xs px-4 text-center">
          No workspace connected
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-w-0">
      {/* Header */}
      <div className="px-3 py-2 border-b-2 border-chatroom-border-strong flex items-center justify-between shrink-0">
        <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
          Explorer
        </span>
        <button
          className="text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors cursor-pointer"
          onClick={handleRefresh}
          title="Refresh file tree"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {/* Tree content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <WorkspaceFileExplorer
          key={refreshKey}
          chatroomId={chatroomId}
          machineId={machineId}
          workingDir={workingDir}
          onFileSelect={onFileSelect}
          onFileDoubleClick={onFileDoubleClick}
          revealPath={revealPath}
        />
      </div>
    </div>
  );
});
