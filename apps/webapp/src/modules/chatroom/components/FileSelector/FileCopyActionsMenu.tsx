'use client';

import { Copy, FolderOpen, MoreHorizontal } from 'lucide-react';
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
  /** When false, omits file content from the dropdown (desktop uses CopyFileContentButton). */
  showFileContent?: boolean;
  fileContentLabel?: string;
  /** `copy` = mobile all-in-one menu; `more` = desktop path-only overflow menu. */
  triggerVariant?: 'copy' | 'more';
  /** When provided, shows "Open in Explorer" at bottom of dropdown. */
  onOpenInExplorer?: () => void;
}

const copyContentButtonClassName =
  'items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors shrink-0 rounded-sm disabled:opacity-50 disabled:pointer-events-none';

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

export const CopyFileContentButton = memo(function CopyFileContentButton({
  content,
  truncated = false,
  disabled = false,
  label,
  className,
}: {
  content: string | null;
  truncated?: boolean;
  disabled?: boolean;
  label: string;
  className?: string;
}) {
  const handleCopy = useCallback(() => {
    if (!content || disabled) return;
    void copyFileContentToClipboard(content, { truncated });
  }, [content, disabled, truncated]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={disabled || !content}
      className={cn('flex', copyContentButtonClassName, className)}
      aria-label={label}
      title={label}
    >
      <Copy className="h-3.5 w-3.5" aria-hidden />
      {label}
    </button>
  );
});

// fallow-ignore-next-line complexity
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
  triggerVariant = 'copy',
  onOpenInExplorer,
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

  const isMoreTrigger = triggerVariant === 'more';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors shrink-0 min-w-8 min-h-8 flex items-center justify-center rounded-sm',
            className
          )}
          aria-label={isMoreTrigger ? 'More copy options' : 'Copy file'}
          title={isMoreTrigger ? 'More copy options' : 'Copy file'}
        >
          {isMoreTrigger ? (
            <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Copy className="h-3.5 w-3.5" aria-hidden />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Path</DropdownMenuLabel>
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
        {onOpenInExplorer && (
          <WorkspaceDropdownMenuItem icon={FolderOpen} onSelect={onOpenInExplorer}>
            Open in Explorer
          </WorkspaceDropdownMenuItem>
        )}
        {showFileContent && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Content</DropdownMenuLabel>
            <WorkspaceDropdownMenuItem
              icon={Copy}
              onSelect={handleCopyContent}
              disabled={contentDisabled || !content}
            >
              {fileContentLabel}
            </WorkspaceDropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
