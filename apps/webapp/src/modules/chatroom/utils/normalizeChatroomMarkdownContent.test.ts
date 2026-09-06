import { describe, expect, it } from 'vitest';

import {
  normalizeChatroomMarkdownContent,
  unwrapMarkdownPresentationFence,
} from './normalizeChatroomMarkdownContent';

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

describe('unwrapMarkdownPresentationFence', () => {
  it('unwraps a complete triple-backtick markdown wrapper', () => {
    const wrapped = '```markdown\n## Summary\n\nBody text\n```';
    expect(unwrapMarkdownPresentationFence(wrapped)).toBe('## Summary\n\nBody text');
  });

  it('preserves an inner typescript fence verbatim', () => {
    const wrapped = '```markdown\n## Summary\n\n```typescript\nconst value = 1;\n```\n```';
    expect(unwrapMarkdownPresentationFence(wrapped)).toBe(
      '## Summary\n\n```typescript\nconst value = 1;\n```'
    );
  });

  it('accepts md labels, case-insensitive labels, surrounding whitespace, and blank lines', () => {
    expect(unwrapMarkdownPresentationFence('  ```MD  \n\nHello\n\n  ```  \n')).toBe('Hello');
    expect(unwrapMarkdownPresentationFence('```Md\nHello\n```')).toBe('Hello');
    expect(unwrapMarkdownPresentationFence('```markdown\nHello\n```')).toBe('Hello');
  });

  it('preserves an inner bash fence verbatim', () => {
    const wrapped = '```md\nIntro\n\n```bash\necho hi\n```\n```';
    expect(unwrapMarkdownPresentationFence(wrapped)).toBe('Intro\n\n```bash\necho hi\n```');
  });

  it('leaves unlabelled code fences unchanged', () => {
    const code = '```\nconst value = 1;\n```';
    expect(unwrapMarkdownPresentationFence(code)).toBe(code);
  });

  it('leaves four-backtick wrappers unchanged', () => {
    const four = '````markdown\n## Summary\n````\n';
    expect(unwrapMarkdownPresentationFence(four)).toBe(four);
  });

  it('leaves missing or mismatched closing fences unchanged', () => {
    const noClose = '```markdown\n## Summary\n';
    expect(unwrapMarkdownPresentationFence(noClose)).toBe(noClose);
    const mislabeledClose = '```markdown\n## Summary\n```bash';
    expect(unwrapMarkdownPresentationFence(mislabeledClose)).toBe(mislabeledClose);
  });

  it('leaves trailing nonblank content after the closing fence unchanged', () => {
    const trailing = '```markdown\n## Summary\n```\ntrailing note';
    expect(unwrapMarkdownPresentationFence(trailing)).toBe(trailing);
  });

  it('handles CRLF line endings while preserving interior content', () => {
    const wrapped = '```markdown\r\n## Summary\r\n```';
    expect(unwrapMarkdownPresentationFence(wrapped)).toBe('## Summary');
  });

  it('returns blank and non-wrapping input unchanged', () => {
    expect(unwrapMarkdownPresentationFence('')).toBe('');
    expect(unwrapMarkdownPresentationFence('```\n```')).toBe('```\n```');
    expect(unwrapMarkdownPresentationFence('   ')).toBe('   ');
  });

  it('unwraps an empty markdown wrapper to an empty body', () => {
    expect(unwrapMarkdownPresentationFence('```markdown\n```')).toBe('');
  });
});
