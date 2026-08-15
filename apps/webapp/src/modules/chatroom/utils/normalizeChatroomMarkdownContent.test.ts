import { describe, expect, it } from 'vitest';
import { containsStructuredEnvelope, normalizeChatroomMarkdownContent } from './normalizeChatroomMarkdownContent';
describe('normalizeChatroomMarkdownContent', () => {
  it('preserves envelopes with nested HTML', () => {
    const content = '&lt;handoff-overview&gt;\n&lt;p&gt;Summary&lt;/p&gt;\n&lt;/handoff-overview&gt;';
    expect(normalizeChatroomMarkdownContent(content)).toBe(content);
    expect(normalizeChatroomMarkdownContent(`  ${content}  `)).toBe(content);
  });
  it('normalizes legacy HTML outside envelopes', () => {
    expect(normalizeChatroomMarkdownContent('<p>Hello</p>')).toContain('Hello');
  });
  it('does not treat entity-encoded tags as envelopes', () => {
    expect(containsStructuredEnvelope('&amp;lt;handoff-overview&amp;gt;')).toBe(false);
  });
});
