'use client';

import { useCallback, type KeyboardEvent, type RefObject } from 'react';
import { toast } from 'sonner';

interface UseMarkdownFileEditorPaneActionsArgs {
  editorContainerRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<string>;
  save: () => Promise<void>;
}

export function useMarkdownFileEditorPaneActions({
  editorContainerRef,
  contentRef,
  save,
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
    try {
      await navigator.clipboard.writeText(contentRef.current);
      toast.success('Copied markdown to clipboard');
    } catch {
      toast.error('Failed to copy markdown');
    }
  }, [contentRef]);

  return { handleKeyDown, handleCopyMarkdown };
}
