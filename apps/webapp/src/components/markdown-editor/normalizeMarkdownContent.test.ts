import { describe, expect, it } from 'vitest';
import { htmlToMarkdown, looksLikeHtml, normalizeMarkdownContent, stripHtmlTags } from './normalizeMarkdownContent';
describe('normalizeMarkdownContent', () => {
  it('detects legacy html fragments but excludes structured and fenced content', () => {
    expect(looksLikeHtml('&lt;p&gt;Hello &lt;strong&gt;world&lt;/strong&gt;&lt;/p&gt;')).toBe(true);
    expect(looksLikeHtml('text with &lt;strong&gt;inline&lt;/strong&gt; html')).toBe(true);
    expect(looksLikeHtml('&lt;handoff-overview&gt;## Summary&lt;/handoff-overview&gt;')).toBe(false);
    expect(looksLikeHtml('```html\n&lt;p&gt;x&lt;/p&gt;\n```')).toBe(false);
  });
  it('converts html and preserves markdown', () => {
    expect(htmlToMarkdown('&lt;p&gt;Hello &lt;strong&gt;world&lt;/strong&gt;&lt;/p&gt;')).toContain('world');
    expect(normalizeMarkdownContent('# Title')).toBe('# Title');
    expect(normalizeMarkdownContent('&lt;handoff-overview&gt;## Summary&lt;/handoff-overview&gt;')).toContain('handoff-overview');
    expect(stripHtmlTags('&lt;p&gt;Hello&lt;/p&gt;')).not.toContain('&lt;');
  });
});
