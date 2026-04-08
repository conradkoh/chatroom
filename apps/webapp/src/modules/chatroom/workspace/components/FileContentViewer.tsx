'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionQuery, useSessionMutation } from 'convex-helpers/react/sessions';
import { AlertTriangle, FileWarning } from 'lucide-react';
import { memo, useEffect } from 'react';

import { isBinaryFile } from '../../components/FileSelector/binaryDetection';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FileContentViewerProps {
  machineId: string;
  workingDir: string;
  filePath: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const FileContentViewer = memo(function FileContentViewer({
  machineId,
  workingDir,
  filePath,
}: FileContentViewerProps) {
  // Binary file guard
  if (isBinaryFile(filePath)) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-chatroom-text-muted p-8">
        <FileWarning size={40} className="text-chatroom-text-muted/50" />
        <div className="text-sm">Binary file — cannot be displayed as text</div>
        <div className="text-xs text-chatroom-text-muted/70">{filePath}</div>
      </div>
    );
  }

  return (
    <FileContentInner
      machineId={machineId}
      workingDir={workingDir}
      filePath={filePath}
    />
  );
});

// ─── Inner Component (handles data fetching) ─────────────────────────────────

const FileContentInner = memo(function FileContentInner({
  machineId,
  workingDir,
  filePath,
}: FileContentViewerProps) {
  // Request file content from daemon
  const requestContent = useSessionMutation(api.workspaceFiles.requestFileContent);

  useEffect(() => {
    requestContent({ machineId, workingDir, filePath }).catch(() => {
      // Silently ignore — query will show loading or stale data
    });
  }, [machineId, workingDir, filePath, requestContent]);

  // Reactively fetch cached content
  const content = useSessionQuery(api.workspaceFiles.getFileContent, {
    machineId,
    workingDir,
    filePath,
  });

  // Loading state
  if (content === undefined) {
    return (
      <div className="flex-1 flex items-center justify-center text-chatroom-text-muted text-sm">
        <div className="w-4 h-4 border-2 border-chatroom-border border-t-chatroom-accent animate-spin mr-2" />
        Loading…
      </div>
    );
  }

  // No content (daemon hasn't responded yet or file doesn't exist)
  if (content === null) {
    return (
      <div className="flex-1 flex items-center justify-center text-chatroom-text-muted text-sm">
        <div className="w-4 h-4 border-2 border-chatroom-border border-t-chatroom-accent animate-spin mr-2" />
        Waiting for file content…
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Truncation warning */}
      {content.truncated && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-chatroom-status-warning/10 border-b border-chatroom-status-warning/30 text-chatroom-status-warning text-xs shrink-0">
          <AlertTriangle size={14} />
          File content was truncated — only a portion is shown
        </div>
      )}

      {/* File content */}
      <div className="flex-1 overflow-auto">
        <pre className="p-4 text-[13px] leading-relaxed font-mono text-chatroom-text-primary whitespace-pre overflow-x-auto">
          <code>{content.content}</code>
        </pre>
      </div>
    </div>
  );
});
