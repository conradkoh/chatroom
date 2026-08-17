import { TextSelection } from '@tiptap/pm/state';
import { describe, expect, it, vi } from 'vitest';

import { extendSelectionToLineBoundary } from './codeBlockLineBoundarySelection';
import { createMarkdownEditorExtensions } from './markdownEditorExtensions';

vi.spyOn(TextSelection, 'create').mockImplementation(
  (_doc, anchor, head) => ({ anchor, head }) as TextSelection
);

function createCodeBlockView({ head, anchor = head }: { head: number; anchor?: number }) {
  const selection = Object.create(TextSelection.prototype) as TextSelection;
  Object.defineProperties(selection, {
    anchor: { value: anchor },
    head: { value: head },
    from: { value: Math.min(anchor, head) },
    to: { value: Math.max(anchor, head) },
  });
  const dispatch = vi.fn();
  const view = {
    state: {
      selection,
      doc: {
        resolve: () => ({
          parent: { type: { name: 'codeBlock' } },
          start: () => 1,
          end: () => 9,
        }),
      },
      tr: { setSelection: vi.fn().mockReturnThis() },
    },
    coordsAtPos: vi.fn((pos: number) => ({ top: pos < 4 ? 10 : pos < 7 ? 30 : 50 })),
    dispatch,
  };
  return { view, dispatch, selection };
}

describe('extendSelectionToLineBoundary', () => {
  it('moves backward from blockEnd to the final visual line start', () => {
    const { view, dispatch } = createCodeBlockView({ head: 9, anchor: 2 });

    expect(extendSelectionToLineBoundary(view as never, 'backward')).toBe(true);
    expect(dispatch).toHaveBeenCalled();
    expect(view.coordsAtPos).toHaveBeenCalledWith(9);
  });

  it('uses selection.head as the moving endpoint for reversed selections', () => {
    const { view, dispatch } = createCodeBlockView({ head: 5, anchor: 8 });

    expect(extendSelectionToLineBoundary(view as never, 'backward')).toBe(true);
    expect(dispatch).toHaveBeenCalled();
    expect(view.coordsAtPos).toHaveBeenCalledWith(5);
  });

  it('swallows a no-op at the visual line start', () => {
    const { view, dispatch } = createCodeBlockView({ head: 4 });

    expect(extendSelectionToLineBoundary(view as never, 'backward')).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does not intercept selections outside code blocks', () => {
    const { view } = createCodeBlockView({ head: 5 });
    view.state.doc.resolve = () => ({
      parent: { type: { name: 'paragraph' } },
      start: () => 1,
      end: () => 9,
    });

    expect(extendSelectionToLineBoundary(view as never, 'backward')).toBe(false);
  });
});

describe('CodeBlockLineBoundarySelection', () => {
  it('is registered in the markdown editor extensions', () => {
    expect(
      createMarkdownEditorExtensions().some(
        (extension) => extension.name === 'codeBlockLineBoundarySelection'
      )
    ).toBe(true);
  });
});
