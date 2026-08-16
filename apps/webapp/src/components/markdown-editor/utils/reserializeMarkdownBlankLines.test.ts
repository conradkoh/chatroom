import { describe, expect, it } from 'vitest';

import { reserializeMarkdownBlankLines } from './reserializeMarkdownBlankLines';

describe('reserializeMarkdownBlankLines', () => {
  it('converts whitespace-only blank lines around code blocks to nbsp', () => {
    const legacy = 'This is some content!\n\n   \n\n```txt\nasdasd\nasdsad\n```\n\n   \n';
    const out = reserializeMarkdownBlankLines(legacy);

    expect(out).not.toContain('&amp;amp;nbsp;');
    expect(out).toContain('This is some content!\n\n&nbsp;\n\n```txt');
    expect(out).toContain('```\n\n&nbsp;');

    const afterContent = out.slice(out.indexOf('content!') + 'content!'.length, out.indexOf('```txt'));
    expect(Array.from(afterContent).map((c) => c.charCodeAt(0))).toEqual([
      10, 10, 38, 110, 98, 115, 112, 59, 10, 10,
    ]);
  });
});
