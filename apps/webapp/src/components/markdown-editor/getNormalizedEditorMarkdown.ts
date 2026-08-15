import type { Editor } from '@tiptap/core';
import { normalizeMarkdownContent } from './normalizeMarkdownContent';
export function getNormalizedEditorMarkdown(editor: Editor) { return normalizeMarkdownContent(editor.getMarkdown()); }
