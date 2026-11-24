'use client';

import { Check, Copy } from 'lucide-react';
import { memo, useCallback } from 'react';

import {
  buildFilePreviewMenuProps,
  WorkspaceFileActionsMenu,
  type FilePreviewMenuArgs,
} from '../../workspace/file-menu';
import {
  copyFileContentToClipboard,
  copyFileNameToClipboard,
} from '../../workspace/utils/clipboard';

import { useCopiedIndicator } from '@/hooks/useCopiedIndicator';
import { cn } from '@/lib/utils';

export interface FileCopyActionsMenuProps extends FilePreviewMenuArgs {
  className?: string;
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
  className,
  ...menuArgs
}: FileCopyActionsMenuProps) {
  const menuProps = buildFilePreviewMenuProps(menuArgs);
  return (
    <WorkspaceFileActionsMenu
      className={className}
      triggerVariant={menuArgs.triggerVariant}
      {...menuProps}
    />
  );
});
