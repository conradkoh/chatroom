import type { Editor } from '@tiptap/core';
import { normalizeMarkdownContent } from '@workspace/shared/utilities/markdown';

export function getNormalizedEditorMarkdown(editor: Editor, normalize = normalizeMarkdownContent) {
  return normalize(editor.getMarkdown());
}
