'use client';

import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from '@tiptap/markdown';
import { useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useCallback, useEffect } from 'react';

import { looksLikeMarkdown } from './pasteMarkdown';

export interface UseRichTextEditorOptions {
  content: string;
  onUpdate: (markdown: string) => void;
  placeholder?: string;
  editable?: boolean;
  autoFocus?: boolean;
}

export function useRichTextEditor({
  content,
  onUpdate,
  placeholder,
  editable = true,
  autoFocus,
}: UseRichTextEditorOptions) {
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
    autofocus: autoFocus ? true : false,
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
    },
    onUpdate: ({ editor }) => {
      const md = editor.getMarkdown();
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
    const current = editor.getMarkdown();
    if (content !== current) {
      editor.commands.setContent(content, { contentType: 'markdown', emitUpdate: false });
    }
  }, [editor, content]);

  return { editor, setContent };
}
