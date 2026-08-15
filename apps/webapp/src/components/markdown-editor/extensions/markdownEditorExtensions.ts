import Link from '@tiptap/extension-link';
import Paragraph from '@tiptap/extension-paragraph';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';

export const ParagraphWithBlankLinePreservation = Paragraph.extend({
  renderMarkdown(node, h) {
    const content = Array.isArray(node.content) ? node.content : [];
    return content.length === 0 ? '&nbsp;' : h.renderChildren(content);
  },
});

export function createMarkdownEditorExtensions(placeholder?: string) {
  return [StarterKit.configure({ heading: { levels: [1, 2, 3] }, paragraph: false }), ParagraphWithBlankLinePreservation, ...(placeholder ? [Placeholder.configure({ placeholder })] : []), Link.configure({ openOnClick: false }), Markdown];
}
