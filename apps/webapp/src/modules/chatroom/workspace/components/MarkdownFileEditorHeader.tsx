'use client';

import { BookOpen, X } from 'lucide-react';

import { FileContentActionBar } from './FileContentActionBar';

import { getFileName } from '@/lib/pathUtils';
import { cn } from '@/lib/utils';

interface MarkdownFileEditorHeaderProps {
  filePath: string;
  isDirty: boolean;
  saving: boolean;
  error: string | null;
  onCopy: () => void;
  onOpenPreview?: (filePath: string) => void;
  onDismissError?: () => void;
  isDismissingError?: boolean;
}

export function MarkdownFileEditorHeader({
  filePath,
  isDirty,
  saving,
  error,
  onCopy,
  onOpenPreview,
  onDismissError,
  isDismissingError,
}: MarkdownFileEditorHeaderProps) {
  return (
    <>
      <FileContentActionBar
        copyLabel="Copy as markdown"
        onCopy={onCopy}
        leading={
          <>
            <span className="text-xs text-chatroom-text-secondary truncate">
              {getFileName(filePath)}
              {isDirty ? ' *' : ''}
            </span>
            {saving && (
              <span className="text-[10px] text-chatroom-text-muted uppercase tracking-wide">
                Saving…
              </span>
            )}
          </>
        }
        trailing={
          onOpenPreview ? (
            <button
              type="button"
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
          ) : undefined
        }
      />

      {error && (
        <div className="flex items-center gap-2 px-4 py-2 text-xs text-chatroom-status-error border-b border-chatroom-border">
          <span className="flex-1">{error}</span>
          {onDismissError && (
            <button
              type="button"
              className={cn(
                'shrink-0 rounded p-1 transition-colors cursor-pointer',
                'text-chatroom-status-error hover:bg-chatroom-bg-hover',
                'disabled:cursor-not-allowed disabled:opacity-50'
              )}
              aria-label="Dismiss error"
              title="Dismiss error"
              aria-busy={isDismissingError || undefined}
              disabled={isDismissingError}
              onClick={onDismissError}
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </>
  );
}
