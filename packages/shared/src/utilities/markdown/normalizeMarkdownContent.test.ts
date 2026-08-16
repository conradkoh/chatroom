import { describe, expect, it } from 'vitest';

import { looksLikeHtml, normalizeMarkdownContent } from './normalizeMarkdownContent';

describe('normalizeMarkdownContent', () => {
  it('normalizes encoded HTML', () => {
    expect(looksLikeHtml('&amp;lt;p&amp;gt;Hello&amp;lt;/p&amp;gt;')).toBe(true);
    expect(
      normalizeMarkdownContent(
        '&amp;lt;p&amp;gt;Hello &amp;lt;strong&amp;gt;world&amp;lt;/strong&amp;gt;&amp;lt;/p&amp;gt;'
      )
    ).toContain('world');
  });
});
