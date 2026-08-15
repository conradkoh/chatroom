'use client';
import { useEditor } from '@tiptap/react';
import { useCallback, useEffect, useRef } from 'react';
import { handleModEnter } from './handleModEnter';
import { looksLikeMarkdown } from './pasteMarkdown';
import { createMarkdownEditorExtensions } from './markdownEditorExtensions';
import { getNormalizedEditorMarkdown } from './getNormalizedEditorMarkdown';
import { looksLikeHtml, normalizeMarkdownContent } from './normalizeMarkdownContent';
import type { MarkdownContentNormalizer } from './types';
export interface UseMarkdownEditorOptions { content: string; onUpdate: (markdown: string) => void; placeholder?: string; editable?: boolean; autoFocus?: boolean; onCmdEnter?: () => void; initialClickCoords?: { left: number; top: number } | null; normalizeContent?: MarkdownContentNormalizer; }
export function useMarkdownEditor({ content, onUpdate, placeholder, editable = true, autoFocus, onCmdEnter, initialClickCoords, normalizeContent }: UseMarkdownEditorOptions) {
  const normalize = normalizeContent ?? normalizeMarkdownContent;
  const internal = useRef(false);
  const editor = useEditor({ extensions: createMarkdownEditorExtensions(placeholder), content: normalize(content), contentType: 'markdown', editable, autofocus: initialClickCoords ? false : !!autoFocus,
    editorProps: { attributes: { class: 'outline-none focus:outline-none focus-visible:outline-none' }, handlePaste(_view, event) { const html = event.clipboardData?.getData('text/html'); const text = event.clipboardData?.getData('text/plain'); if (html) { editor?.commands.insertContent(normalizeMarkdownContent(html) || text || '', { contentType: 'markdown' }); return true; } if (text && (looksLikeHtml(text) || looksLikeMarkdown(text))) { editor?.commands.insertContent(normalizeMarkdownContent(text), { contentType: 'markdown' }); return true; } return false; }, handleKeyDown: (_view, event) => { if (handleModEnter(event, onCmdEnter)) { event.preventDefault(); return true; } return false; } },
    onUpdate: ({ editor }) => { internal.current = true; onUpdate(getNormalizedEditorMarkdown(editor, normalize)); },
  });
  const setContent = useCallback((md: string) => editor?.commands.setContent(normalize(md), { contentType: 'markdown', emitUpdate: false }), [editor, normalize]);
  useEffect(() => { if (!editor || editor.isDestroyed || internal.current) { if (internal.current) internal.current = false; return; } const normalized = normalize(content); if (normalized !== getNormalizedEditorMarkdown(editor, normalize)) { editor.commands.setContent(normalized, { contentType: 'markdown', emitUpdate: false }); if (normalized !== content.trim()) { internal.current = true; onUpdate(normalized); } } }, [editor, content, onUpdate, normalize]);
  const applied = useRef(false);
  useEffect(() => { if (!editor || !initialClickCoords || applied.current) return; applied.current = true; requestAnimationFrame(() => { if (editor.isDestroyed) return; const result = editor.view.posAtCoords(initialClickCoords); if (result) editor.chain().setTextSelection(result.pos).focus().run(); else editor.commands.focus('end'); }); }, [editor, initialClickCoords]);
  useEffect(() => { if (!initialClickCoords) applied.current = false; }, [initialClickCoords]);
  return { editor, setContent };
}
