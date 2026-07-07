import { createHighlighter } from 'shiki';
import { describe, expect, it } from 'vitest';

describe('useHighlighter shiki options', () => {
  it('emits light-dark() token colors for dual-theme rendering', async () => {
    const hl = await createHighlighter({
      themes: ['github-light', 'github-dark'],
      langs: ['ts'],
    });

    const html = await hl.codeToHtml('const x = 1;', {
      lang: 'ts',
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
      defaultColor: 'light-dark()',
      colorsRendering: 'none',
    });

    expect(html).toContain('light-dark(');
    expect(html).not.toContain('--shiki-dark:#E1E4E8');
    expect(html).not.toMatch(/color:#E1E4E8/i);
  });
});
