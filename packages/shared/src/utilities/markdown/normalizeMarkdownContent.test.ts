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

describe('normalizeMarkdownContent — markdown with HTML-like text', () => {
  const handoff = [
    '## Summary',
    'Your slice is **accepted**.',
    '',
    '## Files',
    '- Budgets: `bond budget list --currency <code> [--at]`',
  ].join('\n');

  it('leaves markdown with an inline-code HTML placeholder untouched', () => {
    expect(normalizeMarkdownContent(handoff)).toBe(handoff);
    expect(looksLikeHtml(handoff)).toBe(false);
  });

  it('leaves a tag that appears only inside an inline code span untouched', () => {
    const body = 'Use `<div>` for the wrapper.\n\n- item';
    expect(normalizeMarkdownContent(body)).toBe(body);
  });

  it('leaves a generic placeholder such as Foo<A, B> untouched', () => {
    const body = '## Types\n\nReturns Foo<A, B> from the call.';
    expect(normalizeMarkdownContent(body)).toBe(body);
  });

  it('leaves a mid-document <br/> in markdown untouched', () => {
    const body = '## Title\n\nLine one<br/>line two';
    expect(normalizeMarkdownContent(body)).toBe(body);
  });

  it('still converts legacy HTML that starts with a block tag', () => {
    const legacy = '<p>Hello <strong>world</strong></p>';
    expect(looksLikeHtml(legacy)).toBe(true);
    expect(normalizeMarkdownContent(legacy)).toContain('world');
    expect(normalizeMarkdownContent(legacy)).not.toContain('<p>');
  });
});
