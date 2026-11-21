'use client';

import { useCallback, type KeyboardEvent, type RefObject } from 'react';

import { copyTextToClipboard } from '../utils/clipboard';

const MARKDOWN_COPY_FAILED_MESSAGE = 'Failed to copy markdown';

interface UseMarkdownFileEditorPaneActionsArgs {
  editorContainerRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<string>;
  save: () => Promise<void>;
  onCopied: () => void;
  onCopyError: (message: string) => void;
}

export function useMarkdownFileEditorPaneActions({
  editorContainerRef,
  contentRef,
  save,
  onCopied,
  onCopyError,
}: UseMarkdownFileEditorPaneActionsArgs) {
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
    [editorContainerRef, save]
  );

  const handleCopyMarkdown = useCallback(async () => {
    const result = await copyTextToClipboard(contentRef.current);
    if (result.ok) onCopied();
    else onCopyError(MARKDOWN_COPY_FAILED_MESSAGE);
  }, [contentRef, onCopied, onCopyError]);

  return { handleKeyDown, handleCopyMarkdown };
}
