import { describe, expect, it } from 'vitest';

import { normalizeChatroomMarkdownContent } from './normalizeChatroomMarkdownContent';

describe('normalizeChatroomMarkdownContent', () => {
  it('preserves envelopes with nested HTML', () => {
    const content = '<handoff-overview>\n<p>Summary</p>\n</handoff-overview>';
    expect(normalizeChatroomMarkdownContent(content)).toBe(content);
    expect(normalizeChatroomMarkdownContent(`  ${content}  `)).toBe(content);
  });

  it('normalizes legacy HTML outside envelopes', () => {
    expect(normalizeChatroomMarkdownContent('<p>Hello</p>')).toContain('Hello');
  });

  it('decodes HTML-entity-encoded tags as envelopes', () => {
    const encoded = '&lt;handoff-overview&gt;Summary&lt;/handoff-overview&gt;';
    expect(normalizeChatroomMarkdownContent(encoded)).toBe(
      '<handoff-overview>Summary</handoff-overview>'
    );
  });
});
