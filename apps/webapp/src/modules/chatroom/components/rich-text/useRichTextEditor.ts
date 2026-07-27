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
}

export function useRichTextEditor({
  content,
  onUpdate,
  placeholder,
  editable = true,
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
    onUpdate: ({ editor }) => {
      const md = editor.storage.markdown.getMarkdown();
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
