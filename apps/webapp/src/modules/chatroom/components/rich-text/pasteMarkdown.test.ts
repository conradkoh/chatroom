import { describe, expect, it } from 'vitest';

import { looksLikeMarkdown } from './pasteMarkdown';

describe('looksLikeMarkdown', () => {
  it('detects fenced code block', () => {
    expect(looksLikeMarkdown('```\nconst x = 1;\n```')).toBe(true);
  });

  it('detects code block with language tag', () => {
    expect(looksLikeMarkdown('```typescript\nconst x: number = 1;\n```')).toBe(true);
  });

  it('detects heading', () => {
    expect(looksLikeMarkdown('# Title')).toBe(true);
    expect(looksLikeMarkdown('## Subtitle')).toBe(true);
    expect(looksLikeMarkdown('###### Depth 6')).toBe(true);
  });

  it('detects unordered list', () => {
    expect(looksLikeMarkdown('- item')).toBe(true);
    expect(looksLikeMarkdown('* item')).toBe(true);
    expect(looksLikeMarkdown('+ item')).toBe(true);
  });

  it('detects ordered list', () => {
    expect(looksLikeMarkdown('1. first')).toBe(true);
  });

  it('detects bold text', () => {
    expect(looksLikeMarkdown('some **bold** text')).toBe(true);
  });

  it('detects inline code', () => {
    expect(looksLikeMarkdown('use `code` here')).toBe(true);
  });

  it('rejects plain text', () => {
    expect(looksLikeMarkdown('just a regular sentence.')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(looksLikeMarkdown('')).toBe(false);
  });
});
