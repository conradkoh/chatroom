import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import { TimelineMarkdownBody } from './TimelineMarkdownBody';
import { toPlanMarkdownList } from './timelinePlanMarkdown';

describe('toPlanMarkdownList', () => {
  it('returns an empty string for an empty list', () => {
    expect(toPlanMarkdownList([])).toBe('');
  });

  it('joins items as markdown bullets', () => {
    expect(toPlanMarkdownList(['a', 'b'])).toBe('- a\n- b');
  });

  it('keeps a multi-line item inside its bullet, including a fenced block', () => {
    // Exact parser output for the fixture's P1 Requirements second item.
    const item =
      'Headings inside fenced blocks are ignored:\n  ```markdown\n  ## Not a section\n  ```';

    const markdown = toPlanMarkdownList([item]);

    render(createElement(TimelineMarkdownBody, { content: markdown }));

    const listItem = screen.getByRole('listitem');
    expect(listItem).toHaveTextContent('Headings inside fenced blocks are ignored:');
    const code = listItem.querySelector('pre code');
    expect(code).not.toBeNull();
    expect(code?.textContent).toContain('## Not a section');
  });
});
