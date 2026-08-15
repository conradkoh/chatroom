import { describe, expect, it } from 'vitest';
import { normalizeChatroomMarkdownContent } from './normalizeChatroomMarkdownContent';
describe('normalizeChatroomMarkdownContent', () => {
  it('preserves envelopes with nested HTML', () => {
    const content = '&lt;handoff-overview&gt;\n&lt;p&gt;Summary&lt;/p&gt;\n&lt;/handoff-overview&gt;';
    expect(normalizeChatroomMarkdownContent(content)).toBe(content);
    expect(normalizeChatroomMarkdownContent(`  ${content}  `)).toBe(content);
  });
  it('normalizes legacy HTML outside envelopes', () => {
    expect(normalizeChatroomMarkdownContent('<p>Hello</p>')).toContain('Hello');
  });
});
