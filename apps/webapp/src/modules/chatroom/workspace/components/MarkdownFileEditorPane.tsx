'use client';

import { BookOpen, FileWarning } from 'lucide-react';
import { memo, useCallback, useRef, type KeyboardEvent } from 'react';
import { toast } from 'sonner';

import { pendingOptimisticNewFilePaths } from '../hooks/pendingOptimisticNewFilePaths';
import { useRemoteSelectionContextMenu } from '../hooks/useExplorerSelectionKeyboard';
import { useMarkdownFileEditor } from '../hooks/useMarkdownFileEditor';

import { ChatroomLoader } from '@/components/ui/chatroom-loader';
import { getFileName } from '@/lib/pathUtils';
import { FileContentActionBar } from './FileContentActionBar';
import { cn } from '@/lib/utils';

const EMPTY_FILE_PLACEHOLDER = 'This file is empty.';

interface MarkdownFileEditorPaneProps {
  machineId: string;
  workingDir: string;
  filePath: string;
  onOpenPreview?: (filePath: string) => void;
  onSendSelectionToComposer?: (payload: { filePath: string; selectedText: string }) => void;
  onOpenSelectionOnRemote?: (filePath: string, selectedText: string) => void;
}

// fallow-ignore-next-line complexity
export const MarkdownFileEditorPane = memo(function MarkdownFileEditorPane({
  machineId,
  workingDir,
  filePath,
  onOpenPreview,
  onOpenSelectionOnRemote,
}: MarkdownFileEditorPaneProps) {
  const initialEmpty = pendingOptimisticNewFilePaths.has(filePath);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const { onContextMenu, selectionMenu } = useRemoteSelectionContextMenu(
    filePath,
    onOpenSelectionOnRemote
  );
  const { content, setContent, isDirty, contentRef, save, saving, error, isLoading, encoding } =
    useMarkdownFileEditor({ machineId, workingDir, filePath, initialEmpty });

  if (encoding === 'binary') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-chatroom-text-muted p-8">
        <FileWarning size={40} className="text-chatroom-text-muted/50" />
        <div className="text-sm">Binary file — cannot be displayed as text</div>
        <div className="text-xs text-chatroom-text-muted/70">{filePath}</div>
      </div>
    );
  }

  const handleKeyDown = useCallback(
    // fallow-ignore-next-line complexity
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;

      const container = editorContainerRef.current;
      const active = document.activeElement;
      if (!container || !active || !container.contains(active)) return;

      event.preventDefault();
      event.stopPropagation();
      void save();
    },
    [save]
  );

  const handleCopyMarkdown = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(contentRef.current);
      toast.success('Copied markdown to clipboard');
    } catch {
      toast.error('Failed to copy markdown');
    }
  }, [contentRef]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2 text-chatroom-text-muted text-sm">
        <ChatroomLoader size="sm" />
        Loading…
      </div>
    );
  }

  return (
    <div
      ref={editorContainerRef}
      className="flex-1 flex flex-col min-h-0 overflow-hidden"
      onKeyDown={handleKeyDown}
    >
      {selectionMenu}
      <FileContentActionBar
        copyLabel="Copy as markdown"
        onCopy={() => void handleCopyMarkdown()}
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
        <div className="px-4 py-2 text-xs text-chatroom-status-error border-b border-chatroom-border">
          {error}
        </div>
      )}

      <textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        onContextMenu={onContextMenu}
        placeholder={EMPTY_FILE_PLACEHOLDER}
        spellCheck={false}
        className={cn(
          'flex-1 min-h-0 w-full resize-none bg-transparent p-4',
          'font-mono text-[13px] leading-relaxed text-chatroom-text-primary',
          'placeholder:italic placeholder:text-chatroom-text-muted',
          'outline-none border-0'
        )}
        aria-label={`Edit ${filePath}`}
      />
    </div>
  );
});
