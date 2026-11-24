import { describe, expect, it, vi } from 'vitest';

import { buildMarkdownExportDom } from './buildMessageExportDom';
import { replaceMermaidFencesWithSvg } from './replaceMermaidFencesWithSvg';

vi.mock('./replaceMermaidFencesWithSvg', () => ({
  MERMAID_EXPORT_PLACEHOLDER_PREFIX: 'MERMAID_EXPORT_PLACEHOLDER_',
  replaceMermaidFencesWithSvg: vi.fn(() =>
    Promise.resolve({
      markdown: 'Intro\n\nMERMAID_EXPORT_PLACEHOLDER_0\n\n',
      diagrams: new Map([[0, '<svg id="diagram"></svg>']]),
    })
  ),
}));

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => (children ? `<div>${children}</div>` : ''),
}));

const chatInput = {
  markdown: 'Intro\n\n```mermaid\ngraph TD; A-->B\n```',
  header: { label: 'user', timestamp: '1/1/2025' },
};

describe('buildMarkdownExportDom chat header', () => {
  it('replaces the Mermaid placeholder with the rendered SVG wrapped in an export-diagram div', async () => {
    const { htmlFragment } = await buildMarkdownExportDom(chatInput, '');

    expect(htmlFragment).toContain('<div class="export-diagram"');
    expect(htmlFragment).toContain('<svg id="diagram"');
    expect(htmlFragment).not.toContain('MERMAID_EXPORT_PLACEHOLDER_');
  });

  it('scales a diagram wider than the page down to the page width', async () => {
    vi.mocked(replaceMermaidFencesWithSvg).mockResolvedValueOnce({
      markdown: 'MERMAID_EXPORT_PLACEHOLDER_0',
      diagrams: new Map([
        [
          0,
          '<svg width="2400" height="300" viewBox="0 0 2400 300"><rect width="2400" height="300"/></svg>',
        ],
      ]),
    });

    const { root } = await buildMarkdownExportDom(chatInput, '');

    const svg = root.querySelector('.export-diagram svg') as SVGElement;
    expect(svg).not.toBeNull();
    expect(svg.getAttribute('style')).toContain('max-width:100%');
    expect(svg.getAttribute('style')).toContain('height:auto');
  });

  it('exposes the header paragraph and rule as the first page blocks', async () => {
    const { pageBlocks, htmlFragment } = await buildMarkdownExportDom(
      { markdown: 'Intro', header: { label: 'user', timestamp: '1/1/2025' } },
      ''
    );

    expect(pageBlocks.map((el) => el.tagName).slice(0, 2)).toEqual(['P', 'HR']);
    expect(htmlFragment).toContain('<hr');
    expect(htmlFragment).toContain('user');
    expect(htmlFragment).toContain('1/1/2025');
  });

  it('applies the caller root style first, then the light export theme, and returns a detached root', async () => {
    const { root } = await buildMarkdownExportDom(chatInput, 'position:fixed;left:-9999px;');

    expect(root.isConnected).toBe(false);
    expect(root.style.position).toBe('fixed');
    expect(root.style.getPropertyValue('--chatroom-text-primary')).toBe('#171717');
    expect(root.textContent).toContain('Intro');
  });
});

describe('buildMarkdownExportDom', () => {
  it('renders the body without a chat header when no header is given', async () => {
    const { htmlFragment, pageBlocks } = await buildMarkdownExportDom({ markdown: 'Body' }, '');

    expect(htmlFragment).not.toContain('<hr');
    expect(pageBlocks).toHaveLength(1);
    expect(pageBlocks[0].tagName).toBe('DIV');
  });

  it('renders an empty document as no page blocks and no rule', async () => {
    vi.mocked(replaceMermaidFencesWithSvg).mockResolvedValueOnce({
      markdown: '',
      diagrams: new Map(),
    });

    const { htmlFragment, pageBlocks } = await buildMarkdownExportDom({ markdown: '' }, '');

    expect(pageBlocks).toEqual([]);
    expect(htmlFragment).not.toContain('<hr');
  });
});
