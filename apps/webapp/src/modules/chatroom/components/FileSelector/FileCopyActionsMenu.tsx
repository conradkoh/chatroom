'use client';

import { Check, Copy } from 'lucide-react';
import { memo, useCallback } from 'react';

import { WorkspaceFileActionsMenu, type WorkspaceFileCopyInfo } from '../../workspace/file-menu';
import {
  copyFileContentToClipboard,
  copyFileNameToClipboard,
} from '../../workspace/utils/clipboard';

import { useCopiedIndicator } from '@/hooks/useCopiedIndicator';
import { cn } from '@/lib/utils';

export interface FileCopyActionsMenuProps {
  relativePath: string;
  workingDir: string | null;
  content: string | null;
  /** True when `content` is a truncated copy of the file. Reported through onCopied; never shown here. */
  contentTruncated?: boolean;
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
  /** Receives a copy failure message. The host shows it in its own slot. */
  onCopyError?: (message: string) => void;
  /** Called after a copy succeeds, with what was copied. Hosts may clear their own copy failure. Never show copy text here. */
  onCopied?: (info: WorkspaceFileCopyInfo) => void;
}

interface CopyHostCallbacks {
  onCopied?: () => void;
  onCopyError?: (message: string) => void;
}

const copyContentButtonClassName =
  'items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted hover:text-chatroom-text-primary hover:bg-chatroom-bg-hover transition-colors shrink-0 rounded-sm disabled:opacity-50 disabled:pointer-events-none';

export const CopyFileNameButton = memo(function CopyFileNameButton({
  relativePath,
  className,
  onCopied,
  onCopyError,
}: { relativePath: string; className?: string } & CopyHostCallbacks) {
  const { copied, markCopied } = useCopiedIndicator();
  const handleCopy = useCallback(() => {
    void copyFileNameToClipboard(relativePath).then((result) => {
      if (result.ok) {
        markCopied();
        onCopied?.();
      } else {
        onCopyError?.(result.message);
      }
    });
  }, [relativePath, markCopied, onCopied, onCopyError]);

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
      {copied ? (
        <Check className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden />
      )}
    </button>
  );
});

export const CopyFileContentButton = memo(function CopyFileContentButton({
  content,
  disabled = false,
  label,
  className,
  onCopied,
  onCopyError,
}: {
  content: string | null;
  disabled?: boolean;
  label: string;
  className?: string;
} & CopyHostCallbacks) {
  const { copied, markCopied } = useCopiedIndicator();
  const handleCopy = useCallback(() => {
    if (!content || disabled) return;
    void copyFileContentToClipboard(content).then((result) => {
      if (result.ok) {
        markCopied();
        onCopied?.();
      } else {
        onCopyError?.(result.message);
      }
    });
  }, [content, disabled, markCopied, onCopied, onCopyError]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={disabled || !content}
      className={cn('flex', copyContentButtonClassName, className)}
      aria-label={label}
      title={label}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden />
      )}
      {label}
    </button>
  );
});

export const FileCopyActionsMenu = memo(function FileCopyActionsMenu({
  relativePath,
  workingDir,
  content,
  contentTruncated,
  contentDisabled,
  className,
  showFileName = true,
  showFileContent = true,
  fileContentLabel = 'Copy File Content',
  triggerVariant = 'copy',
  onOpenInExplorer,
  onOpenFileOnRemote,
  onCopyError,
  onCopied,
}: FileCopyActionsMenuProps) {
  return (
    <WorkspaceFileActionsMenu
      className={className}
      triggerVariant={triggerVariant}
      state={{
        relativePath,
        workingDir,
        content,
        contentTruncated,
        contentDisabled,
        fileContentLabel,
      }}
      handlers={{ onOpenInExplorer, onOpenFileOnRemote, onCopyError, onCopied }}
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
