import { Extension } from '@tiptap/core';
// The package does not expose ProseMirror view types through this app's dependency graph.
type EditorView = any;

type LineDirection = 'backward' | 'forward';

// fallow-ignore-next-line complexity
// fallow-ignore-next-line unused-exports
export function extendSelectionToLineBoundary(view: EditorView, direction: LineDirection): boolean {
  const domSelection = view.root.getSelection?.() ?? view.dom.ownerDocument.getSelection();
  if (!domSelection) return false;
  const before = view.state.selection;
  if (domSelection.modify) {
    domSelection.modify('extend', direction, 'lineboundary');
    if (syncDomSelectionToProseMirror(view) && !view.state.selection.eq(before)) return true;
  }
  return extendSelectionToLineBoundaryByCoords(view, direction);
}

// fallow-ignore-next-line complexity
// fallow-ignore-next-line unused-exports
export function extendSelectionToLineBoundaryByCoords(
  view: EditorView,
  direction: LineDirection
): boolean {
  const { selection } = view.state;
  const head = direction === 'backward' ? selection.from : selection.to;
  const coords = view.coordsAtPos(head);
  const newHead =
    direction === 'backward'
      ? findPosOnVisualLineAbove(view, head, coords)
      : (view.posAtCoords({
          left: coords.left,
          top: coords.bottom + Math.max(coords.bottom - coords.top, 1) / 2,
        })?.pos ?? null);
  if (newHead === null || newHead === head) return false;
  view.dispatch(
    view.state.tr.setSelection(
      selection.constructor.create(view.state.doc, selection.anchor, newHead)
    )
  );
  return true;
}

// fallow-ignore-next-line complexity
// fallow-ignore-next-line unused-exports
export function findPosOnVisualLineAbove(
  view: EditorView,
  head: number,
  coords: { top: number; bottom: number; left: number }
): number | null {
  const lineHeight = Math.max(coords.bottom - coords.top, 1);
  const targetY = coords.top - lineHeight / 2;
  const blockStart = view.state.doc.resolve ? view.state.doc.resolve(head).start() : 0;
  const minLeft = (view.coordsAtPos(blockStart)?.left ?? 0) + 2;
  for (let left = coords.left; left >= minLeft; left -= 8) {
    const found = view.posAtCoords({ left, top: targetY });
    if (found && found.pos < head) return found.pos;
  }
  return null;
}

// fallow-ignore-next-line complexity
function syncDomSelectionToProseMirror(view: EditorView): boolean {
  const domSelection = view.root.getSelection?.() ?? view.dom.ownerDocument.getSelection();
  if (!domSelection?.rangeCount) return false;
  if (!domSelection.anchorNode || !domSelection.focusNode) return false;
  const anchorRect = document.createRange();
  anchorRect.setStart(domSelection.anchorNode, domSelection.anchorOffset);
  anchorRect.setEnd(domSelection.anchorNode, domSelection.anchorOffset);
  const headRect = document.createRange();
  headRect.setStart(domSelection.focusNode, domSelection.focusOffset);
  headRect.setEnd(domSelection.focusNode, domSelection.focusOffset);
  const anchor = view.posAtCoords({
    left: anchorRect.getBoundingClientRect().left,
    top: anchorRect.getBoundingClientRect().top,
  })?.pos;
  const head = view.posAtCoords({
    left: headRect.getBoundingClientRect().left,
    top: headRect.getBoundingClientRect().top,
  })?.pos;
  if (anchor === undefined || head === undefined) return false;
  if (anchor === view.state.selection.anchor && head === view.state.selection.head) return false;
  view.dispatch(
    view.state.tr.setSelection(
      view.state.selection.constructor.create(view.state.doc, anchor, head)
    )
  );
  return true;
}

export const CodeBlockLineBoundarySelection = Extension.create({
  name: 'codeBlockLineBoundarySelection',
  addKeyboardShortcuts() {
    const handle =
      (direction: LineDirection) =>
      ({ editor }: { editor: { isActive: (name: string) => boolean; view: EditorView } }) => {
        if (!editor.isActive('codeBlock')) return false;
        return extendSelectionToLineBoundary(editor.view, direction);
      };
    return { 'Shift-Alt-ArrowUp': handle('backward'), 'Shift-Alt-ArrowDown': handle('forward') };
  },
});
