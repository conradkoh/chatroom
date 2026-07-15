'use client';

import { Copy } from 'lucide-react';
import { memo, useCallback } from 'react';

import { WorkspaceFileActionsMenu } from '../../workspace/file-menu';
import {
  copyFileContentToClipboard,
  copyFileNameToClipboard,
} from '../../workspace/utils/clipboard';

import { cn } from '@/lib/utils';

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
  /** When provided, shows "Open File on Remote" in Path section. */
  onOpenFileOnRemote?: () => void;
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

export const FileCopyActionsMenu = memo(function FileCopyActionsMenu({
  relativePath,
  workingDir,
  content,
  truncated,
  contentDisabled,
  className,
  showFileName = true,
  showFileContent = true,
  fileContentLabel = 'Copy File Content',
  triggerVariant = 'copy',
  onOpenInExplorer,
  onOpenFileOnRemote,
}: FileCopyActionsMenuProps) {
  return (
    <WorkspaceFileActionsMenu
      className={className}
      triggerVariant={triggerVariant}
      state={{
        relativePath,
        workingDir,
        content,
        contentTruncated: truncated,
        contentDisabled,
        fileContentLabel,
      }}
      handlers={{ onOpenInExplorer, onOpenFileOnRemote }}
      visibility={{
        copyFileName: showFileName,
        copyRelativePath: true,
        copyFullPath: true,
        copyFileContent: showFileContent,
        openInExplorer: !!onOpenInExplorer,
        openFileOnRemote: !!onOpenFileOnRemote,
      }}
    />
  );
});
