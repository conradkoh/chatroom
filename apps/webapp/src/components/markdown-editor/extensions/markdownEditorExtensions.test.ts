import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { createMarkdownEditorExtensions } from './markdownEditorExtensions';

describe('ParagraphWithBlankLinePreservation', () => {
  it('serializes trailing-break empty paragraphs as nbsp', () => {
    const editor = new Editor({
      extensions: createMarkdownEditorExtensions(),
      content:
        '<p>This is some content!</p><p><br class="ProseMirror-trailingBreak"></p><pre><code class="language-txt">asdasd\nasdsad</code></pre><p><br class="ProseMirror-trailingBreak"></p>',
      contentType: 'html',
    });

    const markdown = editor.getMarkdown();
    editor.destroy();

    expect(markdown).toContain('&nbsp;');
    expect(markdown).toMatch(/This is some content!\n\n&nbsp;\n\n```txt/);
    expect(markdown).toMatch(/```\n\n&nbsp;/);
  });

  it('still serializes truly empty paragraphs as nbsp', () => {
    const editor = new Editor({
      extensions: createMarkdownEditorExtensions(),
      content: '<p>line one</p><p></p><p>line two</p>',
      contentType: 'html',
    });

    const markdown = editor.getMarkdown();
    editor.destroy();

    expect(markdown).toContain('&nbsp;');
  });
});
