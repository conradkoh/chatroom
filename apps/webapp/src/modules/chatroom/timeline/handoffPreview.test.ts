import { describe, expect, it } from 'vitest';

import { getHandoffPreviewText } from './handoffPreview';

describe('getHandoffPreviewText', () => {
  it('passes plain text through', () => {
    expect(getHandoffPreviewText('Implemented the change and ran the suite.')).toBe(
      'Implemented the change and ran the suite.'
    );
  });

  it('strips headings and list markers, including indented ones', () => {
    expect(getHandoffPreviewText('## Summary\n- first item\n> quoted line')).toBe(
      'Summary first item'
    );
    expect(getHandoffPreviewText('  ## Summary\n    - nested item')).toBe('Summary nested item');
  });

  it('reduces links to their text', () => {
    expect(getHandoffPreviewText('See [the docs](https://example.com/docs) for details.')).toBe(
      'See the docs for details.'
    );
  });

  it('strips paired emphasis and inline code markers', () => {
    expect(getHandoffPreviewText('**bold** and *em* and _italic_ and `code`')).toBe(
      'bold and em and italic and code'
    );
  });

  it('keeps identifiers and arithmetic operators intact', () => {
    expect(getHandoffPreviewText('snake_case_name')).toBe('snake_case_name');
    expect(getHandoffPreviewText('__init__')).toBe('__init__');
    expect(getHandoffPreviewText('fix/all_tab_x')).toBe('fix/all_tab_x');
    expect(getHandoffPreviewText('2 * 3')).toBe('2 * 3');
  });

  it('strips handoff wrapper tags', () => {
    expect(getHandoffPreviewText('<user-message>hello</user-message> world')).toBe('hello world');
    expect(getHandoffPreviewText('<handoff-overview>Summary</handoff-overview> body')).toBe(
      'Summary body'
    );
  });

  it('leaves generics, comparisons and autolinks alone', () => {
    expect(getHandoffPreviewText('Promise<void> resolves')).toBe('Promise<void> resolves');
    expect(getHandoffPreviewText('Map<string, Message> is keyed')).toBe(
      'Map<string, Message> is keyed'
    );
    expect(getHandoffPreviewText('a < b > c')).toBe('a < b > c');
    expect(getHandoffPreviewText('See <https://example.com/docs>')).toBe(
      'See <https://example.com/docs>'
    );
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

  it('skips tilde-fenced code blocks', () => {
    const content = ['Intro line', '~~~', 'const value = 1;', '~~~', 'After code'].join('\n');

    expect(getHandoffPreviewText(content)).toBe('Intro line After code');
  });

  it('keeps a tilde block open across a backtick fence line', () => {
    const content = [
      '~~~md',
      'inside fence prose',
      '```',
      'still inside the tilde block',
      '~~~',
      'outside prose',
    ].join('\n');

    expect(getHandoffPreviewText(content)).toBe('outside prose');
  });

  it('does not close a block on a shorter run of the same character', () => {
    const content = ['~~~', 'code', '~~', 'still code', '~~~', 'after'].join('\n');

    expect(getHandoffPreviewText(content)).toBe('after');
  });

  it('keeps only the first two non-empty lines', () => {
    expect(getHandoffPreviewText('One\nTwo\nThree')).toBe('One Two');
    expect(getHandoffPreviewText('One\n\n\nTwo\nThree')).toBe('One Two');
  });

  it('caps long previews at 240 characters with an ellipsis', () => {
    const preview = getHandoffPreviewText('a'.repeat(300));

    expect(preview).toHaveLength(240);
    expect(preview.endsWith('…')).toBe(true);
  });

  it('returns a code-block placeholder when the content is only a fenced block', () => {
    expect(getHandoffPreviewText('```json\n{ "summary": "payload" }\n```')).toBe('(code block)');
  });

  it('returns an empty string for empty content', () => {
    expect(getHandoffPreviewText('')).toBe('');
    expect(getHandoffPreviewText('   \n\n  ')).toBe('');
  });
});
