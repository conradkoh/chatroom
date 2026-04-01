'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { Loader2, X } from 'lucide-react';
import { memo, useCallback, useEffect } from 'react';

import { getFileIcon } from './fileIcons';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface FilePreviewDialogProps {
  filePath: string | null;
  machineId: string | null;
  workingDir: string | null;
  onClose: () => void;
}

/** Known binary file extensions that should not be previewed. */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg',
  '.mp3', '.mp4', '.wav', '.ogg', '.webm',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.exe', '.dll', '.so', '.dylib',
  '.bin', '.dat', '.db', '.sqlite',
]);

function isBinaryFile(path: string): boolean {
  const lastDot = path.lastIndexOf('.');
  if (lastDot === -1) return false;
  return BINARY_EXTENSIONS.has(path.slice(lastDot).toLowerCase());
}

export const FilePreviewDialog = memo(function FilePreviewDialog({
  filePath,
  machineId,
  workingDir,
  onClose,
}: FilePreviewDialogProps) {
  const isOpen = !!filePath;

  // Fetch cached content
  const contentResult = useSessionQuery(
    api.workspaceFiles.getFileContent,
    machineId && workingDir && filePath
      ? { machineId, workingDir, filePath }
      : 'skip'
  );

  // Request content mutation (triggers daemon to fetch)
  const requestContent = useSessionMutation(api.workspaceFiles.requestFileContent);

  // When file is selected, request its content
  useEffect(() => {
    if (filePath && machineId && workingDir) {
      requestContent({ machineId, workingDir, filePath }).catch(() => {});
    }
  }, [filePath, machineId, workingDir, requestContent]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose]
  );

  const isBinary = filePath ? isBinaryFile(filePath) : false;

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle>FILE PREVIEW</DialogTitle>
        <DialogDescription>Preview file content</DialogDescription>
      </DialogHeader>
      <DialogContent
        className="max-w-4xl max-h-[80vh] rounded-none border-2 border-chatroom-border bg-chatroom-bg-primary p-0 shadow-none overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b-2 border-chatroom-border px-4 py-2.5 shrink-0">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {filePath && (() => {
              const Icon = getFileIcon(filePath);
              return <Icon className="h-4 w-4 shrink-0 text-chatroom-text-muted" />;
            })()}
            <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted font-mono truncate">
              {filePath}
            </span>
            {contentResult?.truncated && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 shrink-0">
                TRUNCATED
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-chatroom-text-muted hover:text-chatroom-text-primary p-1 shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto">
          {isBinary ? (
            <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-chatroom-text-muted">
                FILE FORMAT UNSUPPORTED
              </span>
              <span className="text-[10px] font-mono text-chatroom-text-muted">{filePath}</span>
            </div>
          ) : !contentResult ? (
            <div className="flex h-full min-h-[200px] items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-chatroom-text-muted" />
            </div>
          ) : (
            <pre className="p-4 text-xs font-mono text-chatroom-text-primary whitespace-pre overflow-x-auto leading-relaxed">
              {contentResult.content}
            </pre>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
});
