'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { Check, Copy, Loader2, X } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';

import { FileTypeIcon } from './fileIcons';
import { isBinaryFile } from './binaryDetection';

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


export const FilePreviewDialog = memo(function FilePreviewDialog({
  filePath,
  machineId,
  workingDir,
  onClose,
}: FilePreviewDialogProps) {
  const isOpen = !!filePath;

  const [copied, setCopied] = useState(false);

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

  const handleCopyPath = useCallback(async () => {
    if (!filePath) return;
    try {
      await navigator.clipboard.writeText(filePath);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }, [filePath]);

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
            {filePath && (
              <FileTypeIcon path={filePath} className="h-4 w-4 shrink-0 text-chatroom-text-muted" />
            )}
            <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted font-mono truncate">
              {filePath}
            </span>
            {contentResult?.truncated && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 shrink-0">
                TRUNCATED
              </span>
            )}
            {contentResult && (
              <span className="text-[10px] font-mono text-chatroom-text-muted tabular-nums shrink-0">
                {contentResult.content.split('\n').length} lines
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={handleCopyPath}
              className="text-chatroom-text-muted hover:text-chatroom-text-primary p-1"
              title="Copy file path"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            <button
              onClick={onClose}
              className="text-chatroom-text-muted hover:text-chatroom-text-primary p-1"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
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
            <div className="flex overflow-auto">
              {/* Line numbers */}
              <div className="sticky left-0 select-none border-r border-chatroom-border bg-chatroom-bg-primary px-3 py-4 text-right">
                {contentResult.content.split('\n').map((_, i) => (
                  <div key={i} className="text-[10px] font-mono text-chatroom-text-muted leading-relaxed">
                    {i + 1}
                  </div>
                ))}
              </div>
              {/* Content */}
              <pre className="flex-1 p-4 text-xs font-mono text-chatroom-text-primary whitespace-pre overflow-x-auto leading-relaxed">
                {contentResult.content}
              </pre>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
});
