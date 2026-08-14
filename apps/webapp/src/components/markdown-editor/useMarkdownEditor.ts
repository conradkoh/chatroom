'use client';

import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from '@tiptap/markdown';
import { useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';

import { looksLikeMarkdown } from './pasteMarkdown';

export interface UseMarkdownEditorOptions { content: string; onUpdate: (markdown: string) => void; placeholder?: string; editable?: boolean; autoFocus?: boolean; }
type EditorInstance = NonNullable<ReturnType<typeof useEditor>>;
function syncEditorFromExternalValue(editor: EditorInstance, content: string, internal: MutableRefObject<boolean>) {
  if (internal.current) { internal.current = false; return; }
  if (content !== editor.getMarkdown()) editor.commands.setContent(content, { contentType: 'markdown', emitUpdate: false });
}
export function useMarkdownEditor({ content, onUpdate, placeholder, editable = true, autoFocus }: UseMarkdownEditorOptions) {
  const internal = useRef(false);
  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] } }), Placeholder.configure({ placeholder }), Link.configure({ openOnClick: false }), Markdown],
    content, contentType: 'markdown', editable, autofocus: autoFocus ? true : false,
    editorProps: { attributes: { class: 'outline-none focus:outline-none focus-visible:outline-none' }, handlePaste(_view, event) { const text = event.clipboardData?.getData('text/plain'); if (text && looksLikeMarkdown(text)) { editor?.commands.insertContent(text, { contentType: 'markdown' }); return true; } return false; } },
    onUpdate: ({ editor }) => { internal.current = true; onUpdate(editor.getMarkdown()); },
  });
  const setContent = useCallback((md: string) => { editor?.commands.setContent(md, { contentType: 'markdown', emitUpdate: false }); }, [editor]);
  useEffect(() => { if (editor && !editor.isDestroyed) syncEditorFromExternalValue(editor, content, internal); }, [editor, content]);
  return { editor, setContent };
}
