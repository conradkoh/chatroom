'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionQuery, useSessionMutation } from 'convex-helpers/react/sessions';
import { AlertTriangle, BookOpen, FileWarning, Table2 } from 'lucide-react';
import { isMarkdownFile, isCsvFile } from '../file-renderers';
import { memo, useEffect } from 'react';

import { isBinaryFile } from '../../components/FileSelector/binaryDetection';

import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FileContentViewerProps {
  machineId: string;
  workingDir: string;
  filePath: string;
  /** Called when user clicks "Preview" on a markdown file */
  onOpenPreview?: (filePath: string) => void;
  /** Called when user clicks "View" on a CSV file */
  onOpenTableView?: (filePath: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const FileContentViewer = memo(function FileContentViewer({
  machineId,
  workingDir,
  filePath,
  onOpenPreview,
  onOpenTableView,
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
      onOpenPreview={onOpenPreview}
      onOpenTableView={onOpenTableView}
    />
  );
});

// ─── Inner Component (handles data fetching) ─────────────────────────────────

const FileContentInner = memo(function FileContentInner({
  machineId,
  workingDir,
  filePath,
  onOpenPreview,
  onOpenTableView,
}: FileContentViewerProps) {
  // Request file content from daemon
  const requestContent = useSessionMutation(api.workspaceFiles.requestFileContent);

  useEffect(() => {
    requestContent({ machineId, workingDir, filePath }).catch(() => {});
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

  // No content
  if (content === null) {
    return (
      <div className="flex-1 flex items-center justify-center text-chatroom-text-muted text-sm">
        <div className="w-4 h-4 border-2 border-chatroom-border border-t-chatroom-accent animate-spin mr-2" />
        Waiting for file content…
      </div>
    );
  }

  const isMd = isMarkdownFile(filePath);
  const isCsv = isCsvFile(filePath);
  const showToolbar = isMd || isCsv || content.truncated;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Toolbar */}
      {showToolbar && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-chatroom-border shrink-0">
          {content.truncated && (
            <div className="flex items-center gap-1.5 text-chatroom-status-warning text-xs">
              <AlertTriangle size={14} />
              <span>Truncated</span>
            </div>
          )}
          <div className="flex-1" />
          {isMd && onOpenPreview && (
            <button
              className={cn(
                'flex items-center gap-1.5 px-2 py-1 text-xs rounded transition-colors cursor-pointer',
                'text-chatroom-text-secondary hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover'
              )}
              onClick={() => onOpenPreview(filePath)}
              title="Open markdown preview"
            >
              <BookOpen size={14} />
              Preview
            </button>
          )}
          {isCsv && onOpenTableView && (
            <button
              className={cn(
                'flex items-center gap-1.5 px-2 py-1 text-xs rounded transition-colors cursor-pointer',
                'text-chatroom-text-secondary hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover'
              )}
              onClick={() => onOpenTableView(filePath)}
              title="View as table"
            >
              <Table2 size={14} />
              View
            </button>
          )}
        </div>
      )}

      {/* File content — source only */}
      <div className="flex-1 overflow-auto">
        <pre className="p-4 text-[13px] leading-relaxed font-mono text-chatroom-text-primary whitespace-pre overflow-x-auto">
          <code>{content.content}</code>
        </pre>
      </div>
    </div>
  );
});
