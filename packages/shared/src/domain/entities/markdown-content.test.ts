import { describe, expect, it } from 'vitest';

import {
  htmlToMarkdown,
  looksLikeHtml,
  normalizeMarkdownContent,
  withMarkdownContent,
} from './markdown-content';

describe('markdown content normalization', () => {
  it('normalizes legacy HTML', () => {
    expect(looksLikeHtml('&amp;lt;p&amp;gt;Hello&amp;lt;/p&amp;gt;')).toBe(true);
    expect(htmlToMarkdown('<p>Hello <strong>world</strong></p>')).toContain('world');
    expect(normalizeMarkdownContent('```html\n<p>x</p>\n```')).toContain('<p>x</p>');
  });
  it('normalizes entities on documents', () => {
    expect(
      withMarkdownContent({ content: '&amp;lt;p&amp;gt;Hello&amp;lt;/p&amp;gt;' }).content
    ).not.toContain('<p>');
  });
});
