import { describe, expect, it, vi } from 'vitest';

import { createMarkdownEditorExtensions } from './markdownEditorExtensions';
import { extendSelectionToLineBoundaryByCoords } from './codeBlockLineBoundarySelection';

describe('extendSelectionToLineBoundaryByCoords', () => {
  it('moves the head upward when a new position is found', () => {
    const dispatch = vi.fn();
    const setSelection = vi.fn().mockReturnThis();
    const selection = {
      from: 10,
      to: 15,
      anchor: 10,
      head: 15,
      constructor: { create: vi.fn(() => ({ anchor: 10, head: 8 })) },
    };
    const view = {
      state: { selection, doc: {} , tr: { setSelection } },
      coordsAtPos: vi.fn(() => ({ top: 20, bottom: 30, left: 5 })),
      posAtCoords: vi.fn(() => ({ pos: 8 })),
      dispatch,
    };

    expect(extendSelectionToLineBoundaryByCoords(view as never, 'backward')).toBe(true);
    expect(setSelection).toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalled();
  });

  it('returns false when the fallback position is unchanged', () => {
    const view = {
      state: { selection: { from: 10, to: 15, anchor: 10 }, doc: {} },
      coordsAtPos: () => ({ top: 20, bottom: 30, left: 5 }),
      posAtCoords: () => ({ pos: 10 }),
      dispatch: vi.fn(),
    };
    expect(extendSelectionToLineBoundaryByCoords(view as never, 'backward')).toBe(false);
    expect(view.dispatch).not.toHaveBeenCalled();
  });
});

describe('CodeBlockLineBoundarySelection', () => {
  it('is registered in the markdown editor extensions', () => {
    expect(createMarkdownEditorExtensions().some((extension) => extension.name === 'codeBlockLineBoundarySelection')).toBe(true);
  });
});
