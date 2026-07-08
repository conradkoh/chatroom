import { ExternalLink } from 'lucide-react';
import { useCallback, useEffect, useState, type RefObject } from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { WorkspaceDropdownMenuItem } from '../components/WorkspaceDropdownMenuItem';

// fallow-ignore-next-line complexity
function readSelectionInsideContainer(container: Node): string | null {
  const selection = window.getSelection();
  if (!selection) return null;
  const text = selection.toString().trim();
  const anchorNode = selection.anchorNode;
  if (!text || !anchorNode || !container.contains(anchorNode)) return null;
  return text;
}

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

      const container = containerRef.current;
      if (!container) return;
      const selectedText = readSelectionInsideContainer(container);
      if (!selectedText) return;

      event.preventDefault();
      onSendSelectionToComposer({ filePath, selectedText });
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [containerRef, filePath, onSendSelectionToComposer]);
}

export function useRemoteSelectionContextMenu(
  filePath: string,
  onOpenSelectionOnRemote?: (filePath: string, selectedText: string) => void
) {
  const [open, setOpen] = useState(false);
  const [point, setPoint] = useState({ x: 0, y: 0 });
  const [selectedText, setSelectedText] = useState('');

  const onContextMenu = useCallback(
    (event: React.MouseEvent) => {
      if (!onOpenSelectionOnRemote) return;

      const text = readSelectionInsideContainer(event.currentTarget);
      if (!text) return;

      event.preventDefault();
      setSelectedText(text);
      setPoint({ x: event.clientX, y: event.clientY });
      setOpen(true);
    },
    [onOpenSelectionOnRemote]
  );

  const selectionMenu =
    onOpenSelectionOnRemote != null ? (
      <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
        <DropdownMenuTrigger asChild>
          <span
            aria-hidden
            style={{
              position: 'fixed',
              left: point.x,
              top: point.y,
              width: 1,
              height: 1,
              pointerEvents: 'none',
            }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <WorkspaceDropdownMenuItem
            icon={ExternalLink}
            onSelect={() => {
              onOpenSelectionOnRemote(filePath, selectedText);
              setOpen(false);
            }}
          >
            Open Selection on Remote
          </WorkspaceDropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;

  return { onContextMenu, selectionMenu };
}
