import { describe, expect, it } from 'vitest';

import {
  getHandoffPreviewText,
  HANDOFF_PREVIEW_LINE_COUNT,
  HANDOFF_PREVIEW_MAX_CHARS,
} from './handoffPreview';

describe('getHandoffPreviewText', () => {
  it('passes plain text through', () => {
    expect(getHandoffPreviewText('Implemented the change and ran the suite.')).toBe(
      'Implemented the change and ran the suite.'
    );
  });

  it('strips headings and list markers', () => {
    expect(getHandoffPreviewText('## Summary\n- first item\n> quoted line')).toBe(
      'Summary first item'
    );
  });

  it('reduces links to their text', () => {
    expect(getHandoffPreviewText('See [the docs](https://example.com/docs) for details.')).toBe(
      'See the docs for details.'
    );
  });

  it('strips emphasis and inline code markers', () => {
    expect(getHandoffPreviewText('**Bold** and `code` and _italic_')).toBe(
      'Bold and code and italic'
    );
  });

  it('strips HTML-like tags', () => {
    expect(getHandoffPreviewText('<user-message>hello</user-message> world')).toBe('hello world');
  });

  it('reads the inner text of a presentation-fenced handoff', () => {
    const content = '```markdown\n## Summary\nFixed the thing.\n```';
    expect(getHandoffPreviewText(content)).toBe('Summary Fixed the thing.');
  });

  it('skips inner fenced code blocks after unwrapping the presentation fence', () => {
    const content = [
      '```markdown',
      'Intro line',
      '```ts',
      'const value = 1;',
      '```',
      'After code',
      'Third line',
      '```',
    ].join('\n');

    expect(getHandoffPreviewText(content)).toBe('Intro line After code');
  });

  it('keeps only the configured number of lines', () => {
    expect(HANDOFF_PREVIEW_LINE_COUNT).toBe(2);
    expect(getHandoffPreviewText('One\nTwo\nThree')).toBe('One Two');
  });

  it('caps long previews with an ellipsis', () => {
    const preview = getHandoffPreviewText('a'.repeat(HANDOFF_PREVIEW_MAX_CHARS + 60));

    expect(preview).toHaveLength(HANDOFF_PREVIEW_MAX_CHARS);
    expect(preview.endsWith('…')).toBe(true);
  });

  it('returns an empty string for empty content', () => {
    expect(getHandoffPreviewText('')).toBe('');
    expect(getHandoffPreviewText('   \n\n  ')).toBe('');
  });
});
