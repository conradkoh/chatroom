import { describe, expect, it } from 'vitest';

import { prepareHandoffSectionMarkdown } from './prepareHandoffSectionMarkdown';

describe('prepareHandoffSectionMarkdown', () => {
  it('strips HTML comments while preserving a mermaid fence', () => {
    const body = `<!-- template guidance -->
\`\`\`mermaid
flowchart TD
  A --> B
\`\`\``;

    expect(prepareHandoffSectionMarkdown(body)).toBe(`\`\`\`mermaid
flowchart TD
  A --> B
\`\`\``);
  });

  it('decodes HTML entities inside a mermaid fence', () => {
    expect(
      prepareHandoffSectionMarkdown(`\`\`\`mermaid
flowchart TD
  A --&gt; B
\`\`\``)
    ).toContain('A --> B');
  });

  it('leaves ordinary markdown unchanged', () => {
    const markdown = '## Heading\n\nA **bold** paragraph.';
    expect(prepareHandoffSectionMarkdown(markdown)).toBe(markdown);
  });
});
