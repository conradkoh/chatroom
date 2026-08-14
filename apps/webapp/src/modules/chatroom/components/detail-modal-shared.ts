import { useCallback, useRef, type MouseEvent } from 'react';

export { ChatroomMarkdownEditor, ChatroomMarkdownEditorShell, chatroomEditorContentClassName, CHATROOM_EDITOR_WRAPPER_CLASS, handleChatroomModEnterCapture } from './chatroom-markdown-editor';

export const CLICK_TO_EDIT_DRAG_THRESHOLD_PX = 5;

export function hasNonEmptyTextSelection(): boolean {
  return typeof window !== 'undefined' && Boolean(window.getSelection()?.toString());
}

export function exceededDragThreshold(start: { x: number; y: number } | null, event: Pick<MouseEvent, 'clientX' | 'clientY'>): boolean {
  if (!start) return false;
  return Math.abs(event.clientX - start.x) > 5 || Math.abs(event.clientY - start.y) > 5;
}

export function isInteractiveClickTarget(target: EventTarget | null): boolean {
  return !!(target as HTMLElement)?.closest?.('button, a, input, textarea, select, label');
}

export function useClickToEditHandlers(onEnterEdit: () => void, enabled = true) {
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const onMouseDown = useCallback((event: MouseEvent) => {
    if (enabled) pointerStartRef.current = { x: event.clientX, y: event.clientY };
  }, [enabled]);
  const onClick = useCallback((event: MouseEvent) => {
    if (!enabled) return;
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (isInteractiveClickTarget(event.target) || hasNonEmptyTextSelection() || exceededDragThreshold(start, event)) return;
    onEnterEdit();
  }, [enabled, onEnterEdit]);
  return { onMouseDown, onClick };
}
