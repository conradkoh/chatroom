'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { FolderTree, RefreshCw } from 'lucide-react';
import { memo, useCallback, useState } from 'react';

import { WorkspaceFileExplorer } from './WorkspaceFileExplorer';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FileExplorerPanelProps {
  machineId: string | null;
  workingDir: string | null;
  onFileSelect?: (filePath: string) => void;
  onFileDoubleClick?: (filePath: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const FileExplorerPanel = memo(function FileExplorerPanel({
  machineId,
  workingDir,
  onFileSelect,
  onFileDoubleClick,
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
          machineId={machineId}
          workingDir={workingDir}
          onFileSelect={onFileSelect}
          onFileDoubleClick={onFileDoubleClick}
        />
      </div>
    </div>
  );
});

// ─── Toggle Button ────────────────────────────────────────────────────────────

export const FileExplorerToggle = memo(function FileExplorerToggle({
  visible,
  onToggle,
}: {
  visible: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className="bg-transparent border-2 border-chatroom-border text-chatroom-text-secondary w-8 h-8 flex items-center justify-center cursor-pointer transition-all duration-100 hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong hover:text-chatroom-text-primary"
      onClick={onToggle}
      title={visible ? 'Hide file explorer' : 'Show file explorer'}
    >
      <FolderTree size={16} />
    </button>
  );
});

export { type FileExplorerPanelProps };
