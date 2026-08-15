'use client';

import Link from '@tiptap/extension-link';
import Paragraph from '@tiptap/extension-paragraph';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from '@tiptap/markdown';
import { useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';

import { handleModEnter } from './handleModEnter';
import { looksLikeMarkdown } from './pasteMarkdown';

export interface UseMarkdownEditorOptions {
  content: string;
  onUpdate: (markdown: string) => void;
  placeholder?: string;
  editable?: boolean;
  autoFocus?: boolean;
  onCmdEnter?: () => void;
  initialClickCoords?: { left: number; top: number } | null;
}
type EditorInstance = NonNullable<ReturnType<typeof useEditor>>;
const ParagraphWithBlankLinePreservation = Paragraph.extend({
  renderMarkdown(node, h) {
    const content = Array.isArray(node.content) ? node.content : [];
    if (content.length === 0) return '&nbsp;';
    return h.renderChildren(content);
  },
});
function syncEditorFromExternalValue(
  editor: EditorInstance,
  content: string,
  internal: MutableRefObject<boolean>
) {
  if (internal.current) {
    internal.current = false;
    return;
  }
  if (content !== editor.getMarkdown())
    editor.commands.setContent(content, { contentType: 'markdown', emitUpdate: false });
}
export function useMarkdownEditor({
  content,
  onUpdate,
  placeholder,
  editable = true,
  autoFocus,
  onCmdEnter,
  initialClickCoords,
}: UseMarkdownEditorOptions) {
  const internal = useRef(false);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, paragraph: false }),
      ParagraphWithBlankLinePreservation,
      Placeholder.configure({ placeholder }),
      Link.configure({ openOnClick: false }),
      Markdown,
    ],
    content,
    contentType: 'markdown',
    editable,
    autofocus: initialClickCoords ? false : autoFocus ? true : false,
    editorProps: {
      attributes: { class: 'outline-none focus:outline-none focus-visible:outline-none' },
      handlePaste(_view, event) {
        const text = event.clipboardData?.getData('text/plain');
        if (text && looksLikeMarkdown(text)) {
          editor?.commands.insertContent(text, { contentType: 'markdown' });
          return true;
        }
        return false;
      },
      handleKeyDown: (_view, event) => {
        if (handleModEnter(event, onCmdEnter)) {
          event.preventDefault();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      internal.current = true;
      onUpdate(editor.getMarkdown());
    },
  });
  const setContent = useCallback(
    (md: string) => {
      editor?.commands.setContent(md, { contentType: 'markdown', emitUpdate: false });
    },
    [editor]
  );
  useEffect(() => {
    if (editor && !editor.isDestroyed) syncEditorFromExternalValue(editor, content, internal);
  }, [editor, content]);
  const applied = useRef(false);
  useEffect(() => {
    if (!editor || !initialClickCoords || applied.current) return;
    applied.current = true;
    requestAnimationFrame(() => {
      if (editor.isDestroyed) return;
      const result = editor.view.posAtCoords(initialClickCoords);
      if (result) editor.chain().setTextSelection(result.pos).focus().run();
      else editor.commands.focus('end');
    });
  }, [editor, initialClickCoords]);
  useEffect(() => {
    if (!initialClickCoords) applied.current = false;
  }, [initialClickCoords]);
  return { editor, setContent };
}
