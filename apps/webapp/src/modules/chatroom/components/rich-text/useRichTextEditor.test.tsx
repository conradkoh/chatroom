// @vitest-environment jsdom

import { render, waitFor } from '@testing-library/react';
import { EditorContent } from '@tiptap/react';
import { act, useEffect, useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { useRichTextEditor } from './useRichTextEditor';

type RichTextEditorInstance = NonNullable<ReturnType<typeof useRichTextEditor>['editor']>;

let latestEditor: RichTextEditorInstance | undefined;

function ControlledEditorHarness({ value }: { value: string }) {
  const [content, setContent] = useState(value);
  const { editor } = useRichTextEditor({ content, onUpdate: setContent });

  useEffect(() => {
    setContent(value);
  }, [value]);

  if (editor) {
    latestEditor = editor;
  }

  if (!editor) return null;

  return <EditorContent editor={editor} />;
}

function ClickPositionHarness({
  initialClickCoords,
}: {
  initialClickCoords?: { left: number; top: number } | null;
}) {
  const { editor } = useRichTextEditor({
    content: 'hello world',
    onUpdate: () => {},
    initialClickCoords,
  });

  if (editor) {
    latestEditor = editor;
  }

  if (!editor) return null;

  return <EditorContent editor={editor} />;
}

describe('useRichTextEditor controlled sync', () => {
  beforeAll(() => {
    if (typeof document.elementFromPoint !== 'function') {
      document.elementFromPoint = () => null;
    }
  });

  it('preserves cursor position on internal updates (insert mid-string)', async () => {
    latestEditor = undefined;
    render(<ControlledEditorHarness value="hello world" />);

    await waitFor(() => expect(latestEditor).toBeDefined());

    act(() => {
      latestEditor!.commands.setTextSelection(6);
      latestEditor!.commands.insertContent('X');
    });

    await waitFor(() => {
      const selectionAfter = latestEditor!.state.selection.from;
      const docEnd = latestEditor!.state.doc.content.size;
      expect(selectionAfter).toBeLessThan(docEnd);
      expect(latestEditor!.getText()).toContain('helloX');
    });
  });

  it('syncs external value changes into the editor', async () => {
    const { rerender } = render(<ControlledEditorHarness value="original content" />);

    await waitFor(() => {
      expect(document.querySelector('.ProseMirror')?.textContent).toContain('original');
    });

    rerender(<ControlledEditorHarness value="reset content" />);

    await waitFor(() => {
      expect(document.querySelector('.ProseMirror')?.textContent).toContain('reset content');
    });
  });
});

describe('useRichTextEditor initial click coordinates', () => {
  beforeAll(() => {
    if (typeof document.elementFromPoint !== 'function') {
      document.elementFromPoint = () => null;
    }
    if (typeof HTMLElement.prototype.scrollIntoView !== 'function') {
      HTMLElement.prototype.scrollIntoView = () => {};
    }
    // ProseMirror's scrollToSelection computes caret rects via Range APIs that
    // jsdom does not implement.
    const zeroRect: DOMRect = {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
    if (typeof Range.prototype.getClientRects !== 'function') {
      Range.prototype.getClientRects = (() => [
        zeroRect,
      ]) as unknown as typeof Range.prototype.getClientRects;
    }
    if (typeof Range.prototype.getBoundingClientRect !== 'function') {
      Range.prototype.getBoundingClientRect = () => zeroRect;
    }
  });

  it('places the caret at the clicked position when initialClickCoords are provided', async () => {
    latestEditor = undefined;
    render(<ClickPositionHarness initialClickCoords={{ left: 100, top: 100 }} />);

    await waitFor(() => expect(latestEditor).toBeDefined());

    const spy = vi.spyOn(latestEditor!.view, 'posAtCoords').mockReturnValue({ pos: 6, inside: 1 });

    await waitFor(() => {
      expect(latestEditor!.state.selection.from).toBe(6);
    });

    spy.mockRestore();
  });

  it('focuses the document end when posAtCoords returns null (click below content)', async () => {
    latestEditor = undefined;
    render(<ClickPositionHarness initialClickCoords={{ left: 100, top: 500 }} />);

    await waitFor(() => expect(latestEditor).toBeDefined());

    const spy = vi.spyOn(latestEditor!.view, 'posAtCoords').mockReturnValue(null);

    await waitFor(() => {
      // Single-paragraph doc "hello world": last valid cursor is size - 1.
      expect(latestEditor!.state.selection.from).toBe(latestEditor!.state.doc.content.size - 1);
    });

    spy.mockRestore();
  });

  it('does not apply click coordinates again after they are cleared', async () => {
    latestEditor = undefined;
    const { rerender } = render(
      <ClickPositionHarness initialClickCoords={{ left: 100, top: 100 }} />
    );

    await waitFor(() => expect(latestEditor).toBeDefined());

    const spy = vi.spyOn(latestEditor!.view, 'posAtCoords').mockReturnValue({ pos: 6, inside: 1 });

    await waitFor(() => {
      expect(latestEditor!.state.selection.from).toBe(6);
    });

    // New edit session: coords cleared, then a fresh set is provided.
    rerender(<ClickPositionHarness initialClickCoords={null} />);
    rerender(<ClickPositionHarness initialClickCoords={{ left: 200, top: 200 }} />);

    // posAtCoords should have been called again for the new session.
    await waitFor(() => {
      expect(spy).toHaveBeenCalledTimes(2);
    });

    spy.mockRestore();
  });
});
