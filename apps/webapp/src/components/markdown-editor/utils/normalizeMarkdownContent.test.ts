import { describe, expect, it } from 'vitest';

import {
  htmlToMarkdown,
  looksLikeHtml,
  normalizeMarkdownContent,
  stripHtmlTags,
} from './normalizeMarkdownContent';

describe('normalizeMarkdownContent', () => {
  it('detects legacy html fragments but excludes structured and fenced content', () => {
    expect(looksLikeHtml('<p>Hello <strong>world</strong></p>')).toBe(true);
    expect(looksLikeHtml('text with <strong>inline</strong> html')).toBe(true);
    expect(looksLikeHtml('```html\n<p>x</p>\n```')).toBe(false);
    expect(looksLikeHtml('&lt;p&gt;Hello&lt;/p&gt;')).toBe(false);
  });
  it('converts html and preserves markdown', () => {
    expect(htmlToMarkdown('<p>Hello <strong>world</strong></p>')).toContain('world');
    expect(normalizeMarkdownContent('# Title')).toBe('# Title');
    expect(stripHtmlTags('<p>Hello</p>')).not.toContain('<');
  });
});
