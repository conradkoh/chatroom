import { Extension } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

import {
  getVisualLines,
  visualLineBoundaryTarget,
  type LineDirection,
} from './codeBlockVisualLines';

export function extendSelectionToLineBoundary(view: EditorView, direction: LineDirection): boolean {
  const { selection } = view.state;
  if (!(selection instanceof TextSelection)) return false;

  const head = selection.head;
  const $head = view.state.doc.resolve(head);
  if ($head.parent.type.name !== 'codeBlock') return false;

  const blockStart = $head.start();
  const blockEnd = $head.end();

  let lines;
  try {
    const charBeforeBlockEnd =
      blockEnd > blockStart ? view.state.doc.textBetween(blockEnd - 1, blockEnd) : '';
    lines = getVisualLines((pos, side) => view.coordsAtPos(pos, side), blockStart, blockEnd, {
      charBeforeBlockEnd,
    });
  } catch {
    return false;
  }

  const newHead = visualLineBoundaryTarget(lines, head, direction);
  if (newHead === null || newHead === head) return true;

  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, selection.anchor, newHead))
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

    return {
      'Shift-Alt-ArrowUp': handle('backward'),
      'Shift-Alt-ArrowDown': handle('forward'),
    };
  },
});
