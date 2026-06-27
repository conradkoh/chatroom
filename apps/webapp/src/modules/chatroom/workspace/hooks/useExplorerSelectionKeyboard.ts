import { useEffect, type RefObject } from 'react';

export function useExplorerSelectionKeyboard(
  containerRef: RefObject<HTMLElement | null>,
  filePath: string,
  onSendSelectionToComposer?: (payload: { filePath: string; selectedText: string }) => void
): void {
  useEffect(() => {
    if (!onSendSelectionToComposer) return;

    // fallow-ignore-next-line complexity
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'i') return;
      if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) {
        return;
      }

      const selection = window.getSelection();
      const selectedText = selection?.toString().trim() ?? '';
      if (!selectedText) return;

      const anchorNode = selection?.anchorNode;
      const container = containerRef.current;
      if (!container || !anchorNode || !container.contains(anchorNode)) return;

      event.preventDefault();
      onSendSelectionToComposer({ filePath, selectedText });
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [containerRef, filePath, onSendSelectionToComposer]);
}
