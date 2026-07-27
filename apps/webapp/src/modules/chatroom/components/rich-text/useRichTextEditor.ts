'use client';

import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { useEditor } from '@tiptap/react';
import { useCallback } from 'react';

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
    editable,
    autofocus: autoFocus ? 'end' : false,
    onUpdate: ({ editor }) => {
      const md = editor.getMarkdown();
      onUpdate(md);
    },
  });

  const setContent = useCallback(
    (md: string) => {
      editor?.commands.setContent(md);
    },
    [editor]
  );

  return { editor, setContent };
}
