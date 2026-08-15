import { describe, expect, it } from 'vitest';

import { reserializeMarkdownBlankLines } from './reserializeMarkdownBlankLines';

describe('reserializeMarkdownBlankLines', () => {
  it('converts whitespace-only blank lines around code blocks to nbsp', () => {
    const legacy = 'This is some content!\n\n   \n\n```txt\nasdasd\nasdsad\n```\n\n   \n';
    const out = reserializeMarkdownBlankLines(legacy);

    expect(out).toMatch(/This is some content!\n\n&amp;nbsp;\n\n```txt/);
    expect(out).toMatch(/```\n\n&amp;nbsp;/);
  });
});
