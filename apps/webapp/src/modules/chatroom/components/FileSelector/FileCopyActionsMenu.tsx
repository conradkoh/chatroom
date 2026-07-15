'use client';

import { Copy } from 'lucide-react';
import { memo, useCallback } from 'react';

import { WorkspaceDropdownMenuItem } from '../../workspace/components/WorkspaceDropdownMenuItem';
import {
  copyFileContentToClipboard,
  copyFileNameToClipboard,
  copyFullPathToClipboard,
  copyRelativePathToClipboard,
} from '../../workspace/utils/clipboard';

import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/modules/chatroom/components/ui/dropdown-menu';

export interface FileCopyActionsMenuProps {
  relativePath: string;
  workingDir: string | null;
  content: string | null;
  truncated?: boolean;
  contentDisabled?: boolean;
  className?: string;
  /** When false, omits "Copy File Name" from the dropdown (use inline CopyFileNameButton). */
  showFileName?: boolean;
  /** When false, omits file content from the dropdown (e.g. desktop markdown uses a header button). */
  showFileContent?: boolean;
  fileContentLabel?: string;
}

export const CopyFileNameButton = memo(function CopyFileNameButton({
  relativePath,
  className,
}: {
  relativePath: string;
  className?: string;
}) {
  const handleCopy = useCallback(() => {
    void copyFileNameToClipboard(relativePath);
  }, [relativePath]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        'text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors shrink-0 min-w-8 min-h-8 flex items-center justify-center rounded-sm',
        className
      )}
      aria-label="Copy file name"
      title="Copy file name"
    >
      <Copy className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
});

export const FileCopyActionsMenu = memo(function FileCopyActionsMenu({
  relativePath,
  workingDir,
  content,
  truncated = false,
  contentDisabled = false,
  className,
  showFileName = true,
  showFileContent = true,
  fileContentLabel = 'Copy File Content',
}: FileCopyActionsMenuProps) {
  const handleCopyFileName = useCallback(() => {
    void copyFileNameToClipboard(relativePath);
  }, [relativePath]);

  const handleCopyRelativePath = useCallback(() => {
    void copyRelativePathToClipboard(relativePath);
  }, [relativePath]);

  const handleCopyFullPath = useCallback(() => {
    void copyFullPathToClipboard(workingDir, relativePath);
  }, [workingDir, relativePath]);

  const handleCopyContent = useCallback(() => {
    if (!content || contentDisabled) return;
    void copyFileContentToClipboard(content, { truncated });
  }, [content, contentDisabled, truncated]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors shrink-0 min-w-8 min-h-8 flex items-center justify-center rounded-sm',
            className
          )}
          aria-label="Copy file"
          title="Copy file"
        >
          <Copy className="h-3.5 w-3.5" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {showFileName && (
          <WorkspaceDropdownMenuItem icon={Copy} onSelect={handleCopyFileName}>
            Copy File Name
          </WorkspaceDropdownMenuItem>
        )}
        <WorkspaceDropdownMenuItem icon={Copy} onSelect={handleCopyRelativePath}>
          Copy Relative Path
        </WorkspaceDropdownMenuItem>
        <WorkspaceDropdownMenuItem icon={Copy} onSelect={handleCopyFullPath} disabled={!workingDir}>
          Copy Full Path
        </WorkspaceDropdownMenuItem>
        {showFileContent && (
          <WorkspaceDropdownMenuItem
            icon={Copy}
            onSelect={handleCopyContent}
            disabled={contentDisabled || !content}
          >
            {fileContentLabel}
          </WorkspaceDropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
