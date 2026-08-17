import { describe, expect, it, vi } from 'vitest';

import { extendSelectionToLineBoundaryByCoords } from './codeBlockLineBoundarySelection';
import { createMarkdownEditorExtensions } from './markdownEditorExtensions';

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
      state: { selection, doc: { resolve: () => ({ start: () => 1 }) }, tr: { setSelection } },
      coordsAtPos: vi.fn((pos: number) =>
        pos === 1 ? { top: 10, bottom: 20, left: 0 } : { top: 20, bottom: 30, left: 10 }
      ),
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

  it('sweeps left when upward probe at current column returns the same position', () => {
    const dispatch = vi.fn();
    const setSelection = vi.fn().mockReturnThis();
    const selection = {
      from: 500,
      to: 500,
      anchor: 10,
      head: 500,
      constructor: { create: vi.fn(() => ({})) },
    };
    const posAtCoords = vi.fn().mockReturnValueOnce({ pos: 500 }).mockReturnValueOnce({ pos: 480 });
    const view = {
      state: { selection, doc: { resolve: () => ({ start: () => 1 }) }, tr: { setSelection } },
      coordsAtPos: vi.fn((pos: number) =>
        pos === 1 ? { top: 10, bottom: 20, left: 0 } : { top: 100, bottom: 110, left: 800 }
      ),
      posAtCoords,
      dispatch,
    };
    expect(extendSelectionToLineBoundaryByCoords(view as never, 'backward')).toBe(true);
    expect(posAtCoords).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenCalled();
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
