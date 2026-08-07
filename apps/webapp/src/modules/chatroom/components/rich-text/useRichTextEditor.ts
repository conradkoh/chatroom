'use client';

import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from '@tiptap/markdown';
import { useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';

import { handleRichTextModEnter } from './handleRichTextModEnter';
import { looksLikeMarkdown } from './pasteMarkdown';

export interface UseRichTextEditorOptions {
  content: string;
  onUpdate: (markdown: string) => void;
  placeholder?: string;
  editable?: boolean;
  autoFocus?: boolean;
  onCmdEnter?: () => void;
  /** Viewport coords from click-to-edit; caret placed via posAtCoords on mount. */
  initialClickCoords?: { left: number; top: number } | null;
}

type RichTextEditorInstance = NonNullable<ReturnType<typeof useEditor>>;

function syncEditorFromExternalValue(
  editor: RichTextEditorInstance,
  content: string,
  isInternalUpdateRef: MutableRefObject<boolean>
): void {
  if (isInternalUpdateRef.current) {
    isInternalUpdateRef.current = false;
    return;
  }
  const current = editor.getMarkdown();
  if (content !== current) {
    editor.commands.setContent(content, { contentType: 'markdown', emitUpdate: false });
  }
}

export function useRichTextEditor({
  content,
  onUpdate,
  placeholder,
  editable = true,
  autoFocus,
  onCmdEnter,
  initialClickCoords,
}: UseRichTextEditorOptions) {
  const isInternalUpdateRef = useRef(false);
  const appliedInitialCoordsRef = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({ placeholder }),
      Link.configure({ openOnClick: false }),
      Markdown,
    ],
    content,
    contentType: 'markdown',
    editable,
    // When initialClickCoords is provided, do NOT autofocus — it conflicts
    // with positioning the caret at the click location via posAtCoords.
    autofocus: initialClickCoords ? false : autoFocus ? true : false,
    editorProps: {
      attributes: {
        class: 'outline-none focus:outline-none focus-visible:outline-none',
      },
      handlePaste(_view, event) {
        const text = event.clipboardData?.getData('text/plain');
        if (text && looksLikeMarkdown(text)) {
          editor?.commands.insertContent(text, { contentType: 'markdown' });
          return true;
        }
        return false;
      },
      handleKeyDown: (_view, event) => {
        if (handleRichTextModEnter(event, onCmdEnter)) {
          event.preventDefault();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      const md = editor.getMarkdown();
      isInternalUpdateRef.current = true;
      onUpdate(md);
    },
  });

  const setContent = useCallback(
    (md: string) => {
      editor?.commands.setContent(md, { contentType: 'markdown', emitUpdate: false });
    },
    [editor]
  );

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    syncEditorFromExternalValue(editor, content, isInternalUpdateRef);
  }, [editor, content]);

  // Apply the click position once, after the ProseMirror DOM is laid out.
  useEffect(() => {
    if (!editor) return;
    if (appliedInitialCoordsRef.current) return;
    const coords = initialClickCoords;
    if (!coords) return;
    appliedInitialCoordsRef.current = true;

    requestAnimationFrame(() => {
      if (editor.isDestroyed) return;
      applyInitialClickPosition(editor, coords);
    });
  }, [editor, initialClickCoords]);

  // Reset the one-shot flag when a new edit session starts (coords cleared).
  useEffect(() => {
    if (!initialClickCoords) appliedInitialCoordsRef.current = false;
  }, [initialClickCoords]);

  return { editor, setContent };
}

function applyInitialClickPosition(
  editor: RichTextEditorInstance,
  coords: { left: number; top: number }
): void {
  const result = editor.view.posAtCoords(coords);
  if (result) {
    editor.chain().setTextSelection(result.pos).focus().run();
  } else {
    editor.commands.focus('end');
  }
}
