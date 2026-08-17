import Link from '@tiptap/extension-link';
import Paragraph from '@tiptap/extension-paragraph';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';

import { CodeBlockLineBoundarySelection } from './codeBlockLineBoundarySelection';

type ParagraphChild = { type: { name: string } | string; text?: string };

function isEmptyParagraphContent(content: readonly ParagraphChild[]): boolean {
  if (content.length === 0) return true;
  return content.every((child) => {
    const typeName = typeof child.type === 'string' ? child.type : child.type.name;
    if (typeName === 'hardBreak') return true;
    if (typeName === 'text') {
      const text = child.text ?? '';
      return text.replace(/\s/g, '') === '' || text === '\u00A0';
    }
    return false;
  });
}

export const ParagraphWithBlankLinePreservation = Paragraph.extend({
  renderMarkdown(node, h) {
    const rawContent = node.content as unknown;
    const content = Array.isArray(rawContent)
      ? (rawContent as ParagraphChild[])
      : ((rawContent as { content?: ParagraphChild[] } | null)?.content ?? []);
    return isEmptyParagraphContent(content) ? '&nbsp;' : h.renderChildren(content);
  },
});

export function createMarkdownEditorExtensions(placeholder?: string) {
  return [
    StarterKit.configure({ heading: { levels: [1, 2, 3] }, paragraph: false }),
    CodeBlockLineBoundarySelection,
    ParagraphWithBlankLinePreservation,
    ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
    Link.configure({ openOnClick: false }),
    Markdown,
  ];
}
