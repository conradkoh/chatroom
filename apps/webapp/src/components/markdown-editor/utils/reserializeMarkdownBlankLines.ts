import { Editor } from '@tiptap/core';

import { createMarkdownEditorExtensions } from '../extensions/markdownEditorExtensions';

/** Re-serialize markdown so visually empty paragraphs become `&nbsp;`. */
export function reserializeMarkdownBlankLines(input: string): string {
  const trimmed = input.replace(/^[ \t]+$/gm, '&amp;nbsp;').trim();
  if (!trimmed) return '';

  let editor: Editor | undefined;
  try {
    editor = new Editor({
      extensions: createMarkdownEditorExtensions(),
      content: trimmed,
      contentType: 'markdown',
    });
    return editor.getMarkdown();
  } finally {
    editor?.destroy();
  }
}
