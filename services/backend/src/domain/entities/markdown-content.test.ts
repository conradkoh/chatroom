import { describe, expect, it } from 'vitest';
import { htmlToMarkdown, looksLikeHtml, normalizeMarkdownContent, withMarkdownContent } from './markdown-content';
describe('markdown content normalization', () => {
  it('converts legacy HTML and excludes structured/fenced content', () => {
    expect(looksLikeHtml('<p>Hello</p>')).toBe(true);
    expect(htmlToMarkdown('<p>Hello <strong>world</strong></p>')).toContain('world');
    expect(normalizeMarkdownContent('<handoff-overview>## Summary</handoff-overview>')).toContain('handoff-overview');
    expect(normalizeMarkdownContent('```html\n<p>x</p>\n```')).toContain('<p>x</p>');
    expect(looksLikeHtml('&lt;p&gt;Hello&lt;/p&gt;')).toBe(true);
  });
  it('normalizes legacy HTML in task docs', () => {
    const result = withMarkdownContent({ _id: 't1', content: '<p>Hello <strong>world</strong></p>', status: 'pending' });
    expect(result.content).not.toContain('<p>');
    expect(result.content).toContain('world');
  });
});
