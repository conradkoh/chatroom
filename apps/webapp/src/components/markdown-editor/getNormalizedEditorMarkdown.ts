import type { Editor } from '@tiptap/core';
import { normalizeMarkdownContent } from './normalizeMarkdownContent';
export function getNormalizedEditorMarkdown(editor: Editor, normalize = normalizeMarkdownContent) { return normalize(editor.getMarkdown()); }
