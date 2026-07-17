'use client';

import { AlertTriangle, BookOpen, FileWarning, Table2 } from 'lucide-react';
import { memo, useRef } from 'react';

import { isBinaryFileContent } from '../../components/FileSelector/binaryDetection';
import { usePendingFileHighlight } from '../../context/PendingFileHighlightContext';
import { isMarkdownFile, isCsvFile, SyntaxHighlighter } from '../file-renderers';
import {
  useExplorerSelectionKeyboard,
  useRemoteSelectionContextMenu,
} from '../hooks/useExplorerSelectionKeyboard';
import { useRequestWorkspaceFileContent } from '../hooks/useRequestWorkspaceFileContent';
import {
  FILE_READ_ERROR_PLACEHOLDER,
  isPendingOptimisticNewFile,
  isTransientNewFileReadError,
} from '../utils/fileContentSentinels';

import { ChatroomLoader } from '@/components/ui/chatroom-loader';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

const EMPTY_FILE_PLACEHOLDER = 'This file is empty.';

interface FileContentViewerProps {
  machineId: string;
  workingDir: string;
  filePath: string;
  /** Called when user presses Cmd+I with a text selection in the file viewer */
  onSendSelectionToComposer?: (payload: { filePath: string; selectedText: string }) => void;
  /** Called when user clicks "Preview" on a markdown file */
  onOpenPreview?: (filePath: string) => void;
  /** Called when user clicks "View" on a CSV file */
  onOpenTableView?: (filePath: string) => void;
  /** Called when user chooses Open Selection on Remote from the selection context menu */
  onOpenSelectionOnRemote?: (filePath: string, selectedText: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const FileContentViewer = memo(function FileContentViewer({
  machineId,
  workingDir,
  filePath,
  onSendSelectionToComposer,
  onOpenPreview,
  onOpenTableView,
  onOpenSelectionOnRemote,
}: FileContentViewerProps) {
  // Binary file guard
  if (isBinaryFileContent(filePath)) {
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
      onSendSelectionToComposer={onSendSelectionToComposer}
      onOpenPreview={onOpenPreview}
      onOpenTableView={onOpenTableView}
      onOpenSelectionOnRemote={onOpenSelectionOnRemote}
    />
  );
});

// ─── Inner Component (handles data fetching) ─────────────────────────────────

// fallow-ignore-next-line complexity
const FileContentInner = memo(function FileContentInner({
  machineId,
  workingDir,
  filePath,
  onSendSelectionToComposer,
  onOpenPreview,
  onOpenTableView,
  onOpenSelectionOnRemote,
}: FileContentViewerProps) {
  const contentContainerRef = useRef<HTMLDivElement>(null);
  const { peekHighlightForFile } = usePendingFileHighlight();
  const fileHighlight = peekHighlightForFile(filePath);

  useExplorerSelectionKeyboard(contentContainerRef, filePath, onSendSelectionToComposer);
  const { onContextMenu, selectionMenu } = useRemoteSelectionContextMenu(
    filePath,
    onOpenSelectionOnRemote
  );
  const content = useRequestWorkspaceFileContent({ machineId, workingDir, filePath });
  const isPendingCreate = isPendingOptimisticNewFile(filePath);

  if (isPendingCreate) {
    if (
      content === undefined ||
      content === null ||
      isTransientNewFileReadError(content?.content, filePath)
    ) {
      return (
        <div className="flex-1 flex items-center justify-center gap-2 text-chatroom-text-muted text-sm">
          <ChatroomLoader size="sm" />
          {content === undefined ? 'Loading…' : 'Creating file…'}
        </div>
      );
    }
  }

  // Loading state
  if (content === undefined) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2 text-chatroom-text-muted text-sm">
        <ChatroomLoader size="sm" />
        Loading…
      </div>
    );
  }

  // No content
  if (content === null) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2 text-chatroom-text-muted text-sm">
        <ChatroomLoader size="sm" />
        Waiting for file content…
      </div>
    );
  }

  if (content.content === FILE_READ_ERROR_PLACEHOLDER) {
    if (isPendingOptimisticNewFile(filePath)) {
      return (
        <div className="flex-1 flex items-center justify-center gap-2 text-chatroom-text-muted text-sm">
          <ChatroomLoader size="sm" />
          Creating file…
        </div>
      );
    }
  }

  const isMd = isMarkdownFile(filePath);
  const isCsv = isCsvFile(filePath);
  const showToolbar = isMd || isCsv || content.truncated;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {selectionMenu}
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
      <div ref={contentContainerRef} className="flex-1 overflow-auto" onContextMenu={onContextMenu}>
        {fileHighlight ? (
          <span
            data-testid="file-content-pending-highlight"
            data-start-line={fileHighlight.startLine}
            data-end-line={fileHighlight.endLine}
            className="sr-only"
          />
        ) : null}
        {content.content.length === 0 ? (
          <p className="p-4 text-[13px] italic text-chatroom-text-muted">
            {EMPTY_FILE_PLACEHOLDER}
          </p>
        ) : (
          <SyntaxHighlighter
            code={content.content}
            path={filePath}
            className="p-4 text-[13px] leading-relaxed font-mono text-chatroom-text-primary whitespace-pre overflow-x-auto block"
          />
        )}
      </div>
    </div>
  );
});
